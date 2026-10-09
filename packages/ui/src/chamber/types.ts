/**
 * Chamber state types. The store built from these is the ONLY input to the scene.
 * Every field here is derived from a QuantagentEvent (SPEC §6.7) or from a user tap.
 */
import type {
  ApprovalRequest,
  Candidate,
  QsdStage,
  QuantumProof,
  WorkerName,
  WorkerStatus,
} from "@quantagent/core/types";

/** 67 hash chains × 16 links (SPEC §6.5). Never degraded. */
export const QSD_CHAINS = 67;
export const QSD_DEPTH = 16;
export const QSD_LINKS = QSD_CHAINS * QSD_DEPTH;
/** 256 merkle leaves fuse pairwise over 8 levels to one root. */
export const MERKLE_LEAVES = 256;
export const MERKLE_LEVELS = 8;

/** A strand is a worker. "pending" is the strand before Launch.started reaches it. */
export type StrandStatus = WorkerStatus;

export interface StrandState {
  worker: WorkerName;
  status: StrandStatus;
  /** Number of Worker.progress events seen. */
  progressCount: number;
  /** Number of pulses sent core→anchor. Always equals progressCount (§6.7). */
  pulses: number;
  /** Open superposition (fan) while status === "candidates" or collapseUnavailable is set. */
  candidates: Candidate[];
  chosen?: Candidate;
  proof?: QuantumProof;
  approval?: ApprovalRequest;
  failed: boolean;
  failReason?: string;
  /** Anchor sealed with the glass cap (Worker.done). */
  sealed: boolean;
  /** Orchestrator.collapseUnavailable: the fan stays open with this reason and the user picks. */
  collapseUnavailable?: string;
  /** Launch.started → ignition. Set when this strand has been told to ignite. */
  ignited: boolean;
  /** Last step text (for the Html label on tap, never for timing). */
  lastStep?: string;
}

export interface QsdState {
  /** Current QSD stage, undefined before the Launcher reaches QSD. */
  stage?: QsdStage;
  /** 67×16 link flags, index = chain * 16 + depth. 1 = link exists. */
  links: Uint8Array;
  linkCount: number;
  /** Levels fused so far (Launcher.treeLevelFused). Highest fused level is the current tree level. */
  treeLevelsFused: number[];
  /** Per-chain sign stop depth, -1 when not yet signed. */
  signStops: Int16Array;
  signedCount: number;
  /** Superposition parameters from Launcher.qsdStage(superposition).detail. */
  halfLife?: number;
  /** Proof carried on Launcher.qsdStage(quantumDraw).detail.proof, if the Launcher attached it. */
  drawProof?: QuantumProof;
  /** Launcher.deployed */
  anchorTx?: string;
  identityRoot?: string;
  /** The Launcher emitted Worker.progress "qsd-skipped": no handoff, the strand just runs. */
  skipped: boolean;
}

export interface CoreState {
  ca?: string;
  siteUrl?: string;
  /** The coin's own logo (Artist.logoReady). The only texture in the chamber. */
  logoUrl?: string;
  /** Glass roughness of the core: 0.05 clear → 0.6 clouded (Chain.decay). */
  roughness: number;
  live: boolean;
  /** Chain.decay halfLife, shown by the half-life ring in coin mode. */
  halfLife?: number;
}

export type EffectKind =
  | "ignition" // Launch.started: all eight ignite within 100ms
  | "collapse" // Orchestrator.collapsed / userPicked: §6.4 on a strand's fan
  | "coreCollapse" // Launcher.qsdStage(quantumDraw) / Chain.measurement: §6.4 on the core
  | "convergence" // Launch.live: §6.6
  | "ringFlash" // Worker.done: soft ring flash at the anchor
  | "failPulse" // Worker.failed: one red pulse anchor→core, anchor cracks
  | "dollyIn" // Launcher.qsdStage(keyGeneration): 7.5→4.2 over 1.2s
  | "dollyOut"; // Launcher.qsdStage(anchoring): 4.2→7.5 over 1.2s

export interface ChamberEffect {
  id: number;
  kind: EffectKind;
  /** Event seq that produced it. */
  seq: number;
  worker?: WorkerName;
  chosen?: Candidate;
  proof?: QuantumProof;
  /** false for Orchestrator.userPicked: collapse without the photon shower (no entropy was requested). */
  shower: boolean;
}

export type LaunchPhase = "idle" | "running" | "live" | "partial" | "failed";

export interface ChamberSettings {
  reducedMotion: boolean;
  /** Degradation ladder tier 0..5 (perf/degradation.ts). */
  perfTier: number;
}

export interface ChamberState {
  phase: LaunchPhase;
  launchId?: string | undefined;
  /** Last applied seq, for idempotent replay. */
  lastSeq: number;
  eventCount: number;
  strands: Record<WorkerName, StrandState>;
  qsd: QsdState;
  core: CoreState;
  /** Transient queue; the scene drains it with takeEffects(). */
  effects: ChamberEffect[];
  /** Tapped strand (user interaction, not an event). */
  selected?: WorkerName | undefined;
  settings: ChamberSettings;
}

export interface ChamberActions {
  apply(event: import("@quantagent/core/types").QuantagentEvent): void;
  /** silent: fold state without queuing effects (rebuilding from a log on the coin page). */
  applyMany(events: readonly import("@quantagent/core/types").QuantagentEvent[], opts?: { silent?: boolean }): void;
  reset(): void;
  takeEffects(): ChamberEffect[];
  select(worker: WorkerName | undefined): void;
  setSettings(patch: Partial<ChamberSettings>): void;
}

export type ChamberStoreState = ChamberState & ChamberActions;
