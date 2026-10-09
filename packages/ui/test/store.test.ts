import { describe, expect, it } from "vitest";
import { WORKER_NAMES, type QuantagentEvent } from "@quantagent/core/types";
import {
  createChamberStore,
  initialChamberState,
  serializeChamberState,
  foldEvent,
} from "../src/chamber/store";
import { QSD_CHAINS, QSD_DEPTH, QSD_LINKS } from "../src/chamber/types";
import recorded from "../src/fixtures/launch.recorded.json";

const events = recorded as QuantagentEvent[];

describe("chamber store (SPEC §6.7: every visual is driven by a real bus event)", () => {
  it("an empty stream leaves the initial state untouched: nothing moves", () => {
    const store = createChamberStore();
    const before = serializeChamberState(store.getState());
    store.applyMany([]);
    expect(serializeChamberState(store.getState())).toEqual(before);
    expect(serializeChamberState(store.getState())).toEqual(serializeChamberState(initialChamberState()));
    expect(store.getState().effects).toHaveLength(0);
    expect(store.getState().phase).toBe("idle");
    for (const w of WORKER_NAMES) {
      const s = store.getState().strands[w];
      expect(s.status).toBe("pending");
      expect(s.ignited).toBe(false);
      expect(s.pulses).toBe(0);
    }
    expect(store.getState().qsd.linkCount).toBe(0);
  });

  it("has exactly eight strands in the worker order", () => {
    const store = createChamberStore();
    expect(Object.keys(store.getState().strands)).toEqual([...WORKER_NAMES]);
    expect(Object.keys(store.getState().strands)).toHaveLength(8);
  });

  it("the recorded stream folds to a stable snapshot", () => {
    const store = createChamberStore();
    store.applyMany(events);
    const s = store.getState();
    expect(s.phase).toBe("live");
    expect(s.eventCount).toBe(events.length);
    expect(serializeChamberState({ ...s, effects: [] })).toMatchSnapshot();
  });

  it("applying one by one equals applying all at once", () => {
    const a = createChamberStore();
    const b = createChamberStore();
    for (const e of events) a.apply(e);
    b.applyMany(events);
    const sa = serializeChamberState(a.getState());
    const sb = serializeChamberState(b.getState());
    expect(sa).toEqual(sb);
  });

  it("pulse count equals Worker.progress count, per strand and in total", () => {
    const store = createChamberStore();
    store.applyMany(events);
    const s = store.getState();
    let total = 0;
    for (const w of WORKER_NAMES) {
      const progress = events.filter((e) => e.type === "Worker.progress" && e.worker === w).length;
      expect(s.strands[w].pulses).toBe(progress);
      expect(s.strands[w].progressCount).toBe(progress);
      total += progress;
    }
    expect(total).toBe(events.filter((e) => e.type === "Worker.progress").length);
    expect(total).toBeGreaterThan(0);
  });

  it("records 67×16 chain links from Launcher.chainStep", () => {
    const store = createChamberStore();
    store.applyMany(events);
    const q = store.getState().qsd;
    expect(QSD_LINKS).toBe(67 * 16);
    expect(q.links.length).toBe(QSD_LINKS);
    expect(q.linkCount).toBe(QSD_CHAINS * QSD_DEPTH);
    expect(Array.from(q.links).every((v) => v === 1)).toBe(true);
    expect(q.signedCount).toBe(67);
    expect(Array.from(q.signStops).every((d) => d >= 0 && d < 16)).toBe(true);
    expect(q.treeLevelsFused).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(q.stage).toBe("anchoring");
    expect(q.anchorTx).toBeTypeOf("string");
    expect(q.skipped).toBe(false);
  });

  it("ignores out-of-range chain steps and duplicate links", () => {
    const store = createChamberStore();
    const base = events[0]!;
    const mk = (seq: number, chain: number, depth: number): QuantagentEvent =>
      ({ ...base, id: `x${seq}`, seq, type: "Launcher.chainStep", payload: { chain, depth } }) as QuantagentEvent;
    store.applyMany([mk(1, 0, 0), mk(2, 0, 0), mk(3, 67, 0), mk(4, 0, 16), mk(5, -1, 0)]);
    expect(store.getState().qsd.linkCount).toBe(1);
  });

  it("queues exactly one collapse effect per Orchestrator.collapsed, carrying the proof", () => {
    const store = createChamberStore();
    store.applyMany(events);
    const effects = store.getState().effects;
    const collapses = effects.filter((e) => e.kind === "collapse");
    const collapsedEvents = events.filter((e) => e.type === "Orchestrator.collapsed");
    expect(collapses).toHaveLength(collapsedEvents.length);
    expect(collapses.length).toBeGreaterThan(0);
    for (const [i, c] of collapses.entries()) {
      const ev = collapsedEvents[i]!;
      expect(ev.type).toBe("Orchestrator.collapsed");
      if (ev.type !== "Orchestrator.collapsed") throw new Error("unreachable");
      expect(c.worker).toBe(ev.payload.worker);
      expect(c.proof?.drawHash).toBe(ev.payload.proof.drawHash);
      expect(c.chosen?.id).toBe(ev.payload.chosen.id);
      expect(c.shower).toBe(true);
    }
    // the core gets its own 6.4 on the QSD draw and on Chain.measurement
    expect(effects.filter((e) => e.kind === "coreCollapse")).toHaveLength(2);
    expect(effects.filter((e) => e.kind === "ignition")).toHaveLength(1);
    expect(effects.filter((e) => e.kind === "convergence")).toHaveLength(1);
    expect(effects.filter((e) => e.kind === "dollyIn")).toHaveLength(1);
    expect(effects.filter((e) => e.kind === "dollyOut")).toHaveLength(1);
    expect(effects.filter((e) => e.kind === "ringFlash")).toHaveLength(8);
    // takeEffects drains the queue once
    expect(store.getState().takeEffects()).toHaveLength(effects.length);
    expect(store.getState().takeEffects()).toHaveLength(0);
  });

  it("silent replay folds state without effects (rebuilding on the coin page)", () => {
    const store = createChamberStore();
    store.applyMany(events, { silent: true });
    expect(store.getState().effects).toHaveLength(0);
    expect(store.getState().phase).toBe("live");
    expect(store.getState().core.ca).toBeTypeOf("string");
  });

  it("Orchestrator.userPicked collapses without the shower; collapseUnavailable keeps the fan open", () => {
    const store = createChamberStore();
    const base = events[0]!;
    const cands = [
      { id: "a", value: "A", reason: "a" },
      { id: "b", value: "B", reason: "b" },
    ];
    const seqd = (seq: number, e: object): QuantagentEvent => ({ ...base, id: `u${seq}`, seq, ...e }) as QuantagentEvent;
    store.applyMany([
      seqd(1, { type: "Worker.started", worker: "Ideator", payload: {} }),
      seqd(2, { type: "Worker.candidates", worker: "Ideator", payload: { candidates: cands } }),
      seqd(3, { type: "Orchestrator.collapseUnavailable", payload: { worker: "Ideator", candidates: cands, reason: "QRNG unreachable" } }),
    ]);
    let s = store.getState().strands.Ideator;
    expect(s.status).toBe("candidates");
    expect(s.collapseUnavailable).toBe("QRNG unreachable");
    expect(store.getState().effects.filter((e) => e.kind === "collapse")).toHaveLength(0);
    store.apply(seqd(4, { type: "Orchestrator.userPicked", payload: { worker: "Ideator", chosen: cands[1] } }));
    s = store.getState().strands.Ideator;
    expect(s.status).toBe("running");
    expect(s.chosen?.id).toBe("b");
    expect(s.collapseUnavailable).toBeUndefined();
    const c = store.getState().effects.filter((e) => e.kind === "collapse");
    expect(c).toHaveLength(1);
    expect(c[0]!.shower).toBe(false);
    expect(c[0]!.proof).toBeUndefined();
  });

  it("Launcher 'qsd-skipped' progress marks the handoff as skipped and still pulses", () => {
    const store = createChamberStore();
    const base = events[0]!;
    store.apply({ ...base, id: "s1", seq: 1, type: "Worker.started", worker: "Launcher", payload: {} } as QuantagentEvent);
    store.apply({ ...base, id: "s2", seq: 2, type: "Worker.progress", worker: "Launcher", payload: { step: "qsd-skipped" } } as QuantagentEvent);
    expect(store.getState().qsd.skipped).toBe(true);
    expect(store.getState().qsd.stage).toBeUndefined();
    expect(store.getState().strands.Launcher.pulses).toBe(1);
    expect(store.getState().effects.some((e) => e.kind === "dollyIn")).toBe(false);
  });

  it("the core follows the coin: logo, CA, roughness, measurement", () => {
    const store = createChamberStore();
    store.applyMany(events);
    const core = store.getState().core;
    expect(core.logoUrl).toMatch(/^https:\/\//);
    expect(core.live).toBe(true);
    expect(core.ca).toBe(events.find((e) => e.type === "Launch.live")!.payload["coinCa" as never]);
    expect(core.roughness).toBe(0.3);
    expect(core.halfLife).toBe(7200);
  });

  it("failed strands stay failed and crack: Worker.failed → status failed with one failPulse", () => {
    const store = createChamberStore();
    const base = events[0]!;
    store.apply({ ...base, id: "f1", seq: 1, type: "Worker.started", worker: "Trader", payload: {} } as QuantagentEvent);
    store.apply({ ...base, id: "f2", seq: 2, type: "Worker.failed", worker: "Trader", payload: { reason: "rpc down" } } as QuantagentEvent);
    const s = store.getState().strands.Trader;
    expect(s.status).toBe("failed");
    expect(s.failed).toBe(true);
    expect(s.failReason).toBe("rpc down");
    expect(store.getState().effects.filter((e) => e.kind === "failPulse" && e.worker === "Trader")).toHaveLength(1);
  });

  it("reset returns to the initial state and keeps settings", () => {
    const store = createChamberStore({ settings: { reducedMotion: true } });
    store.applyMany(events);
    store.getState().select("Artist");
    store.getState().reset();
    const s = store.getState();
    expect(serializeChamberState(s)).toEqual(serializeChamberState(initialChamberState({ reducedMotion: true })));
    expect(s.settings.reducedMotion).toBe(true);
    expect(s.selected).toBeUndefined();
  });

  it("replaying an already-applied seq is a no-op", () => {
    const store = createChamberStore();
    store.applyMany(events.slice(0, 20));
    const before = serializeChamberState(store.getState());
    store.apply(events[5]!);
    expect(serializeChamberState(store.getState())).toEqual(before);
    const fold = foldEvent(store.getState(), events[5]!, 999);
    expect(fold.effects).toHaveLength(0);
  });
});
