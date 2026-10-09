/**
 * §9 check 3: HUMAN GATE. With approvals off and autopilot off, posting, reaching out and
 * trading is impossible — from inside a worker and by calling the scoped clients directly.
 * The fake provider records zero calls. With autopilot on per class, only that class unlocks.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalRequired, type Worker } from "@quantagent/core";
import { WORKER_NAMES } from "@quantagent/core/types";
import { X_ACCOUNT_ID, CA } from "./helpers/fakes";
import { simulate, type Sim } from "./helpers/launch";

let sim: Sim | undefined;

afterEach(async () => {
  await sim?.stop();
  sim = undefined;
});

/**
 * NOTE (recorded in /docs/audit-log.md): the gated scoped-client methods throw ApprovalRequired
 * SYNCHRONOUSLY from a Promise-returning method (core/src/runtime/scopedClients.ts:78,83,112,118),
 * so a caller using `.catch()` without `await` inside try/catch would crash instead of rejecting.
 * Every assertion below funnels the call through a microtask so both shapes are caught.
 */
const call = <T,>(fn: () => Promise<T>): Promise<T> => Promise.resolve().then(fn);

/** A roster of minimal workers: three of them try to act without approval. Everything else idles. */
function gateBreakers(): Worker[] {
  return WORKER_NAMES.map((name): Worker => {
    switch (name) {
      case "Voice":
        return { name, start: async (ctx) => void (await ctx.clients.x!.post({ text: "gm from an unapproved voice" })), on: () => {}, stop: () => {} };
      case "Recruiter":
        return { name, start: async (ctx) => void (await ctx.clients.x!.post({ text: "join us", replyTo: "post-9" })), on: () => {}, stop: () => {} };
      case "Trader":
        return { name, start: async (ctx) => void (await ctx.clients.solana!.buy({ coinCa: CA, sol: 0.01, slippageBps: 500, reason: "yolo" })), on: () => {}, stop: () => {} };
      default:
        return { name, start: () => ({}), on: () => {}, stop: () => {} };
    }
  });
}

describe("nothing posts, reaches out or trades without approval or autopilot (SPEC §2, §9)", () => {
  it("from inside a worker: x.post / x.post(reply) / solana.buy throw ApprovalRequired and the provider sees zero calls", async () => {
    sim = await simulate({ patchWorkers: () => gateBreakers(), budgets: { Trader: { sol: 1 } } });
    expect(await sim.settledOrTimeout(10_000)).toBe("settled");
    const state = sim.handle.getState();
    for (const w of ["Voice", "Recruiter", "Trader"] as const) {
      expect(state.workers[w].status, w).toBe("failed");
      expect(state.workers[w].failReason, w).toContain("without approval");
      expect(state.workers[w].failReason, w).toMatch(/autopilot\.(posts|trades|recruiting) is off/);
    }
    expect(sim.fakes.x.posts).toEqual([]);
    expect(sim.fakes.x.threads).toEqual([]);
    expect(sim.fakes.solana.buys).toEqual([]);
    expect(sim.fakes.solana.sells).toEqual([]);
    expect(sim.ofType("Worker.awaitingApproval")).toEqual([]);
    expect(sim.ofType("Voice.posted")).toEqual([]);
    expect(sim.ofType("Recruiter.reached")).toEqual([]);
    expect(sim.ofType("Trader.traded")).toEqual([]);
  });

  it("by calling the scoped clients directly: every gated method rejects with ApprovalRequired, nothing reaches the provider", async () => {
    sim = await simulate({ patchWorkers: () => WORKER_NAMES.map((name) => ({ name, start: () => ({}), on: () => {}, stop: () => {} })) });
    expect(await sim.settledOrTimeout(10_000)).toBe("settled");
    const ctx = (w: (typeof WORKER_NAMES)[number]) => sim!.handle.runs.get(w)!.ctx;

    await expect(call(() => ctx("Voice").clients.x!.post({ text: "direct post" }))).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(call(() => ctx("Voice").clients.x!.thread({ posts: [{ text: "a" }, { text: "b" }] }))).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(call(() => ctx("Recruiter").clients.x!.post({ text: "outreach", replyTo: "post-1" }))).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(call(() => ctx("Trader").clients.solana!.buy({ coinCa: CA, sol: 0.01, slippageBps: 500, reason: "r" }))).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(call(() => ctx("Trader").clients.solana!.sell({ coinCa: CA, percent: 50, slippageBps: 500, reason: "r" }))).rejects.toBeInstanceOf(ApprovalRequired);
    // Even workers that should never post get the same gate.
    await expect(call(() => ctx("Ideator").clients.x!.post({ text: "ideator posting" }))).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(call(() => ctx("Shield").clients.solana!.buy({ coinCa: CA, sol: 0.01, slippageBps: 500, reason: "r" }))).rejects.toBeInstanceOf(ApprovalRequired);

    expect(sim.fakes.x.posts).toEqual([]);
    expect(sim.fakes.x.threads).toEqual([]);
    expect(sim.fakes.solana.buys).toEqual([]);
    expect(sim.fakes.solana.sells).toEqual([]);
    expect(sim.handle.pendingApprovals()).toEqual([]);
  });

  it("the error names the worker, the action class and the method, so the log explains the refusal", async () => {
    sim = await simulate({ patchWorkers: () => WORKER_NAMES.map((name) => ({ name, start: () => ({}), on: () => {}, stop: () => {} })) });
    await sim.settledOrTimeout(10_000);
    const err = await call(() => sim!.handle.runs.get("Recruiter")!.ctx.clients.x!.post({ text: "x" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApprovalRequired);
    const ar = err as ApprovalRequired;
    expect(ar.worker).toBe("Recruiter");
    expect(ar.actionClass).toBe("recruiting");
    expect(ar.method).toBe("x.post");
  });

  it("autopilot per class: posts on unlocks only Voice posting; trades on unlocks only trades; recruiting on unlocks only outreach", async () => {
    sim = await simulate({ patchWorkers: () => WORKER_NAMES.map((name) => ({ name, start: () => ({}), on: () => {}, stop: () => {} })) });
    await sim.settledOrTimeout(10_000);
    const ctx = (w: (typeof WORKER_NAMES)[number]) => sim!.handle.runs.get(w)!.ctx;

    sim.handle.setAutopilot({ posts: true });
    await expect(call(() => ctx("Voice").clients.x!.post({ text: "autopilot post" }))).resolves.toMatchObject({ authorId: X_ACCOUNT_ID });
    await expect(call(() => ctx("Recruiter").clients.x!.post({ text: "still gated outreach", replyTo: "p" }))).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(call(() => ctx("Trader").clients.solana!.buy({ coinCa: CA, sol: 0.01, slippageBps: 500, reason: "r" }))).rejects.toBeInstanceOf(ApprovalRequired);
    expect(sim.fakes.x.posts).toHaveLength(1);
    expect(sim.fakes.solana.buys).toHaveLength(0);

    sim.handle.setAutopilot({ posts: false, trades: true });
    await expect(call(() => ctx("Voice").clients.x!.post({ text: "posts off again" }))).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(call(() => ctx("Trader").clients.solana!.buy({ coinCa: CA, sol: 0.01, slippageBps: 500, reason: "r" }))).resolves.toMatchObject({ txSignature: "buy-tx-1" });
    await expect(call(() => ctx("Recruiter").clients.x!.post({ text: "still gated", replyTo: "p" }))).rejects.toBeInstanceOf(ApprovalRequired);
    expect(sim.fakes.x.posts).toHaveLength(1);
    expect(sim.fakes.solana.buys).toHaveLength(1);

    sim.handle.setAutopilot({ trades: false, recruiting: true });
    await expect(call(() => ctx("Recruiter").clients.x!.post({ text: "approved outreach", replyTo: "p" }))).resolves.toMatchObject({ authorId: X_ACCOUNT_ID });
    await expect(call(() => ctx("Voice").clients.x!.post({ text: "voice gated" }))).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(call(() => ctx("Trader").clients.solana!.sell({ coinCa: CA, percent: 10, slippageBps: 500, reason: "r" }))).rejects.toBeInstanceOf(ApprovalRequired);
    expect(sim.fakes.x.posts).toHaveLength(2);

    // Every toggle is on the log, so replay carries the gate state.
    expect(sim.ofType("Launch.autopilotChanged")).toHaveLength(3);
    expect(sim.handle.getState().autopilot).toEqual({ posts: false, trades: false, recruiting: true });
  });

  it("a tapped approval is a one-shot grant: it covers exactly one gated call of its class", async () => {
    sim = await simulate({ patchWorkers: () => WORKER_NAMES.map((name) => ({ name, start: () => ({}), on: () => {}, stop: () => {} })) });
    await sim.settledOrTimeout(10_000);
    const voice = sim.handle.runs.get("Voice")!.ctx;
    const pending = voice.requireApproval({ actionClass: "posts", title: "post once", draft: { text: "once" }, reason: "test" });
    const req = await sim.waitFor("Worker.awaitingApproval", { predicate: (e) => e.worker === "Voice" });
    expect(sim.handle.pendingApprovals().map((a) => a.id)).toEqual([req.payload.approval.id]);
    expect(sim.handle.resolveApproval(req.payload.approval.id, "approve")).toBe(true);
    await pending;
    await expect(call(() => voice.clients.x!.post({ text: "once" }))).resolves.toBeTruthy();
    await expect(call(() => voice.clients.x!.post({ text: "twice" }))).rejects.toBeInstanceOf(ApprovalRequired);
    expect(sim.fakes.x.posts.map((p) => p.text)).toEqual(["once"]);
  });

  it("'skip' denies: the worker gets ApprovalDenied and the provider is never called", async () => {
    sim = await simulate({ patchWorkers: () => WORKER_NAMES.map((name) => ({ name, start: () => ({}), on: () => {}, stop: () => {} })) });
    await sim.settledOrTimeout(10_000);
    const trader = sim.handle.runs.get("Trader")!.ctx;
    const pending = trader.requireApproval({ actionClass: "trades", title: "buy", draft: { sol: 0.01 }, reason: "dip" });
    const req = await sim.waitFor("Worker.awaitingApproval", { predicate: (e) => e.worker === "Trader" });
    sim.handle.resolveApproval(req.payload.approval.id, "skip");
    await expect(pending).rejects.toMatchObject({ name: "ApprovalDenied" });
    await expect(call(() => trader.clients.solana!.buy({ coinCa: CA, sol: 0.01, slippageBps: 500, reason: "r" }))).rejects.toBeInstanceOf(ApprovalRequired);
    expect(sim.fakes.solana.buys).toEqual([]);
  });

  it("the REAL Voice and Recruiter with gates off: they ask (Worker.awaitingApproval) and the provider sees zero posts", async () => {
    const posts = Array.from({ length: 3 }, (_, i) => ({
      id: `cand-${i}`,
      url: `https://x.com/u${i}/status/${i}`,
      text: `fridge cats are the future ${i}`,
      authorId: `u${i}`,
      createdAt: new Date().toISOString(),
    }));
    sim = await simulate({
      x: { searchResults: posts, users: posts.map((p, i) => ({ id: p.authorId, handle: `u${i}`, followers: 1000 * (i + 1) })) },
    });
    // Voice and Recruiter both block on a tap; wait for both cards, then look at the provider.
    await sim.waitFor("Worker.awaitingApproval", { predicate: (e) => e.worker === "Voice", timeoutMs: 20_000 });
    await sim.waitFor("Worker.awaitingApproval", { predicate: (e) => e.worker === "Recruiter", timeoutMs: 20_000 });
    await sim.waitFor("Launcher.deployed", { timeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(sim.fakes.x.posts).toEqual([]);
    expect(sim.fakes.x.threads).toEqual([]);
    expect(sim.fakes.solana.buys).toEqual([]);
    expect(sim.ofType("Voice.posted")).toEqual([]);
    expect(sim.ofType("Recruiter.reached")).toEqual([]);
    const cards = sim.handle.pendingApprovals();
    expect(cards.map((c) => c.actionClass).sort()).toEqual(["posts", "recruiting"]);
    // The pre-drafted cards carry the real draft so approval is one tap, and no foreign CA.
    const voiceCard = cards.find((c) => c.worker === "Voice")!;
    expect(voiceCard.draft).toHaveProperty("kind");
    // The Trader never trades at launch beyond the dev buy, gate or not.
    expect(sim.ofType("Trader.traded")).toEqual([]);
    // The dev buy is part of the launch tap (not gated) and happened exactly once.
    expect(sim.fakes.solana.deploys).toHaveLength(1);
  });
});
