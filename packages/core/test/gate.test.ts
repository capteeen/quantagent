import { describe, expect, it } from "vitest";
import { ApprovalDenied, ApprovalRequired } from "../types/index";
import { launch, stopLaunch } from "../src/orchestrator/launch";
import type { ApprovalOutcome } from "../src/runtime/worker";
import { connections, firstEvent, recordingSolana, recordingX, roster, sleep } from "./helpers";

describe("human gate", () => {
  it("requireApproval blocks until the user taps approve, then the post goes out once", async () => {
    const x = recordingX();
    let outcome: ApprovalOutcome | null = null;
    const workers = roster({
      Voice: {
        start: async (ctx) => {
          outcome = await ctx.requireApproval({ actionClass: "posts", title: "announce", draft: { text: "hello" }, reason: "first post" });
          await ctx.clients.x!.post({ text: String(outcome.draft.text) });
        },
      },
    });
    const handle = await launch("prompt", connections, {}, { workers, clients: { x } });
    const awaiting = await firstEvent(handle.bus, handle.id, "Worker.awaitingApproval");
    await sleep(30);
    expect(outcome).toBeNull(); // still blocked
    expect(x.posts).toEqual([]);
    expect(handle.getState().workers.Voice.status).toBe("awaitingApproval");
    expect(handle.pendingApprovals().map((a) => a.id)).toEqual([awaiting.payload.approval.id]);

    expect(handle.resolveApproval(awaiting.payload.approval.id, "approve")).toBe(true);
    const state = await handle.settled;
    expect(outcome).toMatchObject({ decision: "approve", via: "tap", draft: { text: "hello" }, approvalId: awaiting.payload.approval.id });
    expect(x.posts).toEqual(["hello"]);
    expect(state.workers.Voice.status).toBe("done");
    expect(handle.resolveApproval(awaiting.payload.approval.id, "approve")).toBe(false); // already resolved
    await stopLaunch(handle.id);
  });

  it("\"edit\" hands the worker the edited draft", async () => {
    const x = recordingX();
    const workers = roster({
      Voice: {
        start: async (ctx) => {
          const ok = await ctx.requireApproval({ actionClass: "posts", title: "announce", draft: { text: "draft" }, reason: "r" });
          await ctx.clients.x!.post({ text: String(ok.draft.text) });
        },
      },
    });
    const handle = await launch("prompt", connections, {}, { workers, clients: { x } });
    const awaiting = await firstEvent(handle.bus, handle.id, "Worker.awaitingApproval");
    expect(() => handle.resolveApproval(awaiting.payload.approval.id, "edit")).toThrow(/editedDraft/);
    handle.resolveApproval(awaiting.payload.approval.id, "edit", { text: "edited by user" });
    await handle.settled;
    expect(x.posts).toEqual(["edited by user"]);
    await stopLaunch(handle.id);
  });

  it("resolves instantly when autopilot is on for that action class, and only that class", async () => {
    const x = recordingX();
    const solana = recordingSolana();
    let voiceVia: string | null = null;
    let traderBlocked = false;
    const workers = roster({
      Voice: {
        start: async (ctx) => {
          const ok = await ctx.requireApproval({ actionClass: "posts", title: "announce", draft: {}, reason: "r" });
          voiceVia = ok.via;
          await ctx.clients.x!.post({ text: "auto" });
        },
      },
      Trader: {
        start: async (ctx) => {
          const p = ctx.requireApproval({ actionClass: "trades", title: "buy 0.05", draft: { sol: 0.05 }, reason: "r" });
          traderBlocked = true;
          await p;
          await ctx.clients.solana!.buy({ coinCa: "ca", sol: 0.05, slippageBps: 100, reason: "r" });
        },
      },
    });
    const handle = await launch("prompt", connections, { autopilot: { posts: true }, budgets: { Trader: { sol: 1 } } }, { workers, clients: { x, solana } });
    expect((await firstEvent(handle.bus, handle.id, "Worker.awaitingApproval")).worker).toBe("Trader");
    expect(voiceVia).toBe("autopilot");
    expect(x.posts).toEqual(["auto"]);
    expect(traderBlocked).toBe(true);
    expect(handle.pendingApprovals().map((a) => a.worker)).toEqual(["Trader"]);
    expect(solana.buys).toEqual([]);
    // Toggling autopilot mid-launch is an event; new requests see it, pending ones still need a tap.
    handle.setAutopilot({ trades: true });
    expect(handle.getState().autopilot.trades).toBe(true);
    const [pending] = handle.pendingApprovals();
    handle.resolveApproval(pending!.id, "approve");
    const state = await handle.settled;
    expect(solana.buys).toEqual([0.05]);
    expect(state.workers.Trader.status).toBe("done");
    await stopLaunch(handle.id);
  });

  it("\"skip\" throws ApprovalDenied inside the worker and nothing is posted", async () => {
    const x = recordingX();
    let caught: unknown = null;
    const workers = roster({
      Voice: {
        start: async (ctx) => {
          try {
            await ctx.requireApproval({ actionClass: "posts", title: "announce", draft: {}, reason: "r" });
          } catch (err) {
            caught = err;
            throw err;
          }
          await ctx.clients.x!.post({ text: "never" });
        },
      },
    });
    const handle = await launch("prompt", connections, {}, { workers, clients: { x } });
    const awaiting = await firstEvent(handle.bus, handle.id, "Worker.awaitingApproval");
    handle.resolveApproval(awaiting.payload.approval.id, "skip");
    const state = await handle.settled;
    expect(caught).toBeInstanceOf(ApprovalDenied);
    expect(x.posts).toEqual([]);
    expect(state.workers.Voice.status).toBe("failed");
    expect(state.workers.Voice.failReason).toContain("skipped");
    const resolved = (await handle.bus.log(handle.id)).find((e) => e.type === "Worker.approvalResolved");
    expect(resolved && resolved.type === "Worker.approvalResolved" ? resolved.payload.decision : null).toBe("skip");
    await stopLaunch(handle.id);
  });

  it("a worker that posts without asking cannot: x.post throws ApprovalRequired before the client is reached", async () => {
    const x = recordingX();
    const solana = recordingSolana();
    const errors: Record<string, unknown> = {};
    const workers = roster({
      Voice: {
        start: async (ctx) => {
          try {
            await ctx.clients.x!.post({ text: "sneaky" });
          } catch (err) {
            errors.Voice = err;
            throw err;
          }
        },
      },
      Recruiter: {
        start: async (ctx) => {
          try {
            await ctx.clients.x!.thread({ posts: [{ text: "sneaky outreach" }] });
          } catch (err) {
            errors.Recruiter = err;
            throw err;
          }
        },
      },
      Trader: {
        start: async (ctx) => {
          try {
            await ctx.clients.solana!.buy({ coinCa: "ca", sol: 0.01, slippageBps: 100, reason: "sneaky" });
          } catch (err) {
            errors.Trader = err;
            throw err;
          }
        },
      },
    });
    const handle = await launch("prompt", connections, { budgets: { Trader: { sol: 1 } } }, { workers, clients: { x, solana } });
    const state = await handle.settled;
    expect(x.posts).toEqual([]);
    expect(x.threads).toBe(0);
    expect(solana.buys).toEqual([]);
    for (const w of ["Voice", "Recruiter", "Trader"] as const) {
      expect(errors[w], w).toBeInstanceOf(ApprovalRequired);
      expect(state.workers[w].status, w).toBe("failed");
      expect(state.workers[w].failReason, w).toContain("without approval");
    }
    expect((errors.Voice as ApprovalRequired).actionClass).toBe("posts");
    expect((errors.Recruiter as ApprovalRequired).actionClass).toBe("recruiting");
    expect((errors.Trader as ApprovalRequired).actionClass).toBe("trades");
    // the rest of the launch was untouched
    expect(state.workers.Artist.status).toBe("done");
    await stopLaunch(handle.id);
  });

  it("one approval covers exactly one gated call; autopilot.recruiting does not unlock the Voice", async () => {
    const x = recordingX();
    let second: unknown = null;
    const workers = roster({
      Voice: {
        start: async (ctx) => {
          await ctx.requireApproval({ actionClass: "posts", title: "one", draft: {}, reason: "r" });
          await ctx.clients.x!.post({ text: "first" });
          try {
            await ctx.clients.x!.post({ text: "second" });
          } catch (err) {
            second = err;
          }
        },
      },
      Recruiter: {
        start: async (ctx) => {
          await ctx.clients.x!.post({ text: "outreach on autopilot" }); // autopilot.recruiting is on
        },
      },
    });
    const handle = await launch("prompt", connections, { autopilot: { recruiting: true } }, { workers, clients: { x } });
    const awaiting = await firstEvent(handle.bus, handle.id, "Worker.awaitingApproval");
    expect(awaiting.worker).toBe("Voice");
    handle.resolveApproval(awaiting.payload.approval.id, "approve");
    const state = await handle.settled;
    expect(x.posts.sort()).toEqual(["first", "outreach on autopilot"]);
    expect(second).toBeInstanceOf(ApprovalRequired);
    expect(state.workers.Recruiter.status).toBe("done");
    await stopLaunch(handle.id);
  });

  it("stop() rejects every pending approval so no worker hangs forever", async () => {
    const workers = roster({
      Voice: { start: async (ctx) => void (await ctx.requireApproval({ actionClass: "posts", title: "t", draft: {}, reason: "r" })) },
    });
    const handle = await launch("prompt", connections, {}, { workers, clients: {} });
    await firstEvent(handle.bus, handle.id, "Worker.awaitingApproval");
    await handle.stop();
    expect(handle.pendingApprovals()).toEqual([]);
    await handle.settled;
    expect(handle.getState().workers.Voice.status).not.toBe("done");
    await stopLaunch(handle.id);
  });
});
