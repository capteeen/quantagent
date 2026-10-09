import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotImplemented } from "../types/index";
import { EventBus, sseFrame } from "../src/bus/bus";
import { createBusFromEnv, createStoreFromEnv, createStreamFromEnv, storeKindFromEnv, streamKindFromEnv } from "../src/bus/env";
import { MemoryEventStore, MemoryStream } from "../src/bus/store";
import { launch, stopLaunch } from "../src/orchestrator/launch";
import { startPostLaunch } from "../src/postlaunch/index";
import { connections, liveOverrides, makeWorker, roster } from "./helpers";

describe("event bus", () => {
  it("assigns id, at and a per-launch monotonic seq; subscribers are filtered", () => {
    const bus = new EventBus();
    const all: string[] = [];
    const onlyVoice: string[] = [];
    bus.subscribe((e) => all.push(e.type));
    bus.subscribe((e) => onlyVoice.push(e.type), { worker: "Voice", launchId: "L1" });
    const a = bus.emit("L1", { type: "Worker.started", worker: "Voice", reason: "r", payload: {} });
    const b = bus.emit("L1", { type: "Worker.started", worker: "Artist", reason: "r", payload: {} });
    const c = bus.emit("L2", { type: "Worker.started", worker: "Voice", reason: "r", payload: {} });
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 1]);
    expect(a.id).not.toBe(b.id);
    expect(Date.parse(a.at)).not.toBeNaN();
    expect(all).toHaveLength(3);
    expect(onlyVoice).toHaveLength(1);
  });

  it("a subscriber that throws does not break delivery to the others", () => {
    const errors: unknown[] = [];
    const bus = new EventBus({ onError: (e) => errors.push(e) });
    const got: string[] = [];
    bus.subscribe(() => {
      throw new Error("bad subscriber");
    });
    bus.subscribe((e) => got.push(e.type));
    bus.emit("L", { type: "Launch.failed", reason: "r", payload: { reason: "x" } });
    expect(got).toEqual(["Launch.failed"]);
    expect(errors).toHaveLength(1);
  });

  it("toSSE streams history then live events as text/event-stream frames, resumable by Last-Event-ID", async () => {
    const bus = new EventBus();
    bus.emit("L", { type: "Worker.started", worker: "Voice", reason: "r", payload: {} });
    bus.emit("L", { type: "Worker.progress", worker: "Voice", reason: "r", payload: { step: "s" } });
    const ac = new AbortController();
    const frames: string[] = [];
    const consumer = (async () => {
      for await (const f of bus.toSSE("L", { afterSeq: 1, signal: ac.signal })) {
        frames.push(f);
        if (frames.length === 2) ac.abort();
      }
    })();
    await new Promise((r) => setTimeout(r, 5));
    bus.emit("L", { type: "Worker.done", worker: "Voice", reason: "r", payload: { outputs: {} } });
    await consumer;
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatch(/^id: 2\nevent: Worker.progress\ndata: \{/);
    expect(frames[1]).toMatch(/^id: 3\nevent: Worker.done\n/);
    expect(frames[1]!.endsWith("\n\n")).toBe(true);
    const parsed = JSON.parse(frames[1]!.split("data: ")[1]!.trim());
    expect(parsed.seq).toBe(3);
    expect(sseFrame(parsed)).toBe(frames[1]);
  });

  it("resume() continues the seq counter from the store after a restart", async () => {
    const store = new MemoryEventStore();
    const bus1 = new EventBus({ store, stream: new MemoryStream() });
    bus1.emit("L", { type: "Launch.failed", reason: "r", payload: { reason: "x" } });
    bus1.emit("L", { type: "Launch.failed", reason: "r", payload: { reason: "y" } });
    await bus1.flush();
    const bus2 = new EventBus({ store, stream: new MemoryStream() });
    expect(await bus2.resume("L")).toBe(2);
    const e = bus2.emit("L", { type: "Launch.failed", reason: "r", payload: { reason: "z" } });
    expect(e.seq).toBe(3);
    expect((await bus2.log("L")).map((x) => x.seq)).toEqual([1, 2, 3]);
  });

  it("a LaunchHandle exposes events() over the same log", async () => {
    const handle = await launch("prompt", connections, {}, { workers: roster(liveOverrides()), clients: {} });
    await handle.settled;
    const ac = new AbortController();
    const types: string[] = [];
    for await (const e of handle.events({ signal: ac.signal })) {
      types.push(e.type);
      if (e.type === "Launch.live") ac.abort();
    }
    expect(types[0]).toBe("Launch.started");
    expect(types).toContain("Launcher.deployed");
    await stopLaunch(handle.id);
  });
});

describe("environment adapters", () => {
  it("defaults to in-memory when DATABASE_URL / REDIS_URL are unset, and never fakes the others", async () => {
    const env = { DATABASE_URL: undefined, REDIS_URL: undefined };
    expect(createStoreFromEnv(env).kind).toBe("memory");
    expect(createStreamFromEnv(env).kind).toBe("memory");
    expect(storeKindFromEnv({ DATABASE_URL: "  " })).toBe("memory");
    expect(storeKindFromEnv({ DATABASE_URL: "postgres://db/q" })).toBe("postgres");
    expect(streamKindFromEnv({ REDIS_URL: "redis://r:6379" })).toBe("redis");
    const bus = await createBusFromEnv(env);
    expect(bus.getStoreKind()).toBe("memory");
    expect(bus.getStreamKind()).toBe("memory");
    await bus.close();
  });

  it("the Postgres and Redis adapters are only constructed when their url is set", async () => {
    const { PostgresEventStore } = await import("../src/bus/postgres");
    const { RedisStream } = await import("../src/bus/redis");
    expect(createStoreFromEnv({ DATABASE_URL: "" })).not.toBeInstanceOf(PostgresEventStore);
    expect(createStreamFromEnv({ REDIS_URL: "" })).not.toBeInstanceOf(RedisStream);
    expect(() => new PostgresEventStore("")).toThrow();
    expect(() => new RedisStream("")).toThrow();
  });
});

describe("post-launch runtime", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (saved !== undefined) process.env.REDIS_URL = saved;
  });

  it("throws NotImplemented naming REDIS_URL instead of running an in-process substitute", () => {
    const bus = new EventBus();
    let err: unknown;
    try {
      startPostLaunch({ launchId: "L", bus, workers: [makeWorker("Voice")], prompt: "p", connections, options: {}, clients: {} });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NotImplemented);
    expect((err as NotImplemented).needs).toEqual(["REDIS_URL"]);
    expect((err as NotImplemented).capability).toBe("post-launch runtime");
  });
});
