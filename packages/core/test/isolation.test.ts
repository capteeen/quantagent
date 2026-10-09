import { describe, expect, it } from "vitest";
import { WORKER_NAMES } from "../types/index";
import { launch, stopLaunch } from "../src/orchestrator/launch";
import { connections, liveOverrides, roster, sleep } from "./helpers";

describe("worker isolation", () => {
  it("a sync throw and an async rejection fail only their own workers; the launch is partial", async () => {
    const workers = roster({
      ...liveOverrides(),
      Ideator: {
        start: () => {
          throw new Error("ideator exploded synchronously");
        },
      },
      Artist: {
        start: async () => {
          await sleep(15);
          throw new Error("artist rejected later");
        },
      },
      Voice: {
        start: async () => {
          await sleep(30); // outlives both crashes
        },
      },
    });
    const handle = await launch("prompt", connections, {}, { workers, clients: {} });
    // Both crashes were contained: launch() returned a handle and timings for all eight.
    expect(handle.getStartTimings().spreadMs).toBeLessThan(100);

    const state = await handle.settled;
    expect(state.status).toBe("partial");
    expect(state.workers.Ideator.status).toBe("failed");
    expect(state.workers.Ideator.failReason).toContain("ideator exploded synchronously");
    expect(state.workers.Artist.status).toBe("failed");
    expect(state.workers.Artist.failReason).toContain("artist rejected later");
    for (const n of WORKER_NAMES) {
      if (n === "Ideator" || n === "Artist") continue;
      expect(state.workers[n].status, n).toBe("done");
    }
    expect(state.coinCa).toBe("CoinCA1111111111111111111111111111111111111");
    expect(state.siteUrl).toBe("https://test.quantagent.site");

    const log = await handle.bus.log(handle.id);
    const failed = log.filter((e) => e.type === "Worker.failed").map((e) => ("worker" in e ? e.worker : null));
    expect(failed.sort()).toEqual(["Artist", "Ideator"]);
    const partial = log.find((e) => e.type === "Launch.partial");
    expect(partial && partial.type === "Launch.partial" ? partial.payload.failed.sort() : null).toEqual(["Artist", "Ideator"]);
    await stopLaunch(handle.id);
  });

  it("a worker whose on() throws fails alone; the event still reaches every other worker", async () => {
    const received: Record<string, number> = {};
    const workers = roster({
      ...liveOverrides(),
      Shield: {
        on: (e) => {
          if (e.type === "Launcher.deployed") throw new Error("shield handler crashed");
        },
      },
      Voice: {
        on: (e) => {
          if (e.type === "Launcher.deployed") received.Voice = (received.Voice ?? 0) + 1;
        },
      },
      Trader: {
        on: (e) => {
          if (e.type === "Launcher.deployed") received.Trader = (received.Trader ?? 0) + 1;
        },
      },
    });
    const handle = await launch("prompt", connections, {}, { workers, clients: {} });
    const state = await handle.settled;
    expect(state.workers.Shield.status).toBe("failed");
    expect(state.workers.Shield.failReason).toContain("shield handler crashed");
    expect(received).toEqual({ Voice: 1, Trader: 1 });
    expect(state.workers.Voice.status).toBe("done");
    expect(state.workers.Trader.status).toBe("done");
    expect(state.status).toBe("partial");
    await stopLaunch(handle.id);
  });

  it("a worker cannot reach another worker's context: the only shared surface is the bus", async () => {
    const ctxs = new Map<string, unknown>();
    const workers = roster(Object.fromEntries(WORKER_NAMES.map((n) => [n, { start: (ctx: unknown) => void ctxs.set(n, ctx) }])));
    const handle = await launch("prompt", connections, {}, { workers, clients: {} });
    await handle.settled;
    const list = [...ctxs.values()];
    expect(new Set(list).size).toBe(8);
    for (const c of list as { signal: AbortSignal; emit: unknown }[]) {
      // distinct abort signals: failing one cannot abort another
      expect(list.filter((o) => (o as { signal: AbortSignal }).signal === c.signal)).toHaveLength(1);
    }
    await stopLaunch(handle.id);
  });

  it("the Launcher failing fails the launch; everyone else still finishes", async () => {
    const workers = roster({
      Launcher: {
        start: () => {
          throw new Error("rpc down");
        },
      },
    });
    const handle = await launch("prompt", connections, {}, { workers, clients: {} });
    const state = await handle.settled;
    expect(state.status).toBe("failed");
    expect(state.coinCa).toBeUndefined();
    for (const n of WORKER_NAMES) if (n !== "Launcher") expect(state.workers[n].status).toBe("done");
    await stopLaunch(handle.id);
  });
});
