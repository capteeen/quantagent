import { describe, expect, it } from "vitest";
import type { Candidate, QuantagentEvent } from "../types/index";
import { launch, stopLaunch } from "../src/orchestrator/launch";
import { emptyLaunch, rebuild, reduce } from "../src/state/index";
import { connections, firstEvent, liveOverrides, proofFor, quantumClient, recordingX, roster, sleep } from "./helpers";

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

describe("replay fidelity", () => {
  it("rebuild(log) reproduces the live state exactly after a busy launch", async () => {
    const quantum = quantumClient(() => 1);
    const x = recordingX();
    const names: Candidate<string>[] = [
      { id: "n1", value: "Quantum Cat", reason: "trend", label: "Quantum Cat" },
      { id: "n2", value: "Schrödinger", reason: "lore", label: "Schrödinger" },
      { id: "n3", value: "Qubit", reason: "short", label: "Qubit" },
    ];
    const workers = roster({
      ...liveOverrides(),
      Ideator: {
        start: async (ctx) => {
          ctx.spend("tokens", 1200);
          ctx.progress("naming", "drafting five names");
          const { chosen, proof } = await ctx.collapse(names, "three names drafted from the prompt");
          expect(proof?.selectedIndex).toBe(1);
          ctx.emit({
            type: "Ideator.named",
            reason: "collapsed",
            payload: { identity: { name: chosen.value, ticker: "QCAT", lore: "", hook: "", trend: "" } },
          });
          return { name: chosen.value };
        },
      },
      Voice: {
        start: async (ctx) => {
          const deployed = await ctx.waitFor("Launcher.deployed", { timeoutMs: 1000 });
          const ok = await ctx.requireApproval({ actionClass: "posts", title: "post CA", draft: { text: deployed.payload.coinCa }, reason: "CA handshake" });
          const post = await ctx.clients.x!.post({ text: String(ok.draft.text) });
          ctx.emit({ type: "Voice.posted", reason: "CA posted", payload: { postId: post.id, url: post.url, text: post.text, kind: "ca" } });
        },
      },
      Shield: {
        start: async (ctx) => {
          await sleep(5);
          ctx.spend("apiCalls", 3);
          throw new Error("scanner offline");
        },
      },
    });
    const handle = await launch("a quantum cat coin", connections, { autopilot: { posts: true }, devBuySol: 0.5 }, { workers, clients: { quantum, x } });
    const live = await handle.settled;
    expect(live.status).toBe("partial");
    expect(live.workers.Ideator.chosen?.id).toBe("n2");
    expect(live.workers.Ideator.proof?.provider).toBe("test-qrng");
    expect(live.workers.Ideator.outputs).toEqual({ name: "Schrödinger" });
    expect(live.workers.Ideator.used.tokens).toBe(1200);
    expect(live.workers.Shield.used.apiCalls).toBe(3);
    expect(x.posts).toEqual(["CoinCA1111111111111111111111111111111111111"]);

    const log = await handle.bus.log(handle.id);
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1)); // contiguous seq
    const rebuilt = rebuild(log);
    expect(rebuilt).toStrictEqual(live);
    expect(rebuild(log, handle.id)).toStrictEqual(live);
    // JSON round-trip (what Postgres / SSE carry) rebuilds identically too.
    expect(rebuild(JSON.parse(JSON.stringify(log)) as QuantagentEvent[])).toStrictEqual(live);
    await stopLaunch(handle.id);
  });

  it("the reducer is pure: frozen inputs are never mutated and the same log always yields the same state", async () => {
    const handle = await launch("prompt", connections, {}, { workers: roster(liveOverrides()), clients: {} });
    await handle.settled;
    const log = deepFreeze(await handle.bus.log(handle.id));
    let state = deepFreeze(emptyLaunch(handle.id));
    for (const e of log) state = deepFreeze(reduce(state, e)); // would throw in strict mode on mutation
    expect(state).toStrictEqual(handle.getState());
    expect(rebuild(log)).toStrictEqual(rebuild(log));
    await stopLaunch(handle.id);
  });

  it("replays a user pick (QRNG unreachable) with the proof absent, exactly as live", async () => {
    const ids = ["a", "b"];
    const cands: Candidate[] = ids.map((id) => ({ id, value: id, reason: "r" }));
    const workers = roster({
      Artist: { start: async (ctx) => void (await ctx.collapse(cands, "two logos")) },
    });
    const quantum = quantumClient(() => {
      throw new Error("qrng unreachable");
    });
    const handle = await launch("prompt", connections, {}, { workers, clients: { quantum } });
    await firstEvent(handle.bus, handle.id, "Orchestrator.collapseUnavailable");
    handle.userPick("Artist", "b");
    const live = await handle.settled;
    expect(live.workers.Artist.chosen?.id).toBe("b");
    expect(live.workers.Artist.proof).toBeUndefined();
    expect(rebuild(await handle.bus.log(handle.id))).toStrictEqual(live);
    // a proof that was never issued is never in the state
    expect(JSON.stringify(live)).not.toContain(proofFor(ids, 0).drawHash);
    await stopLaunch(handle.id);
  });
});
