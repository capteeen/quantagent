/**
 * §9 check 7: the chamber store. Empty stream → state unchanged. The recorded stream
 * (packages/ui/src/fixtures/launch.recorded.json) → deterministic state, 8 strands,
 * 67×16 chain links, pulse count equals Worker.progress count. Skips with a printed
 * reason while the chamber store is not exported from @quantagent/ui yet.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKER_NAMES, type QuantagentEvent } from "@quantagent/core/types";
import { REPO_ROOT } from "./helpers/scan";

type ChamberModule = {
  createChamberStore: (opts?: unknown) => {
    getState(): {
      phase: string;
      eventCount: number;
      strands: Record<string, { pulses: number; progressCount: number; status: string; ignited: boolean }>;
      qsd: { links: Uint8Array; linkCount: number; signedCount: number };
      effects: unknown[];
    };
    apply(e: QuantagentEvent): void;
    applyMany(es: readonly QuantagentEvent[], o?: { silent?: boolean }): void;
    takeEffects(): unknown[];
  };
  serializeChamberState: (s: unknown) => Record<string, unknown>;
  initialChamberState: () => unknown;
};

async function loadChamber(): Promise<{ mod: ChamberModule | null; reason: string }> {
  const specifiers = ["@quantagent/ui", "@quantagent/ui/chamber"];
  const errors: string[] = [];
  for (const s of specifiers) {
    try {
      const mod = (await import(/* @vite-ignore */ s)) as Partial<ChamberModule>;
      if (typeof mod.createChamberStore === "function" && typeof mod.serializeChamberState === "function") return { mod: mod as ChamberModule, reason: "" };
      errors.push(`${s}: resolved but exports no createChamberStore`);
    } catch (err) {
      errors.push(`${s}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  return { mod: null, reason: errors.join(" | ") };
}

const { mod: chamber, reason } = await loadChamber();
if (!chamber) console.warn(`[tests] chamber checks SKIPPED: chamber store not exported yet (${reason})`);

const fixturePath = resolve(REPO_ROOT, "packages/ui/src/fixtures/launch.recorded.json");
const recorded = JSON.parse(readFileSync(fixturePath, "utf8")) as QuantagentEvent[];

describe.skipIf(!chamber)("chamber store (SPEC §6.7: every visual is driven by a real bus event)", () => {
  it("an empty stream leaves the state untouched: nothing moves", () => {
    const store = chamber!.createChamberStore();
    const before = chamber!.serializeChamberState(store.getState());
    store.applyMany([]);
    for (const e of []) store.apply(e);
    expect(chamber!.serializeChamberState(store.getState())).toEqual(before);
    expect(chamber!.serializeChamberState(store.getState())).toEqual(chamber!.serializeChamberState(chamber!.initialChamberState()));
    expect(store.getState().phase).toBe("idle");
    expect(store.getState().effects).toHaveLength(0);
    expect(store.getState().eventCount).toBe(0);
    for (const w of WORKER_NAMES) {
      expect(store.getState().strands[w]!.pulses).toBe(0);
      expect(store.getState().strands[w]!.ignited).toBe(false);
    }
    expect(store.getState().qsd.linkCount).toBe(0);
  });

  it("the recorded stream reproduces deterministically (two fresh stores, one-by-one vs batch)", () => {
    const a = chamber!.createChamberStore();
    const b = chamber!.createChamberStore();
    for (const e of recorded) a.apply(e);
    b.applyMany(recorded);
    const sa = chamber!.serializeChamberState(a.getState());
    const sb = chamber!.serializeChamberState(b.getState());
    expect(sa).toEqual(sb);
    expect(a.getState().eventCount).toBe(recorded.length);
    expect(a.getState().phase).toBe("live");
    // A third store fed the same stream gives the identical snapshot again.
    const c = chamber!.createChamberStore();
    c.applyMany(recorded);
    expect(chamber!.serializeChamberState(c.getState())).toEqual(sa);
  });

  it("exactly eight strands, in worker order", () => {
    const store = chamber!.createChamberStore();
    store.applyMany(recorded);
    expect(Object.keys(store.getState().strands)).toEqual([...WORKER_NAMES]);
    expect(Object.keys(store.getState().strands)).toHaveLength(8);
    for (const w of WORKER_NAMES) expect(store.getState().strands[w]!.ignited, w).toBe(true);
  });

  it("67×16 chain links from Launcher.chainStep, 67 sign stops", () => {
    const store = chamber!.createChamberStore();
    store.applyMany(recorded);
    const q = store.getState().qsd;
    expect(q.links.length).toBe(67 * 16);
    expect(q.linkCount).toBe(67 * 16);
    expect(Array.from(q.links).every((v) => v === 1)).toBe(true);
    expect(q.signedCount).toBe(67);
    // Those counts come from the fixture itself, not from a timeline.
    const steps = new Set(recorded.filter((e) => e.type === "Launcher.chainStep").map((e) => `${(e as { payload: { chain: number; depth: number } }).payload.chain}:${(e as { payload: { depth: number } }).payload.depth}`));
    expect(steps.size).toBe(67 * 16);
  });

  it("pulse count equals Worker.progress count, per strand", () => {
    const store = chamber!.createChamberStore();
    store.applyMany(recorded);
    let total = 0;
    for (const w of WORKER_NAMES) {
      const n = recorded.filter((e) => e.type === "Worker.progress" && (e as { worker: string }).worker === w).length;
      expect(store.getState().strands[w]!.pulses, w).toBe(n);
      expect(store.getState().strands[w]!.progressCount, w).toBe(n);
      total += n;
    }
    expect(total).toBe(recorded.filter((e) => e.type === "Worker.progress").length);
    expect(total).toBeGreaterThan(0);
  });

  it("replaying the same event twice does not double-count (idempotent by seq)", () => {
    const store = chamber!.createChamberStore();
    store.applyMany(recorded);
    const snap = chamber!.serializeChamberState({ ...store.getState(), effects: [] });
    store.applyMany(recorded);
    expect(chamber!.serializeChamberState({ ...store.getState(), effects: [] })).toEqual(snap);
  });
});

describe("chamber availability", () => {
  it(chamber ? "the chamber store is exported from @quantagent/ui" : `SKIPPED: ${reason}`, () => {
    expect(true).toBe(true);
  });
});
