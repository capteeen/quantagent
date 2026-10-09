/**
 * §9 check 10: REPLAY. Run a full simulated launch, take the bus log, rebuild(log) and
 * assert toStrictEqual with the live state (also after a JSON round trip, and resumed
 * from an SSE cursor). Replay into a fresh chamber store twice: identical snapshots.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reduce, rebuild, emptyLaunch } from "@quantagent/core";
import type { QuantagentEvent } from "@quantagent/core/types";
import { simulate, type Sim } from "./helpers/launch";

let sim: Sim;
let log: QuantagentEvent[];

beforeAll(async () => {
  sim = await simulate({ autopilot: { posts: true }, solana: { qsd: "run" } });
  expect(await sim.settledOrTimeout(25_000)).toBe("settled");
  // A post-launch toggle and a domain event, so replay also carries gate state and late events.
  sim.handle.setAutopilot({ trades: true }, "owner enabled trades after launch");
  log = await sim.log();
});

afterAll(async () => {
  await sim?.stop();
});

describe("a launch's event log reconstructs the state exactly (SPEC §3 EVENT BUS, §9)", () => {
  it("rebuild(log) toStrictEqual live state", () => {
    expect(log.length).toBeGreaterThan(50);
    expect(rebuild(log)).toStrictEqual(sim.handle.getState());
  });

  it("rebuild(JSON.parse(JSON.stringify(log))) toStrictEqual live state", () => {
    const roundTripped = JSON.parse(JSON.stringify(log)) as QuantagentEvent[];
    expect(rebuild(roundTripped)).toStrictEqual(sim.handle.getState());
  });

  it("the log is dense and monotonic in seq, and every event carries a one-line reason", () => {
    log.forEach((e, i) => {
      expect(e.seq).toBe(i + 1);
      expect(e.launchId).toBe(sim.handle.id);
      expect(typeof e.reason).toBe("string");
      expect(e.reason.length).toBeGreaterThan(0);
      expect(e.reason).not.toContain("\n");
    });
  });

  it("the reducer is pure: folding twice from the same inputs gives equal states and never mutates the input", () => {
    const frozen = log.map((e) => Object.freeze(structuredClone(e)));
    const a = frozen.reduce((s, e) => reduce(s, e), emptyLaunch(sim.handle.id));
    const b = frozen.reduce((s, e) => reduce(s, e), emptyLaunch(sim.handle.id));
    expect(a).toStrictEqual(b);
    expect(a).toStrictEqual(sim.handle.getState());
  });

  it("resuming from a cursor (Last-Event-ID) reaches the same state", async () => {
    const half = Math.floor(log.length / 2);
    const prefix = log.slice(0, half);
    const rest = await sim.handle.bus.log(sim.handle.id, prefix.at(-1)!.seq);
    expect(rest.length).toBe(log.length - half);
    expect(rebuild([...prefix, ...rest])).toStrictEqual(sim.handle.getState());
  });

  it("the QSD stages recorded on the log are replayable: 67×16 chain steps, 8 fused levels, 67 sign stops", () => {
    const steps = new Set(log.filter((e) => e.type === "Launcher.chainStep").map((e) => JSON.stringify((e as { payload: unknown }).payload)));
    expect(steps.size).toBe(67 * 16);
    expect(log.filter((e) => e.type === "Launcher.treeLevelFused")).toHaveLength(8);
    expect(log.filter((e) => e.type === "Launcher.signChainStop")).toHaveLength(67);
    expect(log.filter((e) => e.type === "Launcher.qsdStage").map((e) => (e as { payload: { stage: string } }).payload.stage)).toEqual([
      "keyGeneration",
      "merkleTree",
      "superposition",
      "quantumDraw",
      "signing",
      "anchoring",
    ]);
  });
});

type ChamberModule = {
  createChamberStore: () => { getState(): unknown; applyMany(es: readonly QuantagentEvent[], o?: { silent?: boolean }): void };
  serializeChamberState: (s: unknown) => Record<string, unknown>;
};
let chamber: ChamberModule | null = null;
let chamberReason = "";
try {
  const m = (await import(/* @vite-ignore */ "@quantagent/ui")) as Partial<ChamberModule>;
  if (typeof m.createChamberStore === "function") chamber = m as ChamberModule;
  else chamberReason = "@quantagent/ui resolved but exports no createChamberStore";
} catch (err) {
  chamberReason = err instanceof Error ? err.message.split("\n")[0]! : String(err);
}
if (!chamber) console.warn(`[tests] chamber replay SKIPPED: ${chamberReason}`);

describe.skipIf(!chamber)("chamber state replays identically from the same log", () => {
  it("two fresh chamber stores fed the live log give identical snapshots", () => {
    const a = chamber!.createChamberStore();
    const b = chamber!.createChamberStore();
    a.applyMany(log);
    b.applyMany(log);
    const sa = chamber!.serializeChamberState(a.getState());
    expect(sa).toEqual(chamber!.serializeChamberState(b.getState()));
    expect((sa as { phase: string }).phase).toBe("live");
    expect((sa as { qsd: { linkCount: number } }).qsd.linkCount).toBe(67 * 16);
  });
});
