import { describe, expect, it } from "vitest";
import { WORKER_NAMES } from "../types/index";
import { launch, stopLaunch } from "../src/orchestrator/launch";
import { connections, roster, sleep } from "./helpers";

describe("true parallelism", () => {
  it("issues all eight start() calls within 100ms of each other", async () => {
    const started: Record<string, number> = {};
    const workers = roster(
      Object.fromEntries(
        WORKER_NAMES.map((n) => [
          n,
          {
            start: async () => {
              started[n] = performance.now();
              await sleep(20); // every worker is "busy" at the same time
            },
          },
        ]),
      ),
    );
    const handle = await launch("a coin about parallel cats", connections, {}, { workers, clients: {} });
    const timings = handle.getStartTimings();
    expect(Object.keys(timings.byWorker)).toHaveLength(8);
    expect(timings.spreadMs).toBeLessThan(100);

    const seen = Object.values(started);
    expect(seen).toHaveLength(8);
    expect(Math.max(...seen) - Math.min(...seen)).toBeLessThan(100);

    const state = await handle.settled;
    for (const n of WORKER_NAMES) expect(state.workers[n].status).toBe("done");
    // Every worker has a Worker.started event and they all share one launch id.
    const log = await handle.bus.log(handle.id);
    const starts = log.filter((e) => e.type === "Worker.started");
    expect(starts.map((e) => ("worker" in e ? e.worker : null)).sort()).toEqual([...WORKER_NAMES].sort());
    await stopLaunch(handle.id);
  });

  it("starts every worker before any worker's start() has finished (no pipeline)", async () => {
    let finished = 0;
    const startedBeforeAnyFinished: number[] = [];
    const workers = roster(
      Object.fromEntries(
        WORKER_NAMES.map((n) => [
          n,
          {
            start: async () => {
              startedBeforeAnyFinished.push(finished);
              await sleep(5);
              finished += 1;
            },
          },
        ]),
      ),
    );
    const handle = await launch("prompt", connections, {}, { workers, clients: {} });
    await handle.settled;
    // Every start() observed zero finished workers: nothing waited on anything.
    expect(startedBeforeAnyFinished).toEqual(new Array(8).fill(0));
    await stopLaunch(handle.id);
  });

  it("records a Launch.started event carrying the roster and the seed fields", async () => {
    const handle = await launch("prompt", connections, { cluster: "devnet", autopilot: { posts: true } }, { workers: roster(), clients: {} });
    await handle.settled;
    const [first] = await handle.bus.log(handle.id);
    expect(first?.type).toBe("Launch.started");
    if (first?.type !== "Launch.started") throw new Error("unreachable");
    expect(first.payload.workers).toEqual([...WORKER_NAMES]);
    expect(first.payload.ownerWallet).toBe(connections.ownerWallet);
    expect(first.payload.autopilot).toEqual({ posts: true, trades: false, recruiting: false });
    await stopLaunch(handle.id);
  });
});
