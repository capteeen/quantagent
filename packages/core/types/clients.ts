/**
 * Scoped client interfaces handed to workers through ctx.
 * Implementations live in @quantagent/x (XClient), @quantagent/solana (SolanaClient),
 * and provider adapters in @quantagent/workers (LlmClient, ImageClient, HostingClient).
 * Core only knows these shapes. Every call counts against the worker's budget.
 */

import type { ImageAsset, Identity, QuantumProof, QsdStage, Copycat, BundleFlag } from "./index";

export interface LlmClient {
  complete(input: {
    system: string;
    user: string;
    /** JSON schema the response must satisfy; the client validates. */
    schema?: Record<string, unknown>;
    maxTokens?: number;
  }): Promise<{ text: string; json?: unknown; tokensUsed: number }>;
}

export interface ImageClient {
  readonly provider: string;
  generate(input: {
    prompt: string;
    kind: ImageAsset["kind"];
    width: number;
    height: number;
    /** Style anchor so a set stays consistent (seed or reference url). */
    styleRef?: string;
  }): Promise<ImageAsset>;
}

export interface XPost {
  id: string;
  url: string;
  text: string;
  authorId: string;
  createdAt: string;
  metrics?: { likes: number; reposts: number; replies: number; impressions?: number };
}

export interface XAccountSummary {
  id: string;
  handle: string;
  followers: number;
}

export interface XClient {
  /** The connected account this client is scoped to. Never anything else. */
  readonly accountId: string;
  post(input: { text: string; mediaIds?: string[]; replyTo?: string }): Promise<XPost>;
  thread(input: { posts: { text: string; mediaIds?: string[] }[] }): Promise<XPost[]>;
  uploadMedia(input: { url: string; alt?: string }): Promise<{ mediaId: string }>;
  mentions(input: { sinceId?: string }): Promise<XPost[]>;
  search(input: { query: string; max?: number }): Promise<XPost[]>;
  trends(): Promise<{ name: string; volume?: number }[]>;
  users(input: { ids: string[] }): Promise<XAccountSummary[]>;
  updateProfile(input: { avatarUrl?: string; bannerUrl?: string }): Promise<void>;
  /** Monthly budget readout for /status. */
  budget(): Promise<{ used: number; limit: number; resetsAt: string; paused: boolean }>;
}

export interface QsdLaunchHandlers {
  onStage(stage: QsdStage, detail: Record<string, unknown>): void;
  onChainStep(chain: number, depth: number): void;
  onTreeLevelFused(level: number): void;
  onSignChainStop(chain: number, depth: number): void;
}

export interface QsdLaunchResult {
  identityRoot: string;
  proof: QuantumProof;
  signature: string;
  anchorTx: string;
}

export interface SolanaClient {
  readonly cluster: "devnet" | "mainnet-beta";
  readonly agentWallet: string;
  /** Runs the QSD cryptographic sequence (identity → superposition → draw → sign → anchor). */
  qsdLaunch(input: { identity: Identity; logoUrl: string }, handlers: QsdLaunchHandlers): Promise<QsdLaunchResult>;
  /** pump.fun deploy with dev buy. Resolves when the deploy tx is confirmed. */
  deployPumpFun(input: {
    identity: Identity;
    logoUrl: string;
    siteUrl: string;
    xUrl?: string;
    devBuySol: number;
  }): Promise<{ coinCa: string; txSignature: string; devBuySignature: string }>;
  buy(input: { coinCa: string; sol: number; slippageBps: number; reason: string }): Promise<{ txSignature: string }>;
  sell(input: { coinCa: string; percent: number; slippageBps: number; reason: string }): Promise<{ txSignature: string }>;
  claimCreatorFees(input: { coinCa: string }): Promise<{ txSignature: string; sol: number }>;
  isNameTaken(input: { name: string; ticker: string }): Promise<{ name: boolean; ticker: boolean }>;
  findLogoMatches(input: { phash: string; threshold: number }): Promise<Copycat[]>;
  findNameMatches(input: { name: string; ticker: string }): Promise<Copycat[]>;
  watchAnomalies(input: { coinCa: string; onFlag: (flag: BundleFlag) => void }): Promise<() => void>;
  watchMilestones(input: {
    coinCa: string;
    onMilestone: (m: { kind: "mcap" | "holders"; value: number }) => void;
  }): Promise<() => void>;
  registerWithQsd(input: { coinCa: string; identityRoot: string }): Promise<void>;
  balanceSol(): Promise<number>;
}

export interface HostingClient {
  readonly provider: string;
  /** Publish full HTML at <slug>.quantagent.site. No build step. */
  publish(input: { slug: string; html: string; assets?: { path: string; url: string }[] }): Promise<{
    url: string;
    deployId: string;
  }>;
  connectCustomDomain(input: { slug: string; domain: string }): Promise<{ verification: string }>;
}

export interface QuantumClient {
  /** One verifiable draw over n candidates. Throws if the QRNG is unreachable; never falls back. */
  draw(input: { candidateIds: string[]; context: string }): Promise<QuantumProof>;
}
