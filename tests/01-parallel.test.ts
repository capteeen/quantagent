/**
 * §9 check 1: TRUE PARALLELISM. On a real launch through core launch() with the real
 * workers from createWorkers() and fake clients, all eight Worker.started land within
 * 100ms of each other, and no worker's start() waits on another's completion.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WORKER_NAMES } from "@quantagent/core/types";
import { simulate, wrapWorker, type Sim } from "./helpers/launch";

let sim: Sim | undefined;

afterEach(async () => {
  await sim?.stop();
  sim = undefined;
});

describe("eight workers start within 100ms (SPEC §2, §3, §9)", () => {
  it("Worker.started for all eight within 100ms, measured three ways", async () => {
    const startCalledAt: Record<string, number> = {};
    const finishedBefore: Record<string, number> = {};
    let finished = 0;
    sim = await simulate({
      autopilot: { posts: true },
      patchWorkers: (workers) =>
        workers.map((w) =>
          wrapWorker(w, {
            start: async (ctx) => {
              startCalledAt[w.name] = performance.now();
              finishedBefore[w.name] = finished;
              try {
                return await w.start(ctx);
              } finally {
                finished += 1;
              }
            },
          }),
        ),
    });

    // 1. the orchestrator's own monotonic clock
    const timings = sim.handle.getStartTimings();
    expect(Object.keys(timings.byWorker).sort()).toEqual([...WORKER_NAMES].sort());
    expect(timings.spreadMs).toBeLessThan(100);

    // 2. the moment each real worker's start() was entered
    const entered = Object.values(startCalledAt);
    expect(entered).toHaveLength(8);
    expect(Math.max(...entered) - Math.min(...entered)).toBeLessThan(100);

    // 3. the Worker.started events on the bus, by wall clock and by delivery time
    const started = sim.ofType("Worker.started");
    expect(started.map((e) => e.worker).sort()).toEqual([...WORKER_NAMES].sort());
    const ats = started.map((e) => Date.parse(e.at));
    expect(Math.max(...ats) - Math.min(...ats)).toBeLessThan(100);
    const delivered = started.map((e) => sim!.deliveredAt.get(e.id)!);
    expect(Math.max(...delivered) - Math.min(...delivered)).toBeLessThan(100);

    // No worker's start() waited on another's completion: every start() began with zero finished.
    expect(finishedBefore).toEqual(Object.fromEntries(WORKER_NAMES.map((n) => [n, 0])));

    // Launch.started precedes every Worker.started, and every Worker.started precedes the first
    // Worker.done / Worker.failed (a worker's synchronous first progress event may interleave).
    const log = await sim.log();
    expect(log[0]!.type).toBe("Launch.started");
    const lastStart = Math.max(...started.map((e) => e.seq));
    const firstEnd = Math.min(...log.filter((e) => e.type === "Worker.done" || e.type === "Worker.failed").map((e) => e.seq));
    expect(lastStart).toBeLessThan(firstEnd);

    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    expect(sim.handle.getState().status).toBe("live");
  });

  it("a slow worker does not delay the others' starts (no pipeline)", async () => {
    const startCalledAt: Record<string, number> = {};
    sim = await simulate({
      autopilot: { posts: true },
      patchWorkers: (workers) =>
        workers.map((w) =>
          wrapWorker(w, {
            start: async (ctx) => {
              startCalledAt[w.name] = performance.now();
              if (w.name === "Ideator") await new Promise((r) => setTimeout(r, 150)); // the first worker in the roster is slow
              return w.start(ctx);
            },
          }),
        ),
    });
    const entered = Object.values(startCalledAt);
    expect(entered).toHaveLength(8);
    expect(Math.max(...entered) - Math.min(...entered)).toBeLessThan(100);
    expect(sim.handle.getStartTimings().spreadMs).toBeLessThan(100);
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
  });
});
