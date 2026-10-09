import { describe, expect, it } from "vitest";
import { launch, stopLaunch } from "../src/orchestrator/launch";
import { connections, roster, sleep } from "./helpers";

const CA = "CoinCA1111111111111111111111111111111111111";

describe("CA handshake plumbing", () => {
  it("Builder, Voice and Shield all receive Launcher.deployed within 50ms, independently", async () => {
    let deployedAt = 0;
    const receivedAt: Record<string, number> = {};
    const reactions: string[] = [];
    const workers = roster({
      Launcher: {
        start: async (ctx) => {
          await sleep(10); // the other three are already listening
          deployedAt = performance.now();
          ctx.emit({ type: "Launcher.deployed", reason: "pump.fun confirmed", payload: { coinCa: CA, txSignature: "sig", identityRoot: "root" } });
        },
      },
      Builder: {
        start: async (ctx) => {
          const e = await ctx.waitFor("Launcher.deployed", { timeoutMs: 1000 });
          receivedAt.Builder = performance.now();
          reactions.push("Builder");
          ctx.emit({ type: "Builder.published", reason: "CA block patched", payload: { url: "https://coin.quantagent.site", deployId: "d2", trigger: e.type } });
        },
      },
      Voice: {
        on: (e, ctx) => {
          if (e.type !== "Launcher.deployed") return;
          receivedAt.Voice = performance.now();
          reactions.push("Voice");
          ctx.progress("ca-post", "drafted CA post, awaiting tap", { coinCa: e.payload.coinCa });
        },
      },
      Shield: {
        on: (e, ctx) => {
          if (e.type !== "Launcher.deployed") return;
          receivedAt.Shield = performance.now();
          reactions.push("Shield");
          ctx.emit({ type: "Shield.canonicalRegistered", reason: "canonical CA for copycat comparison", payload: { coinCa: e.payload.coinCa } });
        },
      },
    });
    const handle = await launch("prompt", connections, {}, { workers, clients: {} });
    const state = await handle.settled;
    for (const w of ["Builder", "Voice", "Shield"]) {
      expect(receivedAt[w], w).toBeDefined();
      expect(receivedAt[w]! - deployedAt, `${w} latency`).toBeLessThan(50);
    }
    expect(reactions.sort()).toEqual(["Builder", "Shield", "Voice"]);
    expect(state.status).toBe("live");
    expect(state.coinCa).toBe(CA);
    expect(state.siteUrl).toBe("https://coin.quantagent.site");

    const log = await handle.bus.log(handle.id);
    const types = log.map((e) => e.type);
    expect(types.indexOf("Launcher.deployed")).toBeLessThan(types.indexOf("Shield.canonicalRegistered"));
    expect(types.indexOf("Builder.published")).toBeLessThan(types.indexOf("Launch.live"));
    const live = log.find((e) => e.type === "Launch.live");
    expect(live && live.type === "Launch.live" ? live.payload : null).toEqual({ coinCa: CA, siteUrl: "https://coin.quantagent.site" });
    await stopLaunch(handle.id);
  });

  it("three external subscribers (SSE consumers, chamber) see Launcher.deployed within 50ms too", async () => {
    const workers = roster({
      Launcher: {
        start: (ctx) => void ctx.emit({ type: "Launcher.deployed", reason: "r", payload: { coinCa: CA, txSignature: "s", identityRoot: "i" } }),
      },
    });
    const bus = (await launch("warm-up", connections, {}, { workers: roster(), clients: {} })).bus;
    const seen: number[] = [];
    const unsubs = [1, 2, 3].map(() => bus.subscribe(() => seen.push(performance.now()), { types: ["Launcher.deployed"] }));
    const t0 = performance.now();
    const handle = await launch("prompt", connections, {}, { workers, clients: {}, bus });
    await handle.settled;
    expect(seen).toHaveLength(3);
    for (const t of seen) expect(t - t0).toBeLessThan(50);
    for (const u of unsubs) u();
    await stopLaunch(handle.id);
  });
});
