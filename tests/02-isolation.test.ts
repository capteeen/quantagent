/**
 * §9 check 2: kill a worker mid-launch. (a) a fake client that throws inside one worker,
 * (b) a worker whose on() throws. The others finish; Launch.partial lists exactly the
 * dead one; nothing else reports as failed. Plus the adversarial case: a dead worker
 * that others depend on must still end in an honest Launch.failed, not a hang.
 */
import { afterEach, describe, expect, it } from "vitest";
import { failedWorkers } from "@quantagent/core";
import { WORKER_NAMES } from "@quantagent/core/types";
import { sleep } from "./helpers/fakes";
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

describe("liveness re-verification: one more adversarial timing per fix (F1/F2 close-out)", () => {
  it("(g) ADVERSARIAL F1: the Launcher dies while the Builder's named republish is still in flight — the coalesced 'launch failed' publish must land and the launch must settle", async () => {
    // The Builder's publish queue coalesces: a trigger that arrives mid-publish is queued and run
    // once the in-flight publish returns. The LauncherFailed path in start() goes through that same
    // queue, so a Launcher that dies while the <ticker> publish is on the wire must not be lost,
    // and every page the host receives from then on must say "launch failed", never "pending".
    let releasePublish!: () => void;
    const launcherFailedSeen = new Promise<void>((r) => (releasePublish = r));
    sim = await simulate({
      autopilot: { posts: true },
      // the first publish at the ticker slug stays on the wire until the Launcher has failed
      hosting: {
        hold: async (input, attempt) => {
          if (!input.slug.startsWith("q-") && attempt === 2) await Promise.race([launcherFailedSeen, sleep(5000)]);
        },
      },
      solana: { deployFail: new Error("portal refused the deploy") },
    });
    const failed = await sim.waitFor("Worker.failed", { predicate: (e) => e.worker === "Launcher", timeoutMs: 10_000 });
    releasePublish();
    const outcome = await sim.settledOrTimeout(8000);
    expect(outcome, "the launch must settle").toBe("settled");

    // Timing proof: the Launcher's failure landed between the Builder's "publish" progress for
    // Ideator.named and that publish's Builder.published.
    const namedPublishStart = sim
      .ofType("Worker.progress")
      .find((e) => e.worker === "Builder" && e.payload.step === "publish" && String(e.payload.detail?.trigger).split("+").includes("Ideator.named"));
    expect(namedPublishStart, "the Builder started a republish for Ideator.named").toBeTruthy();
    const namedPublished = sim.ofType("Builder.published").find((e) => e.payload.trigger.split("+").includes("Ideator.named"));
    expect(namedPublished, "that republish completed").toBeTruthy();
    expect(failed.seq, "Launcher failed after the named publish started").toBeGreaterThan(namedPublishStart!.seq);
    expect(failed.seq, "Launcher failed before the named publish returned").toBeLessThan(namedPublished!.seq);

    const state = sim.handle.getState();
    expect(state.status).toBe("failed");
    expect(sim.ofType("Launch.failed")).toHaveLength(1);
    expect(state.workers.Builder.status, "the Builder finished instead of hanging").toBe("done");
    expect(state.workers.Builder.outputs?.launchFailed).toContain("portal refused the deploy");
    // The queued failure publish ran after the in-flight one...
    const failurePublish = sim.ofType("Builder.published").find((e) => e.payload.trigger.split("+").includes("Launcher.failed"));
    expect(failurePublish, "a Builder.published triggered by Launcher.failed").toBeTruthy();
    expect(failurePublish!.seq).toBeGreaterThan(namedPublished!.seq);
    // ...and from that publish on (the surviving Artist keeps triggering republishes) every page says "launch failed".
    const publishedUrls = sim.ofType("Builder.published").map((e) => e.payload.url);
    const failureIndex = publishedUrls.length - sim.ofType("Builder.published").filter((e) => e.seq >= failurePublish!.seq).length;
    const after = sim.fakes.hosting.publishes.slice(failureIndex);
    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const p of after) {
      expect(p.html).toContain("launch failed");
      expect(p.html).not.toContain("CA: pending launch");
      expect(p.html).not.toContain("https://pump.fun/coin/");
    }
    // No CA was ever announced.
    expect(sim.ofType("Voice.posted").filter((e) => e.payload.kind === "ca")).toEqual([]);
    expect(sim.fakes.x.allTexts().join("\n")).not.toMatch(/CA: [1-9A-HJ-NP-Za-km-z]{32,44}/);
  });

  it("(h) ADVERSARIAL F2: the Ideator dies after Artist.candidates but before Orchestrator.collapsed — the Artist finishes with its drawn logo, the Launcher fails with the reason, the launch settles", async () => {
    // Hold the quantum draw open while the Ideator dies, so the Artist is inside ctx.collapse()
    // (not yet at `await this.named`) when the Worker.failed(Ideator) arrives.
    let releaseLlm!: () => void;
    const artistCandidatesSeen = new Promise<void>((r) => (releaseLlm = r));
    let releaseDraw!: () => void;
    const ideatorFailedSeen = new Promise<void>((r) => (releaseDraw = r));
    sim = await simulate({
      autopilot: { posts: true },
      llm: {
        gate: async (call) => {
          if (/name memecoins/i.test(call.system)) {
            await artistCandidatesSeen;
            throw new Error("llm died mid-launch");
          }
        },
      },
      quantum: {
        gate: async (input) => {
          if (input.context.includes(":Artist:")) await ideatorFailedSeen;
        },
      },
    });
    void sim.waitFor("Worker.candidates", { predicate: (e) => e.worker === "Artist", timeoutMs: 10_000 }).then(() => releaseLlm());
    void sim.waitFor("Worker.failed", { predicate: (e) => e.worker === "Ideator", timeoutMs: 10_000 }).then(() => releaseDraw());

    const outcome = await sim.settledOrTimeout(12_000);
    expect(outcome, "the launch must settle").toBe("settled");

    const candidates = sim.ofType("Worker.candidates").find((e) => e.worker === "Artist")!;
    const ideatorFailed = sim.ofType("Worker.failed").find((e) => e.worker === "Ideator")!;
    const collapsed = sim.ofType("Orchestrator.collapsed").find((e) => e.payload.worker === "Artist")!;
    expect(candidates && ideatorFailed && collapsed, "candidates, Ideator failure and collapse all happened").toBeTruthy();
    expect(ideatorFailed.seq).toBeGreaterThan(candidates.seq);
    expect(collapsed.seq, "the Ideator died while the Artist's collapse was open").toBeGreaterThan(ideatorFailed.seq);

    const state = sim.handle.getState();
    expect(state.status).toBe("failed");
    expect(sim.ofType("Launch.failed")).toHaveLength(1);
    expect(state.workers.Artist.status, "the Artist keeps its prompt-only logo and finishes").toBe("done");
    expect(String(state.workers.Artist.outputs?.incomplete)).toMatch(/Ideator failed before naming the coin/);
    expect(state.workers.Launcher.status).toBe("failed");
    expect(state.workers.Launcher.failReason).toMatch(/Ideator failed before naming the coin/);
    expect(state.workers.Builder.status).toBe("done");
    expect(sim.fakes.solana.deploys).toEqual([]);
    expect(sim.ofType("Artist.logoReady"), "no named logo was ever claimed").toEqual([]);
  });
});
