/**
 * Shapes the route handlers return and the screens consume. Shared types come
 * from @quantagent/core/types; nothing here duplicates them.
 */
import type { ApprovalRequest, Launch, WorkerName } from "@quantagent/core/types";

export type Cluster = "devnet" | "mainnet-beta";

/** A capability that cannot run here, with the exact text and env vars that would unblock it. */
export interface Unavailable {
  ok: false;
  /** Error class name, e.g. "NotImplemented". */
  name: string;
  /** The exact error message. */
  message: string;
  capability?: string;
  because?: string;
  /** Exact env var names or steps. */
  needs: string[];
}

export interface Available {
  ok: true;
  /** e.g. the provider name. */
  detail?: string;
  /** Honest caveats that do not block the capability. */
  notes?: string[];
}

export type Health = Available | Unavailable;

export type ClientKey = "llm" | "image" | "x" | "solana" | "hosting" | "quantum";

export type ClientHealth = Record<ClientKey, Health>;

export interface CostLine {
  cluster: Cluster;
  /** pump.fun create overhead + priority fee. */
  launchSol: number;
  devBuySol: number;
  /** The Trader's SOL budget for the life of the coin. */
  agentBudgetSol: number;
  /** What the owner funds the agent wallet with. */
  youPaySol: number;
  notes: string[];
}

export type PostLaunchStatus =
  | { status: "pending"; detail: string }
  | { status: "not-started"; detail: string }
  | { status: "starting" }
  | { status: "running"; queueName: string }
  | { status: "unavailable"; error: string; needs: string[] }
  | { status: "failed"; error: string }
  | { status: "stopped" };

export interface LaunchMeta {
  id: string;
  createdAt: string;
  /** Which clients were wired for this launch; an unavailable one names its env vars. */
  clients: ClientHealth;
  postLaunch: PostLaunchStatus;
}

export interface LaunchSummary {
  id: string;
  createdAt: string;
  prompt: string;
  status: Launch["status"];
  coinCa?: string;
  siteUrl?: string;
  agentWallet: string;
  cluster: Cluster;
  startedAt: string;
  pendingApprovals: number;
  failed: WorkerName[];
}

export interface LaunchDetail {
  meta: LaunchMeta;
  state: Launch;
  pendingApprovals: ApprovalRequest[];
  /** Highest seq persisted so far; pass as Last-Event-ID to resume. */
  seq: number;
}

export interface AgentWalletSummary {
  launchId: string;
  address: string;
  cluster: Cluster;
  budgetSol: number;
  usedSol: number;
}

export interface MeReport {
  account: { accountId: string; handle?: string } | null;
  /** Why no account is shown, when the X runtime itself cannot run. */
  accountError?: Unavailable;
  launches: LaunchSummary[];
  wallets: AgentWalletSummary[];
  pendingApprovals: ApprovalRequest[];
}

export interface QueueReport {
  launches: number;
  running: number;
  postLaunch: { launchId: string; status: PostLaunchStatus["status"]; counts?: Record<string, number>; error?: string }[];
}

export interface HostingReport {
  health: Health;
  lastPublished?: { launchId: string; url: string; deployId: string; at: string };
  lastFailure?: { launchId: string; error: string; at: string };
}

export interface StatusReport {
  at: string;
  cluster: Cluster | null;
  clusterError?: Unavailable;
  providers: ClientHealth;
  store: {
    events: "memory" | "postgres";
    stream: "memory" | "redis";
    tokens: "memory" | "postgres" | "unavailable";
    wallets: "memory" | "postgres";
  };
  /** @quantagent/x runtime status, or why it cannot run. */
  x: { ok: true; status: XStatusLike } | Unavailable;
  hosting: HostingReport;
  queue: QueueReport;
  cost: CostLine;
}

/** The parts of @quantagent/x XStatus the screens read; the full object is passed through. */
export interface XStatusLike {
  budget: { used: number; limit: number; resetsAt: string; paused: boolean; percent?: number };
  rateLimit: { global: { available: number; capacity: number }; accounts: Record<string, { available: number; capacity: number }> };
  deadLetters: { count: number; failed: number; items: { id: string; accountId: string; op: string; error: string; status: string; createdAt: string }[] };
  accounts: { accountId: string; handle?: string; expiresAt: string; updatedAt: string }[];
}

export interface DocEntry {
  slug: string;
  file: string;
  title: string;
  html: string;
}

/** The environment as the app reads it: every key optional. `process.env` satisfies it. */
export type Env = Record<string, string | undefined>;
