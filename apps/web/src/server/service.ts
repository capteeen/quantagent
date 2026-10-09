/**
 * The in-process orchestrator service. One per process (see singleton.ts).
 *
 * - creates launches through core launch() with createWorkers() and the clients
 *   that could be built from env; a client that cannot be built is null for the
 *   workers (core fails that worker with the NotImplemented text) and is reported
 *   on the launch with its exact env var names;
 * - keeps a registry of launch handles and metadata;
 * - exposes state (rebuild of the log), SSE frames, approvals, user picks,
 *   autopilot, status, me, and the Helius webhook.
 */
import { randomBytes } from "node:crypto";
import {
  DEFAULT_BUDGETS,
  ON_DEMAND_WORKERS,
  POST_LAUNCH_WORKERS,
  launch as coreLaunch,
  rebuild,
  startPostLaunch as coreStartPostLaunch,
  type ClientsInput,
  type EventBus,
  type LaunchHandle,
  type PostLaunchRuntime,
  type PostLaunchWorker,
  type Worker,
} from "@quantagent/core";
import {
  NotImplemented,
  WORKER_NAMES,
  type ApprovalDecision,
  type ApprovalRequest,
  type Autopilot,
  type Launch,
  type LaunchOptions,
  type QuantagentEvent,
  type WorkerName,
} from "@quantagent/core/types";
import type { SolanaClient, XClient } from "@quantagent/core/types/clients";
import { WALLET_KEY_ENV, resolveCluster } from "@quantagent/solana";
import type { WebhookRequest, WebhookResponse } from "@quantagent/solana";
import type { SharedClients } from "./clients";
import { costLine, devBuySolFromEnv, traderBudgetSolFromEnv } from "./cost";
import { BadRequest, NotFound, attempt, attemptSync, describeError, healthOf, type Result } from "./errors";
import { llmModelFromEnv } from "./llm";
import type {
  AgentWalletSummary,
  ClientHealth,
  ClientKey,
  Cluster,
  Health,
  HostingReport,
  LaunchDetail,
  LaunchMeta,
  LaunchSummary,
  MeReport,
  PostLaunchStatus,
  QueueReport,
  StatusReport,
  Unavailable,
  XStatusLike,
} from "./types";
import type { Env } from "./types";

export interface CreateLaunchInput {
  prompt: string;
  xAccountId: string;
  ownerWallet: string;
  options?: { autopilot?: Partial<Autopilot>; devBuySol?: number } | undefined;
}

export interface ServiceDeps {
  env: Env;
  bus: EventBus;
  shared: SharedClients;
  createWorkers: () => Worker[];
  /** One SolanaClient per launch (its agent wallet). Default: @quantagent/solana createSolanaClient. */
  createSolana: (input: { launchId: string; cluster: Cluster; budgetSol: number }) => Promise<SolanaClient>;
  launch?: typeof coreLaunch;
  /** null disables the post-launch runtime in this process (tests). */
  startPostLaunch?: typeof coreStartPostLaunch | null;
  now?: () => Date;
}

interface LaunchRecord {
  id: string;
  createdAt: string;
  prompt: string;
  xAccountId: string;
  ownerWallet: string;
  cluster: Cluster;
  options: LaunchOptions;
  handle: LaunchHandle;
  clients: ClientsInput;
  clientHealth: ClientHealth;
  postLaunch: PostLaunchStatus;
  runtime: PostLaunchRuntime | null;
}

/**
 * A launch runs for minutes to hours (approvals, the deploy, post-launch workers) inside this
 * process. Serverless platforms freeze or recycle the function once the response is sent and
 * route later requests to other instances, so a launch there would stop mid-way, possibly after
 * SOL has moved. Launches are refused on serverless until the orchestrator runs on a long-lived host.
 */
export function serverlessPlatform(env: Env): string | null {
  if (env["VERCEL"]) return "Vercel";
  if (env["AWS_LAMBDA_FUNCTION_NAME"]) return "AWS Lambda";
  if (env["NETLIFY"]) return "Netlify";
  return null;
}

export const LONG_LIVED_NEEDS = [
  "run apps/web on a long-lived Node server (pnpm --filter @quantagent/web build && pnpm --filter @quantagent/web start), e.g. Railway, Render or Fly.io",
];

export function clusterFromEnv(env: Env): Cluster {
  const raw = env["SOLANA_CLUSTER"]?.trim();
  return resolveCluster(raw ? (raw as Cluster) : undefined, env as Record<string, string | undefined>);
}

export function newLaunchId(): string {
  return randomBytes(9).toString("base64url");
}

function isPostLaunchWorker(w: Worker): w is PostLaunchWorker {
  return POST_LAUNCH_WORKERS.includes(w.name) || ON_DEMAND_WORKERS.includes(w.name);
}

export class OrchestratorService {
  private readonly records = new Map<string, LaunchRecord>();
  private readonly env: Env;
  private readonly bus: EventBus;
  private readonly shared: SharedClients;
  private readonly launchFn: typeof coreLaunch;
  private readonly startPostLaunchFn: typeof coreStartPostLaunch | null;
  private readonly now: () => Date;

  constructor(private readonly deps: ServiceDeps) {
    this.env = deps.env;
    this.bus = deps.bus;
    this.shared = deps.shared;
    this.launchFn = deps.launch ?? coreLaunch;
    this.startPostLaunchFn = deps.startPostLaunch === undefined ? coreStartPostLaunch : deps.startPostLaunch;
    this.now = deps.now ?? (() => new Date());
  }

  get eventBus(): EventBus {
    return this.bus;
  }

  get sharedClients(): SharedClients {
    return this.shared;
  }

  /* ───────────────────────── launches ───────────────────────── */

  async createLaunch(input: CreateLaunchInput): Promise<{ id: string; clients: ClientHealth }> {
    if (!input.prompt?.trim()) throw new BadRequest("prompt is empty");
    if (!input.xAccountId?.trim()) throw new BadRequest("no X account is connected");
    if (!input.ownerWallet?.trim()) throw new BadRequest("no wallet is connected");
    const platform = serverlessPlatform(this.env);
    if (platform) {
      throw new NotImplemented(
        "launch",
        `this deployment runs on ${platform} serverless functions, which stop between requests; a launch needs one long-lived process for its whole life`,
        LONG_LIVED_NEEDS,
      );
    }
    const cluster = clusterFromEnv(this.env);
    const id = newLaunchId();
    const devBuySol = input.options?.devBuySol ?? devBuySolFromEnv(this.env);
    const traderSol = traderBudgetSolFromEnv(this.env);
    const cost = costLine(this.env, cluster, devBuySol);

    const xResult = await this.xClientFor(input.xAccountId);
    const solanaResult = await attempt(() => this.deps.createSolana({ launchId: id, cluster, budgetSol: cost.youPaySol }));

    const clients: ClientsInput = {
      llm: this.shared.llm.ok ? this.shared.llm.value : null,
      image: this.shared.image.ok ? this.shared.image.value : null,
      hosting: this.shared.hosting.ok ? this.shared.hosting.value : null,
      quantum: this.shared.quantum.ok ? this.shared.quantum.value : null,
      x: xResult.ok ? xResult.value : null,
      solana: solanaResult.ok ? solanaResult.value : null,
    };
    const clientHealth: ClientHealth = {
      llm: healthOf(this.shared.llm, () => llmModelFromEnv(this.env)),
      image: healthOf(this.shared.image, (c) => c.provider),
      hosting: healthOf(this.shared.hosting, (c) => c.provider),
      quantum: healthOf(this.shared.quantum),
      x: healthOf(xResult, (c) => c.accountId),
      solana: healthOf(solanaResult, (c) => `${c.cluster} · ${c.agentWallet}`),
    };

    const options: LaunchOptions = {
      cluster,
      devBuySol,
      budgets: { Trader: { sol: traderSol } },
      ...(input.options?.autopilot ? { autopilot: input.options.autopilot } : {}),
    };

    const handle = await this.launchFn(
      input.prompt,
      { xAccountId: input.xAccountId, ownerWallet: input.ownerWallet },
      options,
      { workers: this.deps.createWorkers(), clients, bus: this.bus, launchId: id, env: this.env },
    );

    const record: LaunchRecord = {
      id,
      createdAt: this.now().toISOString(),
      prompt: input.prompt,
      xAccountId: input.xAccountId,
      ownerWallet: input.ownerWallet,
      cluster,
      options,
      handle,
      clients,
      clientHealth,
      postLaunch: { status: "pending", detail: "starts after Launch.live" },
      runtime: null,
    };
    this.records.set(id, record);
    void handle.settled.then((state) => this.afterLaunch(record, state));
    return { id, clients: clientHealth };
  }

  private async xClientFor(accountId: string): Promise<Result<XClient>> {
    if (!this.shared.x.ok) return { ok: false, error: this.shared.x.error };
    const runtime = this.shared.x.value;
    return attempt(async () => {
      const tokens = await runtime.store.get(accountId);
      if (!tokens) throw new Error(`X account ${accountId} is not connected in this token store; connect it through /api/x/oauth/start`);
      return runtime.client(accountId) as XClient;
    });
  }

  private afterLaunch(record: LaunchRecord, state: Launch): void {
    if (!state.coinCa || (state.status !== "live" && state.status !== "partial")) {
      record.postLaunch = { status: "not-started", detail: `launch ended ${state.status} without a live coin` };
      return;
    }
    if (!this.startPostLaunchFn) {
      record.postLaunch = { status: "unavailable", error: "post-launch runtime is disabled in this process", needs: [] };
      return;
    }
    const started = attemptSync(() =>
      this.startPostLaunchFn!({
        launchId: record.id,
        bus: this.bus,
        workers: this.deps.createWorkers().filter(isPostLaunchWorker),
        prompt: record.prompt,
        connections: { xAccountId: record.xAccountId, ownerWallet: record.ownerWallet },
        options: record.options,
        clients: record.clients,
        getAutopilot: () => record.handle.getState().autopilot,
      }),
    );
    if (!started.ok) {
      record.postLaunch = { status: "unavailable", error: started.error.message, needs: started.error.needs };
      return;
    }
    record.runtime = started.value;
    record.postLaunch = { status: "starting" };
    started.value.ready.then(
      () => {
        record.postLaunch = { status: "running", queueName: started.value.queueName };
      },
      (err: unknown) => {
        record.postLaunch = { status: "failed", error: describeError(err).message };
      },
    );
  }

  private must(id: string): LaunchRecord {
    const r = this.records.get(id);
    if (!r) throw new NotFound(`no launch ${id} in this process`);
    return r;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  async log(id: string, afterSeq = 0): Promise<QuantagentEvent[]> {
    this.must(id);
    return this.bus.log(id, afterSeq);
  }

  /** State rebuilt from the persisted log alone. */
  async state(id: string): Promise<Launch> {
    this.must(id);
    return rebuild(await this.bus.log(id), id);
  }

  meta(id: string): LaunchMeta {
    const r = this.must(id);
    return { id: r.id, createdAt: r.createdAt, clients: r.clientHealth, postLaunch: r.postLaunch };
  }

  async detail(id: string): Promise<LaunchDetail> {
    const r = this.must(id);
    const events = await this.bus.log(id);
    const state = rebuild(events, id);
    const last = events[events.length - 1];
    return { meta: this.meta(id), state, pendingApprovals: this.pendingApprovals(id), seq: last ? last.seq : 0 };
  }

  sse(id: string, opts: { afterSeq?: number; signal?: AbortSignal } = {}): AsyncGenerator<string, void, undefined> {
    this.must(id);
    return this.bus.toSSE(id, opts);
  }

  pendingApprovals(id: string): ApprovalRequest[] {
    const r = this.must(id);
    const fromLaunch = r.handle.pendingApprovals();
    const fromRuntime = r.runtime ? r.runtime.gate.pending(id) : [];
    return [...fromLaunch, ...fromRuntime];
  }

  approve(id: string, approvalId: string, decision: ApprovalDecision, editedDraft?: Record<string, unknown>): { resolved: boolean } {
    const r = this.must(id);
    if (!approvalId) throw new BadRequest("approvalId is required");
    if (!["approve", "edit", "skip"].includes(decision)) throw new BadRequest(`decision must be approve|edit|skip, got "${String(decision)}"`);
    if (decision === "edit" && !editedDraft) throw new BadRequest('decision "edit" needs a draft');
    let resolved = r.handle.resolveApproval(approvalId, decision, editedDraft);
    if (!resolved && r.runtime) resolved = r.runtime.gate.resolve(approvalId, decision, editedDraft);
    if (!resolved) throw new NotFound(`approval ${approvalId} is not pending on launch ${id}`);
    return { resolved };
  }

  pick(id: string, worker: WorkerName, candidateId: string): QuantagentEvent {
    const r = this.must(id);
    if (!WORKER_NAMES.includes(worker)) throw new BadRequest(`unknown worker "${String(worker)}"`);
    if (!candidateId) throw new BadRequest("candidateId is required");
    try {
      return r.handle.userPick(worker, candidateId);
    } catch (err) {
      throw new BadRequest(err instanceof Error ? err.message : String(err));
    }
  }

  setAutopilot(id: string, patch: Partial<Autopilot>): Autopilot {
    const r = this.must(id);
    const clean: Partial<Autopilot> = {};
    for (const k of ["posts", "trades", "recruiting"] as const) {
      if (k in patch) {
        if (typeof patch[k] !== "boolean") throw new BadRequest(`autopilot.${k} must be a boolean`);
        clean[k] = patch[k];
      }
    }
    if (Object.keys(clean).length === 0) throw new BadRequest("no autopilot flags given (posts | trades | recruiting)");
    return r.handle.setAutopilot(clean);
  }

  async summaries(filter: { xAccountId?: string; ownerWallet?: string } = {}): Promise<LaunchSummary[]> {
    const out: LaunchSummary[] = [];
    for (const r of this.records.values()) {
      if (filter.xAccountId && r.xAccountId !== filter.xAccountId) continue;
      if (filter.ownerWallet && r.ownerWallet !== filter.ownerWallet) continue;
      out.push(this.summaryOf(r, r.handle.getState()));
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  private summaryOf(r: LaunchRecord, state: Launch): LaunchSummary {
    const s: LaunchSummary = {
      id: r.id,
      createdAt: r.createdAt,
      prompt: r.prompt,
      status: state.status,
      agentWallet: state.agentWallet,
      cluster: state.cluster,
      startedAt: state.startedAt,
      pendingApprovals: this.pendingApprovals(r.id).length,
      failed: WORKER_NAMES.filter((w) => state.workers[w].status === "failed"),
    };
    if (state.coinCa) s.coinCa = state.coinCa;
    if (state.siteUrl) s.siteUrl = state.siteUrl;
    return s;
  }

  /** The launch that deployed exactly this contract address, if this process ran it. */
  findByCa(ca: string): string | null {
    for (const r of this.records.values()) {
      if (r.handle.getState().coinCa === ca) return r.id;
    }
    return null;
  }

  async stop(id: string): Promise<void> {
    const r = this.records.get(id);
    if (!r) return;
    if (r.runtime) await r.runtime.stop();
    await r.handle.stop();
    r.postLaunch = { status: "stopped" };
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.records.keys()].map((id) => this.stop(id)));
  }

  /* ───────────────────────── me / status ───────────────────────── */

  async me(accountId: string | null): Promise<MeReport> {
    const report: MeReport = { account: null, launches: [], wallets: [], pendingApprovals: [] };
    if (!this.shared.x.ok) report.accountError = this.shared.x.error;
    if (!accountId) return report;
    const xr = this.shared.x;
    if (xr.ok) {
      const listed = await attempt(() => xr.value.store.list());
      if (listed.ok) {
        const row = listed.value.find((a) => a.accountId === accountId);
        report.account = row ? (row.handle ? { accountId, handle: row.handle } : { accountId }) : { accountId };
      } else {
        report.account = { accountId };
      }
    } else {
      report.account = { accountId };
    }
    report.launches = await this.summaries({ xAccountId: accountId });
    for (const s of report.launches) {
      const r = this.must(s.id);
      const state = r.handle.getState();
      const wallet: AgentWalletSummary = {
        launchId: r.id,
        address: state.agentWallet,
        cluster: state.cluster,
        budgetSol: WORKER_NAMES.reduce((n, w) => n + state.workers[w].budget.sol, 0),
        usedSol: WORKER_NAMES.reduce((n, w) => n + state.workers[w].used.sol, 0),
      };
      report.wallets.push(wallet);
      report.pendingApprovals.push(...this.pendingApprovals(r.id));
    }
    return report;
  }

  async status(): Promise<StatusReport> {
    const clusterResult = attemptSync(() => clusterFromEnv(this.env));
    const cluster: Cluster | null = clusterResult.ok ? clusterResult.value : null;

    const xr = this.shared.x;
    let x: StatusReport["x"];
    if (xr.ok) {
      const r = await attempt(() => xr.value.status());
      x = r.ok ? { ok: true, status: r.value as unknown as XStatusLike } : r.error;
    } else {
      x = xr.error;
    }

    const providers: ClientHealth = {
      llm: healthOf(this.shared.llm, () => llmModelFromEnv(this.env)),
      image: healthOf(this.shared.image, (c) => c.provider),
      hosting: healthOf(this.shared.hosting, (c) => c.provider),
      quantum: healthOf(this.shared.quantum, () => "ANU QRNG"),
      x: healthOf(this.shared.x, (rt) => `${rt.oauthConfig.clientId.slice(0, 6)}… · ${rt.store.constructor.name}`),
      solana: this.solanaHealth(cluster, clusterResult.ok ? undefined : clusterResult.error),
    };

    const queue: QueueReport = { launches: this.records.size, running: 0, postLaunch: [] };
    for (const r of this.records.values()) {
      if (r.handle.getState().status === "running") queue.running += 1;
      const entry: QueueReport["postLaunch"][number] = { launchId: r.id, status: r.postLaunch.status };
      if ("error" in r.postLaunch) entry.error = r.postLaunch.error;
      if (r.runtime) {
        const counts = await attempt(() => r.runtime!.queue.getJobCounts());
        if (counts.ok) entry.counts = counts.value;
        else entry.error = counts.error.message;
      }
      queue.postLaunch.push(entry);
    }

    const report: StatusReport = {
      at: this.now().toISOString(),
      cluster,
      providers,
      store: {
        events: this.bus.getStoreKind(),
        stream: this.bus.getStreamKind(),
        tokens: this.shared.store.tokens,
        wallets: this.shared.wallets.kind,
      },
      x,
      hosting: await this.hostingReport(),
      queue,
      cost: costLine(this.env, cluster ?? "mainnet-beta"),
    };
    if (!clusterResult.ok) report.clusterError = clusterResult.error;
    return report;
  }

  private solanaHealth(cluster: Cluster | null, clusterError?: Unavailable): Health {
    if (clusterError) return clusterError;
    if (!this.env[WALLET_KEY_ENV]?.trim()) {
      return { ok: false, name: "NotImplemented", message: `agent wallet: ${WALLET_KEY_ENV} not set (needs: ${WALLET_KEY_ENV})`, capability: "agent wallet", because: `${WALLET_KEY_ENV} not set`, needs: [WALLET_KEY_ENV] };
    }
    const platform = serverlessPlatform(this.env);
    const notes: string[] = [
      ...(platform ? [`${platform} serverless: pages and connections work, launches are refused (they need a long-lived Node server)`] : []),
      `wallet keys at rest: ${this.shared.wallets.kind}${this.shared.wallets.kind === "memory" ? " (lost on restart; set DATABASE_URL)" : ""}`];
    if (cluster === "devnet" && !this.env["PUMPPORTAL_URL"]?.trim()) {
      notes.push("devnet: pump.fun create/buy/sell need PUMPPORTAL_URL pointed at a devnet trade-local endpoint (PumpPortal itself is mainnet-only)");
    }
    const rpc = this.env["SOLANA_RPC_URL"]?.trim() || (this.env["HELIUS_API_KEY"]?.trim() ? "helius" : "public default");
    return { ok: true, detail: `${cluster ?? "mainnet-beta"} · rpc: ${rpc}`, notes };
  }

  private async hostingReport(): Promise<HostingReport> {
    const report: HostingReport = { health: healthOf(this.shared.hosting, (c) => c.provider) };
    for (const r of this.records.values()) {
      const events = await this.bus.log(r.id);
      for (const e of events) {
        if (e.type === "Builder.published" && (!report.lastPublished || e.at > report.lastPublished.at)) {
          report.lastPublished = { launchId: r.id, url: e.payload.url, deployId: e.payload.deployId, at: e.at };
        }
        if (e.type === "Builder.patchFailed" && (!report.lastFailure || e.at > report.lastFailure.at)) {
          report.lastFailure = { launchId: r.id, error: e.payload.error, at: e.at };
        }
      }
    }
    return report;
  }

  /* ───────────────────────── webhooks ───────────────────────── */

  webhook(req: WebhookRequest): WebhookResponse {
    if (!this.shared.webhook.ok) {
      const e = this.shared.webhook.error;
      return { status: 501, body: e.message };
    }
    return this.shared.webhook.value(req);
  }
}

/** Which client keys a launch needs for which worker, for the UI's "why did X fail" line. */
export const CLIENT_KEYS: readonly ClientKey[] = ["llm", "image", "x", "solana", "hosting", "quantum"];

export { DEFAULT_BUDGETS };
