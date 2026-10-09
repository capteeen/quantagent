/**
 * XRuntime wires the shared pieces (token store, OAuth connector, global rate
 * limiter, monthly budget, dead-letter queue) and hands out one XApiClient per
 * connected account. The app holds a single runtime; workers get
 * runtime.client(launch.xAccountId).
 */
import { NotImplemented } from "@quantagent/core/types";
import { MonthlyBudget, MemoryBudgetStore, RedisBudgetStore, budgetLimitFromEnv, type BudgetStatus, type BudgetStore } from "../budget/budget";
import { XOAuth, oauthConfigFromEnv, type FetchLike, type OAuthConfig } from "../oauth/oauth";
import { createTokenStoreFromEnv, type TokenListing, type TokenStore } from "../oauth/tokenStore";
import { MemoryDeadLetterQueue, RedisDeadLetterQueue, connectRedis, type DeadLetter, type DeadLetterQueue, type RedisLike } from "../ratelimit/dlq";
import { RateLimiter, type RateLimitSnapshot, type RateLimiterOptions } from "../ratelimit/limiter";
import { StoreTokenProvider } from "./auth";
import { XHttp, type XLogger } from "./http";
import type { MediaUploadOptions } from "./media";
import { oauth1FromEnv, type OAuth1Credentials } from "./oauth1";
import { XApiClient } from "./xClient";

export interface XStatus {
  budget: BudgetStatus;
  rateLimit: RateLimitSnapshot;
  deadLetters: { count: number; failed: number; items: DeadLetter[] };
  /** Connected accounts (metadata only; never tokens). */
  accounts: TokenListing[];
}

export interface XRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  /** Overrides for tests / embedding. Anything omitted is built from env. */
  store?: TokenStore;
  oauth?: OAuthConfig;
  oauth1?: OAuth1Credentials | null;
  limiter?: RateLimiter;
  limiterOptions?: RateLimiterOptions;
  budget?: MonthlyBudget;
  dlq?: DeadLetterQueue;
  redis?: RedisLike;
  fetch?: FetchLike;
  assetFetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: XLogger;
  media?: MediaUploadOptions;
  trendQuery?: string;
  maxAttempts?: number;
  apiBaseUrl?: string;
}

export class XRuntime {
  readonly store: TokenStore;
  readonly oauth: XOAuth;
  readonly oauthConfig: OAuthConfig;
  readonly limiter: RateLimiter;
  readonly budget: MonthlyBudget;
  readonly dlq: DeadLetterQueue;
  private readonly clients = new Map<string, XApiClient>();

  constructor(private readonly opts: Required<Pick<XRuntimeOptions, "store" | "oauth" | "limiter" | "budget" | "dlq">> & XRuntimeOptions) {
    this.store = opts.store;
    this.oauthConfig = opts.oauth;
    this.limiter = opts.limiter;
    this.budget = opts.budget;
    this.dlq = opts.dlq;
    const oauthOpts: ConstructorParameters<typeof XOAuth>[0] = { config: opts.oauth, store: opts.store };
    if (opts.fetch) oauthOpts.fetch = opts.fetch;
    if (opts.now) oauthOpts.now = opts.now;
    this.oauth = new XOAuth(oauthOpts);
    // Dead letters for accounts whose client was never built this process still replay.
    this.dlq.setDefaultHandler((entry) => this.client(entry.accountId).replay(entry));
  }

  /** Client scoped to one connected account. Cached per account id. */
  client(accountId: string): XApiClient {
    let c = this.clients.get(accountId);
    if (c) return c;
    const o = this.opts;
    const authOpts: ConstructorParameters<typeof StoreTokenProvider>[0] = { accountId, store: this.store, oauth: this.oauthConfig };
    if (o.fetch) authOpts.fetch = o.fetch;
    if (o.now) authOpts.now = o.now;
    const httpOpts: ConstructorParameters<typeof XHttp>[0] = {
      auth: new StoreTokenProvider(authOpts),
      limiter: this.limiter,
      budget: this.budget,
    };
    if (o.fetch) httpOpts.fetch = o.fetch;
    if (o.now) httpOpts.now = o.now;
    if (o.sleep) httpOpts.sleep = o.sleep;
    if (o.log) httpOpts.log = o.log;
    if (o.maxAttempts !== undefined) httpOpts.maxAttempts = o.maxAttempts;
    if (o.apiBaseUrl) httpOpts.baseUrl = o.apiBaseUrl;
    const clientOpts: ConstructorParameters<typeof XApiClient>[0] = { http: new XHttp(httpOpts), dlq: this.dlq };
    if (o.trendQuery) clientOpts.trendQuery = o.trendQuery;
    if (o.oauth1 !== undefined) clientOpts.oauth1 = o.oauth1;
    if (o.media) clientOpts.media = o.media;
    if (o.assetFetch) clientOpts.assetFetch = o.assetFetch;
    if (o.now) clientOpts.now = o.now;
    if (o.log) clientOpts.log = o.log;
    c = new XApiClient(clientOpts);
    this.clients.set(accountId, c);
    return c;
  }

  /** Everything the /status screen needs: budget, rate-limit state, visible failures, connected accounts. */
  async status(): Promise<XStatus> {
    const [budget, items, accounts] = await Promise.all([this.budget.status(), this.dlq.list(), this.store.list()]);
    return {
      budget,
      rateLimit: this.limiter.snapshot(),
      deadLetters: { count: items.length, failed: items.filter((i) => i.status === "failed").length, items },
      accounts,
    };
  }
}

/**
 * Builds a runtime from the environment:
 *   X_CLIENT_ID, X_REDIRECT_URI (X_CLIENT_SECRET optional)   OAuth app
 *   X_TOKEN_KEY + (DATABASE_URL | X_TOKEN_STORE=memory)      encrypted token store
 *   X_MONTHLY_CALL_BUDGET (default 1500)                      budget
 *   REDIS_URL (optional)                                      durable DLQ + budget counter
 *   X_OAUTH1_* (optional)                                     v1.1 profile endpoints
 *   X_TREND_QUERY (optional)                                  search-based trends fallback
 * Missing required configuration throws NotImplemented naming the variables.
 */
export async function createXRuntime(opts: XRuntimeOptions = {}): Promise<XRuntime> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;

  const store = opts.store ?? (await createTokenStoreFromEnv(env));
  const oauth = opts.oauth ?? oauthConfigFromEnv(env);

  let redis: RedisLike | undefined = opts.redis;
  if (!redis && env["REDIS_URL"] && (!opts.dlq || !opts.budget)) redis = await connectRedis(env["REDIS_URL"]);

  const dlq = opts.dlq ?? (redis ? new RedisDeadLetterQueue(redis, now) : new MemoryDeadLetterQueue(now));
  let budget = opts.budget;
  if (!budget) {
    const budgetStore: BudgetStore = redis ? new RedisBudgetStore(redis) : new MemoryBudgetStore();
    budget = new MonthlyBudget({ limit: budgetLimitFromEnv(env), store: budgetStore, now });
  }
  let limiter = opts.limiter;
  if (!limiter) {
    const lo: RateLimiterOptions = { ...(opts.limiterOptions ?? {}) };
    if (opts.now && lo.now === undefined) lo.now = opts.now;
    if (opts.sleep && lo.sleep === undefined) lo.sleep = opts.sleep;
    limiter = new RateLimiter(lo);
  }

  const full: ConstructorParameters<typeof XRuntime>[0] = { ...opts, store, oauth, limiter, budget, dlq };
  if (opts.oauth1 === undefined) full.oauth1 = oauth1FromEnv(env);
  if (!opts.trendQuery && env["X_TREND_QUERY"]) full.trendQuery = env["X_TREND_QUERY"];
  return new XRuntime(full);
}

/** Convenience: one client for one account, straight from env. */
export async function createXClientFromEnv(accountId: string, opts: XRuntimeOptions = {}): Promise<XApiClient> {
  const rt = await createXRuntime(opts);
  const tokens = await rt.store.get(accountId);
  if (!tokens) {
    throw new NotImplemented(
      "x.client",
      `X account ${accountId} is not connected; the user must authorize it through XOAuth first`,
      [],
    );
  }
  return rt.client(accountId);
}
