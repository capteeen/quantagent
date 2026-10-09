/**
 * §9 check 9: exceed every budget dimension (tokens, apiCalls, sol, deploys) one at a time
 * through the fake clients: that worker fails with Worker.budgetExceeded and the launch
 * survives as partial. Enforcement is in core's scoped clients, not worker discipline.
 */
import { afterEach, describe, expect, it } from "vitest";
import { failedWorkers, type Worker } from "@quantagent/core";
import { WORKER_NAMES } from "@quantagent/core/types";
import { simulate, type Sim } from "./helpers/launch";

let sim: Sim | undefined;
afterEach(async () => {
  await sim?.stop();
  sim = undefined;
});

const candidatesOnX = Array.from({ length: 3 }, (_, i) => ({
  id: `cand-${i}`,
  url: `https://x.com/u${i}/status/${i}`,
  text: `fridge cats quantum ${i}`,
  authorId: `u${i}`,
  createdAt: new Date().toISOString(),
}));

function expectExceeded(s: Sim, worker: (typeof WORKER_NAMES)[number], dimension: "tokens" | "apiCalls" | "sol" | "deploys") {
  const state = s.handle.getState();
  const exceeded = s.ofType("Worker.budgetExceeded").filter((e) => e.worker === worker);
  expect(exceeded, `${worker} Worker.budgetExceeded`).toHaveLength(1);
  expect(exceeded[0]!.payload.dimension).toBe(dimension);
  expect(exceeded[0]!.payload.used).toBeGreaterThan(exceeded[0]!.payload.limit);
  expect(state.workers[worker].status).toBe("failed");
  expect(state.workers[worker].failReason).toContain(`exceeded ${dimension} budget`);
  expect(state.workers[worker].used[dimension]).toBeGreaterThan(state.workers[worker].budget[dimension]);
  expect(failedWorkers(state)).toEqual([worker]);
  expect(state.status).toBe("partial");
  expect(s.ofType("Launch.partial").at(-1)!.payload.failed).toEqual([worker]);
  expect(s.ofType("Worker.failed").filter((e) => e.worker === worker)).toHaveLength(1);
  expect(state.coinCa).toBeTruthy();
}

describe("per-worker budgets fail the worker, never the launch (SPEC §3, §9)", () => {
  it("tokens: the Recruiter's LLM ranking blows a 10-token budget", async () => {
    sim = await simulate({
      autopilot: { posts: true },
      budgets: { Recruiter: { tokens: 10 } },
      llm: { tokensUsed: 50 },
      x: { searchResults: candidatesOnX, users: candidatesOnX.map((p, i) => ({ id: p.authorId, handle: `u${i}`, followers: 500 })) },
    });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    expectExceeded(sim, "Recruiter", "tokens");
    expect(sim.fakes.x.posts.filter((p) => p.replyTo)).toEqual([]); // no outreach went out
  });

  it("apiCalls: the Shield's prompt scan blows a 2-call budget", async () => {
    sim = await simulate({ autopilot: { posts: true }, budgets: { Shield: { apiCalls: 2 } } });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    expectExceeded(sim, "Shield", "apiCalls");
  });

  it("deploys: the Builder's second republish blows a 1-deploy budget", async () => {
    sim = await simulate({ autopilot: { posts: true }, budgets: { Builder: { deploys: 1 } } });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    expectExceeded(sim, "Builder", "deploys");
    expect(sim.fakes.hosting.publishes).toHaveLength(1); // the provider never saw the refused deploy
    expect(sim.ofType("Launch.partial").at(-1)!.reason).toMatch(/Builder/);
  });

  it("sol: a buy through the scoped solana client blows a 0.01 SOL budget (autopilot.trades on)", async () => {
    // The real Trader never buys at launch; a worker in the Trader slot that buys on Launch.live
    // exercises the same scoped client the Trader uses post-launch.
    const buyer: Worker = {
      name: "Trader",
      start: async (ctx) => {
        await ctx.waitFor("Launch.live");
        await ctx.clients.solana!.buy({ coinCa: ctx.launchId, sol: 0.05, slippageBps: 500, reason: "support buy" });
      },
      on: () => {},
      stop: () => {},
    };
    sim = await simulate({
      autopilot: { posts: true, trades: true },
      budgets: { Trader: { sol: 0.01 } },
      patchWorkers: (workers) => workers.map((w) => (w.name === "Trader" ? buyer : w)),
    });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    expectExceeded(sim, "Trader", "sol");
    expect(sim.fakes.solana.buys).toEqual([]); // refused before the provider
  });

  it("sol (Launcher): a dev buy above the Launcher's SOL budget is refused before the deploy and the launch fails honestly", async () => {
    sim = await simulate({ autopilot: { posts: true }, devBuySol: 0.1, budgets: { Launcher: { sol: 0.05 } } });
    await sim.waitFor("Worker.failed", { predicate: (e) => e.worker === "Launcher", timeoutMs: 10_000 });
    const exceeded = sim.ofType("Worker.budgetExceeded").filter((e) => e.worker === "Launcher");
    expect(exceeded).toHaveLength(1);
    expect(exceeded[0]!.payload.dimension).toBe("sol");
    expect(exceeded[0]!.payload).toMatchObject({ limit: 0.05, used: 0.1 });
    expect(sim.fakes.solana.deploys).toEqual([]); // refused before the provider
    expect(sim.handle.getState().coinCa).toBeUndefined();
    // BLOCKING if the next line fails: the Builder waits for Launcher.deployed without racing the
    // Launcher's failure, so the launch never settles and Launch.failed is never emitted.
    expect(await sim.settledOrTimeout(3000), "a launch whose Launcher failed must settle").toBe("settled");
    expect(sim.handle.getState().status).toBe("failed");
    expect(sim.ofType("Launch.failed")).toHaveLength(1);
    expect(sim.ofType("Launch.failed")[0]!.reason).toContain("Launcher");
  });

  it("no worker but the Trader and the Launcher (dev buy) has any SOL by default", async () => {
    sim = await simulate({ autopilot: { posts: true }, devBuySol: 0.1 });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const state = sim.handle.getState();
    for (const w of WORKER_NAMES) {
      if (w === "Trader" || w === "Launcher") continue;
      expect(state.workers[w].budget.sol, w).toBe(0);
      expect(state.workers[w].used.sol, w).toBe(0);
    }
    expect(state.workers.Launcher.budget.sol).toBe(0.1);
    expect(state.workers.Launcher.used.sol).toBe(0.1);
  });

  it("usage is on the log (Worker.spent) so the state carries exactly what was charged", async () => {
    sim = await simulate({ autopilot: { posts: true } });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const state = sim.handle.getState();
    for (const w of WORKER_NAMES) {
      const spent = sim.ofType("Worker.spent").filter((e) => e.worker === w);
      for (const dim of ["tokens", "apiCalls", "sol", "deploys"] as const) {
        const last = [...spent].reverse().find((e) => e.payload.dimension === dim);
        expect(state.workers[w].used[dim], `${w}.${dim}`).toBe(last ? last.payload.used : 0);
      }
    }
    expect(state.workers.Builder.used.deploys).toBe(sim.fakes.hosting.publishes.length);
    expect(state.workers.Artist.used.apiCalls).toBe(sim.fakes.image.calls.length);
  });
});
