/**
 * §9 check 2: kill a worker mid-launch. (a) a fake client that throws inside one worker,
 * (b) a worker whose on() throws. The others finish; Launch.partial lists exactly the
 * dead one; nothing else reports as failed. Plus the adversarial case: a dead worker
 * that others depend on must still end in an honest Launch.failed, not a hang.
 */
import { afterEach, describe, expect, it } from "vitest";
import { failedWorkers } from "@quantagent/core";
import { WORKER_NAMES } from "@quantagent/core/types";
import { simulate, wrapWorker, type Sim } from "./helpers/launch";

let sim: Sim | undefined;

afterEach(async () => {
  await sim?.stop();
  sim = undefined;
});

describe("worker isolation (SPEC §3 'a crashed worker cannot crash another', §9)", () => {
  it("(a) hosting.publish throws inside the Builder: the other seven finish, Launch.partial lists exactly [Builder]", async () => {
    sim = await simulate({ autopilot: { posts: true }, hostingFail: new Error("host exploded") });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const state = sim.handle.getState();
    expect(state.status).toBe("partial");
    expect(failedWorkers(state)).toEqual(["Builder"]);
    expect(state.workers.Builder.failReason).toMatch(/host exploded|initial publish failed/);
    for (const w of WORKER_NAMES) if (w !== "Builder") expect(state.workers[w].status, w).toBe("done");
    const partial = sim.ofType("Launch.partial");
    expect(partial).toHaveLength(1);
    expect(partial[0]!.payload.failed).toEqual(["Builder"]);
    expect(sim.ofType("Worker.failed").map((e) => e.worker)).toEqual(["Builder"]);
    // The coin still deployed and the Voice still announced the CA (without a site link).
    expect(state.coinCa).toBeTruthy();
    expect(sim.ofType("Voice.posted").some((e) => e.payload.kind === "ca")).toBe(true);
  });

  it("(b) a worker whose on() throws (Shield on Ideator.named): the rest finish, Launch.partial lists exactly [Shield]", async () => {
    sim = await simulate({
      autopilot: { posts: true },
      patchWorkers: (workers) =>
        workers.map((w) =>
          w.name === "Shield"
            ? wrapWorker(w, {
                on: (event, ctx) => {
                  if (event.type === "Ideator.named") throw new Error("shield handler crashed");
                  return w.on(event, ctx);
                },
              })
            : w,
        ),
    });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const state = sim.handle.getState();
    expect(state.status).toBe("partial");
    expect(failedWorkers(state)).toEqual(["Shield"]);
    expect(state.workers.Shield.failReason).toContain("shield handler crashed");
    for (const w of WORKER_NAMES) if (w !== "Shield") expect(state.workers[w].status, w).toBe("done");
    expect(sim.ofType("Launch.partial").at(-1)!.payload.failed).toEqual(["Shield"]);
    expect(sim.ofType("Worker.failed").map((e) => e.worker)).toEqual(["Shield"]);
    // Shield never registered the canonical CA, and nobody else pretended it did.
    expect(sim.ofType("Shield.canonicalRegistered")).toEqual([]);
    expect(state.coinCa).toBeTruthy();
    expect(state.siteUrl).toBeTruthy();
  });

  it("(c) a synchronous throw in start() (Recruiter) fails only that worker", async () => {
    sim = await simulate({
      autopilot: { posts: true },
      patchWorkers: (workers) =>
        workers.map((w) =>
          w.name === "Recruiter"
            ? wrapWorker(w, {
                start: () => {
                  throw new Error("sync boom");
                },
              })
            : w,
        ),
    });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const state = sim.handle.getState();
    expect(failedWorkers(state)).toEqual(["Recruiter"]);
    expect(state.status).toBe("partial");
    expect(sim.ofType("Worker.failed").map((e) => e.worker)).toEqual(["Recruiter"]);
  });

  it("(d) ADVERSARIAL: the Ideator dies (LLM throws) — the launch must still report Launch.failed, not hang", async () => {
    // Launcher waits for Ideator.named + Artist.logoReady, Artist waits for Ideator.named, Builder
    // waits for Launcher.deployed, Trader/Shield/Voice wait for Launcher.deployed or a Launcher
    // failure. If none of those waits race the Ideator's Worker.failed, `settled` never resolves and
    // Launch.failed is never emitted: the user sees a launch that runs forever.
    sim = await simulate({ autopilot: { posts: true }, llm: { fail: new Error("llm down") } });
    await sim.waitFor("Worker.failed", { predicate: (e) => e.worker === "Ideator", timeoutMs: 5000 });
    const outcome = await sim.settledOrTimeout(4000);
    const state = sim.handle.getState();
    expect(failedWorkers(state)).toContain("Ideator");
    expect(outcome, "a launch whose Ideator died must settle").toBe("settled");
    expect(sim.ofType("Launch.failed").length, "Launch.failed must be emitted").toBe(1);
    expect(state.status).toBe("failed");
  });

  it("(f) ADVERSARIAL: the Launcher dies (deploy throws) — the Builder must not wait forever for Launcher.deployed", async () => {
    sim = await simulate({ autopilot: { posts: true }, solana: { deployFail: new Error("deploy rejected by the portal") } });
    const failed = await sim.waitFor("Worker.failed", { predicate: (e) => e.worker === "Launcher", timeoutMs: 10_000 });
    expect(failed.payload.reason).toContain("deploy rejected by the portal");
    // Voice, Trader and Shield race the Launcher's failure and fail honestly...
    for (const w of ["Voice", "Trader", "Shield"] as const) {
      const f = await sim.waitFor("Worker.failed", { predicate: (e) => e.worker === w, timeoutMs: 5000 });
      expect(f.payload.reason, w).toMatch(/Launcher failed/);
    }
    // ...but the Builder (start() awaits Launcher.deployed with no race) never settles, so neither does the launch.
    const outcome = await sim.settledOrTimeout(3000);
    const state = sim.handle.getState();
    expect(state.workers.Builder.status, "Builder must not hang on a dead Launcher").not.toBe("running");
    expect(outcome, "a launch whose Launcher died must settle").toBe("settled");
    expect(sim.ofType("Launch.failed")).toHaveLength(1);
  });

  it("(e) ADVERSARIAL: the Artist dies (every image generation fails) — the Launcher must not wait forever for a logo", async () => {
    sim = await simulate({ autopilot: { posts: true }, imageFail: () => "provider refused" });
    await sim.waitFor("Worker.failed", { predicate: (e) => e.worker === "Artist", timeoutMs: 8000 });
    const outcome = await sim.settledOrTimeout(4000);
    const state = sim.handle.getState();
    expect(failedWorkers(state)).toContain("Artist");
    expect(outcome, "a launch whose Artist died must settle").toBe("settled");
    expect(["failed", "partial"]).toContain(state.status);
  });
});
