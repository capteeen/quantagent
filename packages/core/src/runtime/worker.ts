import type {
  ActionClass,
  ApprovalDecision,
  ApprovalRequest,
  Autopilot,
  Budget,
  BudgetUsage,
  Candidate,
  Connections,
  EmitInput,
  EventType,
  QuantagentEvent,
  QuantumProof,
  WorkerName,
} from "../../types/index";
import type {
  HostingClient,
  ImageClient,
  LlmClient,
  QuantumClient,
  SolanaClient,
  XClient,
} from "../../types/clients";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What a worker passes to ctx.emit: the runtime fills id/launchId/at/seq and `worker`. */
export type CtxEmitInput = DistributiveOmit<EmitInput, "worker">;

/** Clients handed to a worker. `null` when the integrator did not provide one. */
export interface WorkerClients {
  llm: LlmClient | null;
  image: ImageClient | null;
  x: XClient | null;
  solana: SolanaClient | null;
  hosting: HostingClient | null;
  quantum: QuantumClient | null;
}

export type ClientsInput = Partial<{ [K in keyof WorkerClients]: WorkerClients[K] | undefined }>;

export interface ResolvedLaunchOptions {
  autopilot: Autopilot;
  cluster: "devnet" | "mainnet-beta";
  devBuySol: number;
}

export interface ApprovalOutcome {
  /** Id of the ApprovalRequest this outcome answers (also logged on Worker.approvalResolved). */
  approvalId: string;
  actionClass: ActionClass;
  decision: Extract<ApprovalDecision, "approve" | "edit">;
  /** The draft to act on: the original on "approve", the user's edit on "edit". */
  draft: Record<string, unknown>;
  /** "autopilot" when no human tap was needed. */
  via: "tap" | "autopilot";
}

export type ApprovalInput = {
  actionClass: ActionClass;
  title: string;
  draft: Record<string, unknown>;
  reason: string;
};

export interface WorkerContext {
  readonly launchId: string;
  readonly worker: WorkerName;
  readonly prompt: string;
  readonly connections: Connections;
  readonly options: ResolvedLaunchOptions;
  /** Budget-scoped clients; every call counts against this worker's budget. */
  readonly clients: WorkerClients;
  readonly budget: Readonly<Budget>;
  readonly used: Readonly<BudgetUsage>;
  /** Aborted when the worker fails, is stopped, or the launch stops. */
  readonly signal: AbortSignal;
  /** Emit an event on the launch's bus; `worker` is filled in for Worker.* events. */
  emit<E extends CtxEmitInput>(input: E): QuantagentEvent;
  /** Shorthand for Worker.progress. */
  progress(step: string, reason: string, detail?: Record<string, unknown>): QuantagentEvent;
  /** Charge the budget. Throws BudgetExceeded (and fails this worker) when the cap is passed. */
  spend(dimension: keyof Budget, amount: number): void;
  /**
   * Blocks until the user taps approve/edit, or resolves instantly when autopilot
   * is on for the action class. Throws ApprovalDenied on "skip".
   *
   * A resolved approval is a one-shot grant: the next gated client call of that
   * class (x.post / x.thread for "posts" and "recruiting", solana.buy / sell for
   * "trades") consumes it. Without a grant or autopilot those calls throw
   * ApprovalRequired and never reach the provider.
   */
  requireApproval(action: ApprovalInput): Promise<ApprovalOutcome>;
  /**
   * Emit Worker.candidates and wait for the orchestrator's collapse (quantum draw)
   * or the user's pick when the QRNG is unreachable.
   */
  collapse<T>(candidates: Candidate<T>[], reason: string): Promise<{ chosen: Candidate<T>; proof: QuantumProof | null }>;
  /** Wait for an event on this launch (e.g. Launcher.deployed). */
  waitFor<T extends EventType>(
    type: T,
    opts?: { predicate?: (e: Extract<QuantagentEvent, { type: T }>) => boolean; timeoutMs?: number },
  ): Promise<Extract<QuantagentEvent, { type: T }>>;
}

/** What start() may resolve with: outputs recorded on Worker.done (or nothing). */
export type StartResult = void | Record<string, unknown>;

/**
 * A worker. `start` runs immediately at launch and does everything it can from the
 * prompt alone; `on` receives every event of the launch (dependencies are
 * subscriptions, not call order); `stop` is called when the launch is stopped.
 */
export interface Worker {
  readonly name: WorkerName;
  start(ctx: WorkerContext): Promise<StartResult> | StartResult;
  on(event: QuantagentEvent, ctx: WorkerContext): Promise<void> | void;
  stop(): Promise<void> | void;
}

/** Post-launch workers may expose a periodic tick, scheduled by the BullMQ runtime. */
export interface PostLaunchWorker extends Worker {
  tick?(ctx: WorkerContext): Promise<void> | void;
  /** Interval between ticks in ms (default 60s). */
  readonly tickEveryMs?: number;
}

/** The shape of an approval the gate keeps while a tap is pending. */
export interface PendingApproval {
  request: ApprovalRequest;
  resolve(outcome: ApprovalOutcome): void;
  reject(error: Error): void;
}
