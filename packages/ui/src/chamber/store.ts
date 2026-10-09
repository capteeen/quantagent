/**
 * The chamber store: a zustand vanilla store (plus React hook) folded from QuantagentEvents.
 * It is the ONLY input to the scene (SPEC §6.7). No visual exists without an event here.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  WORKER_NAMES,
  type Candidate,
  type QuantagentEvent,
  type QuantumProof,
  type WorkerName,
} from "@quantagent/core/types";
import {
  QSD_CHAINS,
  QSD_DEPTH,
  QSD_LINKS,
  type ChamberActions,
  type ChamberEffect,
  type ChamberSettings,
  type ChamberState,
  type ChamberStoreState,
  type CoreState,
  type EffectKind,
  type QsdState,
  type StrandState,
} from "./types";

/** The vanilla store with its actions also bound on the object, so `store.apply(e)` works outside React. */
export type ChamberStore = StoreApi<ChamberStoreState> & ChamberActions;

export const CORE_ROUGHNESS_CLEAR = 0.05;
export const CORE_ROUGHNESS_CLOUDED = 0.6;

function initialStrand(worker: WorkerName): StrandState {
  return {
    worker,
    status: "pending",
    progressCount: 0,
    pulses: 0,
    candidates: [],
    failed: false,
    sealed: false,
    ignited: false,
  };
}

function initialQsd(): QsdState {
  return {
    links: new Uint8Array(QSD_LINKS),
    linkCount: 0,
    treeLevelsFused: [],
    signStops: new Int16Array(QSD_CHAINS).fill(-1),
    signedCount: 0,
    skipped: false,
  };
}

function initialCore(): CoreState {
  return { roughness: CORE_ROUGHNESS_CLEAR, live: false };
}

export function initialChamberState(settings?: Partial<ChamberSettings>): ChamberState {
  const strands = {} as Record<WorkerName, StrandState>;
  for (const w of WORKER_NAMES) strands[w] = initialStrand(w);
  return {
    phase: "idle",
    lastSeq: -1,
    eventCount: 0,
    strands,
    qsd: initialQsd(),
    core: initialCore(),
    effects: [],
    settings: { reducedMotion: false, perfTier: 0, ...settings },
  };
}

/** Post-launch domain events that belong to a worker strand (coin mode activity), by type prefix. */
const PREFIX_WORKER: Record<string, WorkerName> = {
  Ideator: "Ideator",
  Artist: "Artist",
  Builder: "Builder",
  Launcher: "Launcher",
  Voice: "Voice",
  Trader: "Trader",
  Shield: "Shield",
  Recruiter: "Recruiter",
};

export function workerOfEvent(event: QuantagentEvent): WorkerName | undefined {
  if ("worker" in event && event.worker) return event.worker;
  const p = event.type.split(".")[0] ?? "";
  return PREFIX_WORKER[p];
}

interface Fold {
  state: ChamberState;
  effects: ChamberEffect[];
  nextEffectId: number;
}

/**
 * Pure reducer: fold one event into the chamber state. Returns the new state and the
 * effects the event starts. Exported so tests and the fixture tooling can run it without a store.
 */
export function foldEvent(prev: ChamberState, event: QuantagentEvent, nextEffectId: number): Fold {
  // Idempotent replay: the bus guarantees a monotonic seq per launch.
  if (prev.launchId === event.launchId && event.seq <= prev.lastSeq) {
    return { state: prev, effects: [], nextEffectId };
  }
  const effects: ChamberEffect[] = [];
  let id = nextEffectId;
  const push = (kind: EffectKind, extra: Partial<ChamberEffect> = {}) => {
    effects.push({ id: id++, kind, seq: event.seq, shower: true, ...extra });
  };

  let strands = prev.strands;
  let qsd = prev.qsd;
  let core = prev.core;
  let phase = prev.phase;
  const launchId = prev.launchId ?? event.launchId;

  const patchStrand = (w: WorkerName, patch: Partial<StrandState>) => {
    strands = { ...strands, [w]: { ...strands[w], ...patch } };
  };
  const patchQsd = (patch: Partial<QsdState>) => {
    qsd = { ...qsd, ...patch };
  };
  const patchCore = (patch: Partial<CoreState>) => {
    core = { ...core, ...patch };
  };

  switch (event.type) {
    case "Launch.started": {
      phase = "running";
      for (const w of event.payload.workers) patchStrand(w, { ignited: true });
      push("ignition");
      break;
    }
    case "Launch.live": {
      phase = "live";
      patchCore({ ca: event.payload.coinCa, siteUrl: event.payload.siteUrl, live: true });
      push("convergence");
      break;
    }
    case "Launch.partial": {
      phase = "partial";
      for (const w of event.payload.failed) {
        if (!strands[w].failed) patchStrand(w, { failed: true, status: "failed" });
      }
      break;
    }
    case "Launch.failed": {
      phase = "failed";
      break;
    }
    case "Launch.autopilotChanged":
      break;
    case "Worker.started": {
      patchStrand(event.worker, { status: "running" });
      break;
    }
    case "Worker.progress": {
      const s = strands[event.worker];
      patchStrand(event.worker, {
        progressCount: s.progressCount + 1,
        pulses: s.pulses + 1,
        lastStep: event.payload.step,
        status: s.status === "pending" ? "running" : s.status,
      });
      if (event.worker === "Launcher" && event.payload.step === "qsd-skipped") {
        patchQsd({ skipped: true });
      }
      break;
    }
    case "Worker.candidates": {
      patchStrand(event.worker, { status: "candidates", candidates: event.payload.candidates });
      break;
    }
    case "Worker.awaitingApproval": {
      patchStrand(event.worker, { status: "awaitingApproval", approval: event.payload.approval });
      break;
    }
    case "Worker.approvalResolved": {
      const s = strands[event.worker];
      if (s.status === "awaitingApproval") {
        const { approval: _a, ...rest } = s;
        strands = { ...strands, [event.worker]: { ...rest, status: "running" } };
      }
      break;
    }
    case "Worker.done": {
      patchStrand(event.worker, { status: "done", sealed: true });
      push("ringFlash", { worker: event.worker });
      break;
    }
    case "Worker.failed": {
      patchStrand(event.worker, { status: "failed", failed: true, failReason: event.payload.reason });
      push("failPulse", { worker: event.worker });
      break;
    }
    case "Worker.budgetExceeded":
    case "Worker.spent":
      break;
    case "Orchestrator.collapsed": {
      const w = event.payload.worker;
      const { collapseUnavailable: _u, ...rest } = strands[w];
      strands = {
        ...strands,
        [w]: {
          ...rest,
          status: rest.status === "candidates" ? "running" : rest.status,
          chosen: event.payload.chosen,
          proof: event.payload.proof,
          candidates: event.payload.candidates.length ? event.payload.candidates : rest.candidates,
        },
      };
      push("collapse", { worker: w, chosen: event.payload.chosen, proof: event.payload.proof, shower: true });
      break;
    }
    case "Orchestrator.collapseUnavailable": {
      const w = event.payload.worker;
      patchStrand(w, {
        status: "candidates",
        candidates: event.payload.candidates.length ? event.payload.candidates : strands[w].candidates,
        collapseUnavailable: event.payload.reason,
      });
      break;
    }
    case "Orchestrator.userPicked": {
      const w = event.payload.worker;
      const { collapseUnavailable: _u, ...rest } = strands[w];
      strands = {
        ...strands,
        [w]: { ...rest, status: rest.status === "candidates" ? "running" : rest.status, chosen: event.payload.chosen },
      };
      push("collapse", { worker: w, chosen: event.payload.chosen, shower: false });
      break;
    }
    case "Artist.logoReady": {
      patchCore({ logoUrl: event.payload.asset.url });
      break;
    }
    case "Launcher.qsdStage": {
      const stage = event.payload.stage;
      patchQsd({ stage });
      const detail = event.payload.detail;
      if (stage === "keyGeneration") push("dollyIn");
      if (stage === "anchoring") push("dollyOut");
      if (stage === "superposition" && typeof detail["halfLife"] === "number") {
        patchQsd({ halfLife: detail["halfLife"] as number });
      }
      if (stage === "quantumDraw") {
        const proof = isProof(detail["proof"]) ? detail["proof"] : undefined;
        if (proof) patchQsd({ drawProof: proof });
        push("coreCollapse", proof ? { proof, shower: true } : { shower: true });
      }
      break;
    }
    case "Launcher.chainStep": {
      const { chain, depth } = event.payload;
      if (chain >= 0 && chain < QSD_CHAINS && depth >= 0 && depth < QSD_DEPTH) {
        const i = chain * QSD_DEPTH + depth;
        if (qsd.links[i] !== 1) {
          const links = new Uint8Array(qsd.links);
          links[i] = 1;
          patchQsd({ links, linkCount: qsd.linkCount + 1 });
        }
      }
      break;
    }
    case "Launcher.treeLevelFused": {
      if (!qsd.treeLevelsFused.includes(event.payload.level)) {
        patchQsd({ treeLevelsFused: [...qsd.treeLevelsFused, event.payload.level].sort((a, b) => a - b) });
      }
      break;
    }
    case "Launcher.signChainStop": {
      const { chain, depth } = event.payload;
      if (chain >= 0 && chain < QSD_CHAINS) {
        const signStops = new Int16Array(qsd.signStops);
        const wasSigned = signStops[chain] !== -1;
        signStops[chain] = Math.max(0, Math.min(QSD_DEPTH - 1, depth));
        patchQsd({ signStops, signedCount: qsd.signedCount + (wasSigned ? 0 : 1) });
      }
      break;
    }
    case "Launcher.deployed": {
      patchQsd({ anchorTx: event.payload.txSignature, identityRoot: event.payload.identityRoot });
      patchCore({ ca: event.payload.coinCa });
      break;
    }
    case "Chain.decay": {
      const r = Math.max(CORE_ROUGHNESS_CLEAR, Math.min(CORE_ROUGHNESS_CLOUDED, event.payload.roughness));
      patchCore({ roughness: r, halfLife: event.payload.halfLife });
      break;
    }
    case "Chain.measurement": {
      push("coreCollapse", { proof: event.payload.proof, shower: true });
      break;
    }
    default:
      // Domain events (Voice.posted, Trader.traded, Shield.*, Recruiter.*, Builder.*, Ideator.*,
      // Chain.milestone, Chain.daughterBorn, ...) carry no visual of their own: the worker's
      // Worker.progress event around them is what pulses the strand (§6.7 pulse == progress).
      break;
  }

  const state: ChamberState = {
    ...prev,
    phase,
    launchId,
    lastSeq: prev.launchId === event.launchId ? Math.max(prev.lastSeq, event.seq) : event.seq,
    eventCount: prev.eventCount + 1,
    strands,
    qsd,
    core,
  };
  return { state, effects, nextEffectId: id };
}

function isProof(v: unknown): v is QuantumProof {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as QuantumProof).drawHash === "string" &&
    typeof (v as QuantumProof).selectedIndex === "number"
  );
}

export interface CreateChamberStoreOptions {
  settings?: Partial<ChamberSettings>;
}

export function createChamberStore(opts: CreateChamberStoreOptions = {}): ChamberStore {
  let nextEffectId = 1;
  const api = createStore<ChamberStoreState>((set, get) => ({
    ...initialChamberState(opts.settings),

    apply(event) {
      const prev = get();
      const fold = foldEvent(prev, event, nextEffectId);
      nextEffectId = fold.nextEffectId;
      if (fold.state === prev && fold.effects.length === 0) return;
      set({ ...fold.state, effects: fold.effects.length ? [...prev.effects, ...fold.effects] : prev.effects });
    },

    applyMany(events, o) {
      const prev = get();
      let state: ChamberState = prev;
      let effects: ChamberEffect[] = [];
      for (const e of events) {
        const fold = foldEvent(state, e, nextEffectId);
        nextEffectId = fold.nextEffectId;
        state = fold.state;
        if (!o?.silent) effects = effects.concat(fold.effects);
      }
      if (state === prev && effects.length === 0) return;
      set({ ...state, effects: effects.length ? [...prev.effects, ...effects] : prev.effects });
    },

    reset() {
      const { settings } = get();
      // zustand merges, so the optional keys must be cleared explicitly
      set({ ...initialChamberState(settings), launchId: undefined, selected: undefined });
    },

    takeEffects() {
      const { effects } = get();
      if (effects.length === 0) return effects;
      set({ effects: [] });
      return effects;
    },

    select(worker) {
      if (get().selected === worker) return;
      set({ selected: worker });
    },

    setSettings(patch) {
      set({ settings: { ...get().settings, ...patch } });
    },
  }));
  const bound: ChamberActions = {
    apply: (e) => api.getState().apply(e),
    applyMany: (es, o) => api.getState().applyMany(es, o),
    reset: () => api.getState().reset(),
    takeEffects: () => api.getState().takeEffects(),
    select: (w) => api.getState().select(w),
    setSettings: (p) => api.getState().setSettings(p),
  };
  return Object.assign(api, bound);
}

/** React hook over a chamber store. */
export function useChamber<T>(store: ChamberStore, selector: (s: ChamberStoreState) => T): T {
  return useStore(store, selector);
}

/** A JSON-friendly projection of the state (typed arrays → arrays) for snapshots and debugging. */
export function serializeChamberState(s: ChamberState): Record<string, unknown> {
  return {
    phase: s.phase,
    launchId: s.launchId,
    lastSeq: s.lastSeq,
    eventCount: s.eventCount,
    strands: s.strands,
    qsd: {
      ...s.qsd,
      links: Array.from(s.qsd.links),
      signStops: Array.from(s.qsd.signStops),
    },
    core: s.core,
    effects: s.effects,
    selected: s.selected,
  };
}

/** A strand's chosen candidate label for billboards: label, else a string value, else the id. */
export function candidateLabel(c: Candidate): string {
  if (c.label) return c.label;
  if (typeof c.value === "string") return c.value;
  if (c.value && typeof c.value === "object" && "name" in c.value && typeof (c.value as { name: unknown }).name === "string") {
    return (c.value as { name: string }).name;
  }
  return c.id;
}
