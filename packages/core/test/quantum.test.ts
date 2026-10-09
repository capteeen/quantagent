import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candidate } from "../types/index";
import { launch, stopLaunch } from "../src/orchestrator/launch";
import {
  ForbiddenQuantumProvider,
  assertProofUsable,
  listQuantumProviders,
  registerQuantumProvider,
  unregisterQuantumProvider,
} from "../src/orchestrator/quantum";
import { connections, firstEvent, proofFor, quantumClient, roster } from "./helpers";

const cands: Candidate<string>[] = ["a", "b", "c", "d"].map((id) => ({ id, value: id.toUpperCase(), reason: "r", label: id }));
const PROD = { NODE_ENV: "production" };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("no pseudorandom fallback", () => {
  it("registering a pseudorandom provider in production throws and registers nothing", () => {
    const client = quantumClient(() => 0);
    for (const name of ["pseudo", "mock", "fake", "prng", "Math.random", "random-js", "MOCK-qrng"]) {
      expect(() => registerQuantumProvider(name, client, PROD), name).toThrow(ForbiddenQuantumProvider);
      expect(listQuantumProviders()).not.toContain(name);
    }
    registerQuantumProvider("anu-qrng", client, PROD);
    expect(listQuantumProviders()).toContain("anu-qrng");
    unregisterQuantumProvider("anu-qrng");
  });

  it("a production draw whose proof names a pseudorandom provider is refused: the user picks instead", async () => {
    const quantum = quantumClient((ids) => proofFor(ids, 0, "mock"));
    let result: { chosen: Candidate<string>; proof: unknown } | null = null;
    const workers = roster({ Ideator: { start: async (ctx) => void (result = await ctx.collapse(cands, "names")) } });
    const handle = await launch("prompt", connections, {}, { workers, clients: { quantum }, env: PROD });
    const unavailable = await firstEvent(handle.bus, handle.id, "Orchestrator.collapseUnavailable");
    expect(unavailable.payload.reason).toMatch(/pseudorandom/);
    expect(result).toBeNull();
    expect(() => handle.userPick("Ideator", "zzz")).toThrow(/not in Ideator's pending set/);
    handle.userPick("Ideator", "c");
    const state = await handle.settled;
    expect(result).toEqual({ chosen: cands[2], proof: null });
    expect(state.workers.Ideator.chosen?.id).toBe("c");
    expect(state.workers.Ideator.proof).toBeUndefined();
    expect((await handle.bus.log(handle.id)).some((e) => e.type === "Orchestrator.collapsed")).toBe(false);
    await stopLaunch(handle.id);
  });

  it("assertProofUsable rejects out-of-range or incomplete proofs", () => {
    expect(() => assertProofUsable(proofFor(["a", "b"], 2), 2)).toThrow(/out of range/);
    expect(() => assertProofUsable({ ...proofFor(["a"], 0), attestation: "" }, 1)).toThrow(/missing/);
    expect(() => assertProofUsable(proofFor(["a"], 0, "pseudo"), 1, PROD)).toThrow(ForbiddenQuantumProvider);
    expect(() => assertProofUsable(proofFor(["a"], 0, "pseudo"), 1, { NODE_ENV: "test" })).not.toThrow();
  });

  it("core never calls Math.random on any path", () => {
    const files = walk(join(__dirname, "..", "src")).concat(walk(join(__dirname, "..", "types")));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/Math\s*\.\s*random/);
  });
});

describe("collapse step", () => {
  it("one quantum draw per candidate set, recorded as Orchestrator.collapsed with the proof", async () => {
    const quantum = quantumClient(() => 3);
    let result: { chosen: Candidate<string>; proof: unknown } | null = null;
    const workers = roster({ Ideator: { start: async (ctx) => void (result = await ctx.collapse(cands, "four names")) } });
    const handle = await launch("prompt", connections, {}, { workers, clients: { quantum } });
    const state = await handle.settled;
    expect(quantum.calls).toBe(1);
    const log = await handle.bus.log(handle.id);
    const collapsed = log.find((e) => e.type === "Orchestrator.collapsed");
    if (!collapsed || collapsed.type !== "Orchestrator.collapsed") throw new Error("no collapse event");
    expect(collapsed.payload.worker).toBe("Ideator");
    expect(collapsed.payload.chosen).toEqual(cands[3]);
    expect(collapsed.payload.proof.selectedIndex).toBe(3);
    expect(collapsed.payload.proof.provider).toBe("test-qrng");
    expect(collapsed.payload.candidates).toEqual(cands);
    expect(result).toEqual({ chosen: cands[3], proof: collapsed.payload.proof });
    expect(state.workers.Ideator.proof).toEqual(collapsed.payload.proof);
    expect(state.workers.Ideator.chosen).toEqual(cands[3]);
    expect(state.workers.Ideator.status).toBe("done");
    // the candidates were an event (status "candidates") before the collapse
    expect(log.some((e) => e.type === "Worker.candidates" && e.worker === "Ideator")).toBe(true);
    await stopLaunch(handle.id);
  });

  it("an unreachable QRNG is reported as such, never replaced: collapseUnavailable then the user's pick", async () => {
    const quantum = quantumClient(() => {
      throw new Error("ECONNREFUSED qrng");
    });
    const workers = roster({ Artist: { start: async (ctx) => void (await ctx.collapse(cands.slice(0, 2), "two logos")) } });
    const handle = await launch("prompt", connections, {}, { workers, clients: { quantum } });
    const ev = await firstEvent(handle.bus, handle.id, "Orchestrator.collapseUnavailable");
    expect(ev.payload.reason).toContain("ECONNREFUSED");
    expect(ev.payload.candidates).toEqual(cands.slice(0, 2));
    expect(handle.getState().workers.Artist.status).toBe("candidates");
    const picked = handle.userPick("Artist", "b");
    expect(picked.type).toBe("Orchestrator.userPicked");
    const state = await handle.settled;
    expect(state.workers.Artist.chosen?.id).toBe("b");
    expect(state.workers.Artist.status).toBe("done");
    await stopLaunch(handle.id);
  });

  it("without a QuantumClient the orchestrator says so instead of choosing", async () => {
    const workers = roster({ Ideator: { start: async (ctx) => void (await ctx.collapse(cands, "names")) } });
    const handle = await launch("prompt", connections, {}, { workers, clients: {} });
    const ev = await firstEvent(handle.bus, handle.id, "Orchestrator.collapseUnavailable");
    expect(ev.payload.reason).toContain("no QuantumClient");
    await handle.stop();
    await stopLaunch(handle.id);
  });
});
