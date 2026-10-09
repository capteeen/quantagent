/**
 * The scene runtime: mutable, frame-rate-independent transition clocks that effect
 * components START (from store effects) and scene components READ in useFrame.
 * React state stays small; nothing here is a timeline, every start comes from an event.
 */
import { createContext, useContext, type MutableRefObject } from "react";
import { Vector3 } from "three";
import { WORKER_NAMES, type Candidate, type QuantumProof, type WorkerName } from "@quantagent/core/types";
import type { ChamberStore } from "../store";
import type { ChamberSound } from "../sound";
import type { PerfSettings } from "../perf/degradation";
import { CAMERA_DISTANCE_FAR } from "../layout";

export interface Transition {
  from: number;
  to: number;
  start: number;
  duration: number;
}

export interface StrandRuntime {
  /** performance.now() when ignition started; undefined before Launch.started. */
  ignitedAt?: number;
  /** Pulse spawn times (ms); consumed into live packets by the pulse stream. */
  pulseSpawns: number[];
  /** Pulses the pulse stream has already turned into packets. */
  consumedPulses: number;
  /** Pulses that reached the anchor (cumulative anchor glow). */
  arrived: number;
  /** Worker.done */
  doneAt?: number;
  /** Worker.failed */
  failedAt?: number;
  /** Launch.live: the final anchor→core pulse start. */
  finalPulseAt?: number | undefined;
  /** Launch.live + 1500ms: idle shimmer. */
  relaxed: boolean;
  /** Fan open time (Worker.candidates). */
  fanAt?: number;
  /** Current collapse on this strand. */
  collapse?: ActiveCollapse | undefined;
  /** Smoothed selection factor (1.5 selected / 0.6 others / 1). */
  selectFactor: number;
}

export interface ActiveCollapse {
  id: number;
  start: number;
  shower: boolean;
  chosen?: Candidate;
  proof?: QuantumProof;
  /** Frames rendered since the snap (for the 2-frame core flash). */
  framesSinceSnap: number;
  snapFrame?: number;
}

export interface CoreRuntime {
  /** 6.4 applied on the core (QSD draw, Chain.measurement). */
  collapse?: ActiveCollapse | undefined;
  /** Launch.live */
  convergenceAt?: number;
  /** Frame index until which the core shows a white flash. */
  flashUntilFrame: number;
}

export interface FxRuntime {
  /** Chamber brightness multiplier (0.4 while a collapse dims it). */
  brightness: number;
  /** Chromatic aberration offset for this frame. */
  aberration: number;
  /** Camera distance transition (dolly). */
  dolly: Transition | null;
  distance: number;
  /** Worker.done ring flashes keyed by worker: start time. */
  ringFlash: Partial<Record<WorkerName, number>>;
  /** Worker.failed red pulse anchor→core: start time. */
  failPulse: Partial<Record<WorkerName, number>>;
}

export interface Runtime {
  now(): number;
  frame: number;
  strands: Record<WorkerName, StrandRuntime>;
  core: CoreRuntime;
  fx: FxRuntime;
  /** Shared scratch vectors so useFrame never allocates. */
  v1: Vector3;
  v2: Vector3;
  v3: Vector3;
}

export function createRuntime(now: () => number = () => performance.now()): Runtime {
  const strands = {} as Record<WorkerName, StrandRuntime>;
  for (const w of WORKER_NAMES) {
    strands[w] = { pulseSpawns: [], consumedPulses: 0, arrived: 0, relaxed: false, selectFactor: 1 };
  }
  return {
    now,
    frame: 0,
    strands,
    core: { flashUntilFrame: -1 },
    fx: { brightness: 1, aberration: 0, dolly: null, distance: CAMERA_DISTANCE_FAR, ringFlash: {}, failPulse: {} },
    v1: new Vector3(),
    v2: new Vector3(),
    v3: new Vector3(),
  };
}

export interface ChamberContextValue {
  store: ChamberStore;
  runtime: MutableRefObject<Runtime>;
  perf: PerfSettings;
  reducedMotion: boolean;
  /** "spec": camera (0,1.2,7.5) fov 38 verbatim. "fit": on portrait viewports pull back until the anchor ring is in frame. */
  framing: "spec" | "fit";
  sound: ChamberSound | null;
  sequences: SequenceStore;
  onTapWorker?: ((worker: WorkerName) => void) | undefined;
  onTapProof?: ((worker: WorkerName | "core", proof: QuantumProof) => void) | undefined;
}

export const ChamberContext = createContext<ChamberContextValue | null>(null);

export function useChamberContext(): ChamberContextValue {
  const v = useContext(ChamberContext);
  if (!v) throw new Error("Chamber scene components must be rendered inside <Chamber />");
  return v;
}

/* ───────────── active effect sequences (React-mounted: they carry DOM labels) ───────────── */

import { createStore, type StoreApi } from "zustand/vanilla";

export interface ActiveSequences {
  /** §6.4 running on a strand's fan, by worker. */
  collapses: Partial<Record<WorkerName, ActiveCollapse>>;
  /** §6.4 running on the core. */
  coreCollapse?: ActiveCollapse | undefined;
  /** §6.6 */
  convergence?: { id: number; start: number } | undefined;
  /** Launcher strand sealed (QSD anchoring finished). */
  set(patch: Partial<Omit<ActiveSequences, "set">>): void;
}

export type SequenceStore = StoreApi<ActiveSequences>;

export function createSequenceStore(): SequenceStore {
  return createStore<ActiveSequences>((set) => ({
    collapses: {},
    set: (patch) => set(patch),
  }));
}
