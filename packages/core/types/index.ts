/**
 * Shared types for quantagent. Every package imports from "@quantagent/core/types".
 * This file is the contract between agents A–G. Change it only with the integrator.
 */

export const WORKER_NAMES = [
  "Ideator",
  "Artist",
  "Builder",
  "Launcher",
  "Voice",
  "Trader",
  "Shield",
  "Recruiter",
] as const;
export type WorkerName = (typeof WORKER_NAMES)[number];

export const WORKER_COLORS: Record<WorkerName, string> = {
  Ideator: "#4DD0E1",
  Artist: "#E91E63",
  Builder: "#FF8A3D",
  Launcher: "#FFFFFF",
  Voice: "#FFB300",
  Trader: "#7CFF6B",
  Shield: "#FF3B30",
  Recruiter: "#B388FF",
};

export type LaunchStatus =
  | "created"
  | "running"
  | "live"
  | "partial" // live but one or more workers failed
  | "failed";

export type WorkerStatus =
  | "pending"
  | "running"
  | "candidates"
  | "awaitingApproval"
  | "done"
  | "failed";

/** Action classes that can be gated by a human tap or an autopilot flag. */
export type ActionClass = "posts" | "trades" | "recruiting";

export interface Autopilot {
  posts: boolean;
  trades: boolean;
  recruiting: boolean;
}

export interface Connections {
  /** X account id the user connected (OAuth 2.0 PKCE on their own account). */
  xAccountId: string;
  /** Owner wallet public key (base58). */
  ownerWallet: string;
}

export interface LaunchOptions {
  autopilot?: Partial<Autopilot>;
  budgets?: Partial<Record<WorkerName, Partial<Budget>>>;
  /** mainnet-beta by default; "devnet" only when asked for explicitly. */
  cluster?: "devnet" | "mainnet-beta";
  /** SOL for the dev buy at launch. */
  devBuySol?: number;
}

export interface Budget {
  /** LLM tokens. */
  tokens: number;
  /** External API calls (X, image provider, RPC, hosting). */
  apiCalls: number;
  /** SOL the worker may spend. */
  sol: number;
  /** Site deploys / republishes. */
  deploys: number;
}

export interface BudgetUsage extends Budget {}

export interface Candidate<T = unknown> {
  id: string;
  value: T;
  /** One-line human reason this candidate exists. */
  reason: string;
  /** Optional thumbnail url for the chamber billboard. */
  thumbnailUrl?: string;
  /** Optional short label for the chamber billboard. */
  label?: string;
}

/** Proof bundle returned by @qsd/quantum for a verifiable draw. */
export interface QuantumProof {
  provider: string;
  /** Hex of the raw entropy used. */
  entropyHex: string;
  /** Provider attestation (signature / certificate / request id), opaque. */
  attestation: string;
  /** Hash of (candidate ids ++ entropy) so the draw is reproducible. */
  drawHash: string;
  requestedAt: string;
  receivedAt: string;
  /** Index selected from the candidate list. */
  selectedIndex: number;
}

export interface WorkerState {
  status: WorkerStatus;
  startedAt?: string;
  doneAt?: string;
  candidates?: Candidate[];
  chosen?: Candidate;
  proof?: QuantumProof;
  outputs: Record<string, unknown>;
  failReason?: string;
  budget: Budget;
  used: BudgetUsage;
}

export interface Launch {
  id: string;
  prompt: string;
  ownerWallet: string;
  xAccountId: string;
  status: LaunchStatus;
  startedAt: string;
  liveAt?: string;
  coinCa?: string;
  siteUrl?: string;
  /** Set by the first Builder.published after Launcher.deployed: the site shows the real CA. */
  siteCaPublishedAt?: string;
  /** Public key of the per-launch agent wallet. */
  agentWallet: string;
  autopilot: Autopilot;
  cluster: "devnet" | "mainnet-beta";
  workers: Record<WorkerName, WorkerState>;
}

/* ───────────────────────────── EVENTS ───────────────────────────── */

export interface Identity {
  name: string;
  ticker: string;
  lore: string;
  hook: string;
  trend: string;
}

export interface ImageAsset {
  url: string;
  kind: "logo" | "banner" | "character" | "og";
  width: number;
  height: number;
  /** Provider job / generation id. */
  externalId: string;
  /** Perceptual hash, hex. */
  phash?: string;
}

export interface Copycat {
  source: "pump.fun" | "x";
  /** Mint address or post id. */
  externalId: string;
  url: string;
  match: "name" | "ticker" | "logo";
  /** 0–1 similarity. */
  score: number;
  seenAt: string;
}

export interface BundleFlag {
  kind: "bundled-launch" | "dev-wallet-anomaly";
  evidence: string;
  txSignatures: string[];
  seenAt: string;
}

export interface ShieldReport {
  canonicalCa: string | null;
  copycats: Copycat[];
  bundleFlags: BundleFlag[];
}

/** QSD launch stages (mirrors qsd-market's LaunchSequence vocabulary). */
export type QsdStage =
  | "keyGeneration"
  | "merkleTree"
  | "superposition"
  | "quantumDraw"
  | "signing"
  | "anchoring";

export interface ApprovalRequest {
  id: string;
  launchId: string;
  worker: WorkerName;
  actionClass: ActionClass;
  /** What will happen if approved, in the user's words. */
  title: string;
  /** Full draft (post text, trade params, outreach reply). */
  draft: Record<string, unknown>;
  /** One-line reason. */
  reason: string;
  createdAt: string;
}

export type ApprovalDecision = "approve" | "edit" | "skip";

/**
 * Every event has `type`, `launchId`, `at`, and `reason` (one human line).
 * `payload` is typed per event below.
 */
interface Base<T extends string, P> {
  id: string;
  type: T;
  launchId: string;
  at: string; // ISO
  seq: number; // monotonic per launch
  reason: string;
  payload: P;
}

type WorkerEvt<T extends string, P> = Base<T, P> & { worker: WorkerName };

export type QuantagentEvent =
  | Base<
      "Launch.started",
      {
        prompt: string;
        workers: WorkerName[];
        /** Seed fields so rebuild(events) reconstructs a Launch from its log alone. */
        ownerWallet?: string;
        xAccountId?: string;
        agentWallet?: string;
        autopilot?: Autopilot;
        cluster?: "devnet" | "mainnet-beta";
        budgets?: Partial<Record<WorkerName, Budget>>;
      }
    >
  | Base<"Launch.live", { coinCa: string; siteUrl: string }>
  | Base<"Launch.failed", { reason: string }>
  | Base<"Launch.partial", { failed: WorkerName[] }>
  /** The user toggled a per-coin autopilot flag; logged so replay carries the gate state. */
  | Base<"Launch.autopilotChanged", { autopilot: Autopilot }>
  | WorkerEvt<"Worker.started", Record<string, never>>
  | WorkerEvt<"Worker.progress", { step: string; detail?: Record<string, unknown> }>
  | WorkerEvt<"Worker.candidates", { candidates: Candidate[] }>
  | WorkerEvt<"Worker.awaitingApproval", { approval: ApprovalRequest }>
  | WorkerEvt<"Worker.approvalResolved", { approvalId: string; decision: ApprovalDecision }>
  | WorkerEvt<"Worker.done", { outputs: Record<string, unknown> }>
  | WorkerEvt<"Worker.failed", { reason: string }>
  | WorkerEvt<"Worker.budgetExceeded", { dimension: keyof Budget; limit: number; used: number }>
  /** Emitted by ctx.spend so WorkerState.used is replayable from the log. */
  | WorkerEvt<"Worker.spent", { dimension: keyof Budget; amount: number; used: number; limit: number }>
  | Base<
      "Orchestrator.collapsed",
      { worker: WorkerName; chosen: Candidate; proof: QuantumProof; candidates: Candidate[] }
    >
  | Base<
      "Orchestrator.collapseUnavailable",
      { worker: WorkerName; candidates: Candidate[]; reason: string }
    >
  | Base<"Orchestrator.userPicked", { worker: WorkerName; chosen: Candidate }>
  // Ideator
  | Base<"Ideator.named", { identity: Identity }>
  | Base<"Ideator.angles", { angles: string[] }>
  // Artist
  | Base<"Artist.logoReady", { asset: ImageAsset }>
  | Base<"Artist.bannerReady", { asset: ImageAsset }>
  | Base<"Artist.imageReady", { asset: ImageAsset }>
  | Base<"Artist.generationFailed", { brief: string; error: string }>
  // Builder
  | Base<"Builder.published", { url: string; deployId: string; trigger: string }>
  | Base<"Builder.patchFailed", { trigger: string; error: string }>
  | Base<"Builder.needsAsset", { brief: string }>
  // Launcher / QSD
  | Base<"Launcher.qsdStage", { stage: QsdStage; detail: Record<string, unknown> }>
  | Base<"Launcher.chainStep", { chain: number; depth: number }>
  | Base<"Launcher.treeLevelFused", { level: number }>
  | Base<"Launcher.signChainStop", { chain: number; depth: number }>
  | Base<"Launcher.deployed", { coinCa: string; txSignature: string; identityRoot: string }>
  | Base<"Launcher.devBuy", { txSignature: string; sol: number }>
  // Voice
  | Base<"Voice.posted", { postId: string; url: string; text: string; kind: "thread" | "ca" | "reply" | "image" | "milestone" | "flag" }>
  | Base<"Voice.postFailed", { text: string; error: string }>
  | Base<"Voice.needsAngle", { mentions: number; engagement: number }>
  | Base<"Voice.needsImage", { brief: string }>
  | Base<"Voice.profileUpdated", { avatar: boolean; banner: boolean }>
  // Trader
  | Base<"Trader.traded", { side: "buy" | "sell"; sol: number; txSignature: string; price?: number }>
  | Base<"Trader.rejected", { side: "buy" | "sell"; sol: number; reason: string }>
  // Shield
  | Base<"Shield.canonicalRegistered", { coinCa: string }>
  | Base<"Shield.copycatFound", { copycat: Copycat }>
  | Base<"Shield.bundleFlag", { flag: BundleFlag }>
  | Base<"Shield.report", { report: ShieldReport }>
  // Recruiter
  | Base<"Recruiter.found", { accounts: { id: string; handle: string; reach: number; relevance: number }[] }>
  | Base<"Recruiter.reached", { accountId: string; postId: string; text: string }>
  | Base<"Recruiter.capped", { cap: number; windowMs: number }>
  // Chain
  | Base<"Chain.milestone", { kind: "mcap" | "holders"; value: number }>
  | Base<"Chain.decay", { roughness: number; halfLife: number }>
  | Base<"Chain.measurement", { proof: QuantumProof }>
  | Base<"Chain.daughterBorn", { parentCa: string; daughterCa: string }>;

export type EventType = QuantagentEvent["type"];
export type EventOf<T extends EventType> = Extract<QuantagentEvent, { type: T }>;

/** What a worker provides when emitting: everything but the bus-assigned fields. */
export type EmitInput<E extends QuantagentEvent = QuantagentEvent> = E extends unknown
  ? Omit<E, "id" | "launchId" | "at" | "seq">
  : never;

/* ───────────────────────────── ERRORS ───────────────────────────── */

/** Thrown when a spec'd capability cannot run yet (missing key, unlinked repo). Never silently faked. */
export class NotImplemented extends Error {
  override readonly name = "NotImplemented";
  constructor(
    public readonly capability: string,
    public readonly because: string,
    /** Exact env vars or steps that would unblock it. */
    public readonly needs: string[] = [],
  ) {
    super(`${capability}: ${because}${needs.length ? ` (needs: ${needs.join(", ")})` : ""}`);
  }
}

export class BudgetExceeded extends Error {
  override readonly name = "BudgetExceeded";
  constructor(
    public readonly worker: WorkerName,
    public readonly dimension: keyof Budget,
    public readonly limit: number,
    public readonly used: number,
  ) {
    super(`${worker} exceeded ${dimension} budget: ${used}/${limit}`);
  }
}

export class ApprovalDenied extends Error {
  override readonly name = "ApprovalDenied";
  constructor(public readonly approvalId: string) {
    super(`approval ${approvalId} was skipped`);
  }
}

/**
 * Thrown by a scoped client (x.post / x.thread / solana.buy / solana.sell) when a
 * worker calls it without a tapped approval or an enabled autopilot flag for the
 * action class. The gate is enforced in core, not by worker discipline.
 */
export class ApprovalRequired extends Error {
  override readonly name = "ApprovalRequired";
  constructor(
    public readonly worker: WorkerName,
    public readonly actionClass: ActionClass,
    public readonly method: string,
  ) {
    super(`${worker} called ${method} without approval: autopilot.${actionClass} is off and no approved request is pending`);
  }
}
