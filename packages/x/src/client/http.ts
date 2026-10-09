/**
 * The one HTTP path to X. Every request goes through:
 *   budget check → rate limiter acquire → fetch → observe headers → budget count
 * with: refresh-and-retry on 401, wait-and-retry on 429 (reset headers honoured),
 * exponential backoff on 5xx / network errors, and a hard attempt ceiling.
 */
import { XApiError, type HeaderMap } from "../errors";
import type { BudgetStatus, MonthlyBudget } from "../budget/budget";
import { headersToMap, parseJson } from "../oauth/oauth";
import type { FetchLike } from "../oauth/oauth";
import { backoffMs, waitFromHeaders } from "../ratelimit/backoff";
import type { RateLimiter } from "../ratelimit/limiter";
import type { AccessTokenProvider } from "./auth";

export const X_API_BASE = "https://api.x.com";

export type XLogEvent =
  | { type: "request"; accountId: string; route: string; method: string; status: number; attempt: number }
  | { type: "retry"; accountId: string; route: string; reason: string; waitMs: number; attempt: number }
  | { type: "refresh"; accountId: string; route: string }
  | { type: "gaveUp"; accountId: string; route: string; attempts: number; error: string }
  | { type: "deadLetter"; accountId: string; op: string; dlqId: string; error: string }
  | { type: "budgetPaused"; accountId: string; used: number; limit: number; resetsAt: string };

export type XLogger = (event: XLogEvent) => void;

export interface XHttpOptions {
  auth: AccessTokenProvider;
  limiter: RateLimiter;
  budget: MonthlyBudget;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Total attempts per request including the first. Default 4. */
  maxAttempts?: number;
  baseUrl?: string;
  backoff?: { baseMs?: number; maxMs?: number; jitter?: number };
  log?: XLogger;
}

export interface XRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Path under baseUrl ("/2/tweets") or an absolute URL. */
  path: string;
  /** Short label for rate-limit tracking and logs, e.g. "POST /2/tweets". */
  route: string;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  /** "oauth2" (default) bearer; "preset" means `headers` already carry authorization. */
  auth?: "oauth2" | "preset";
}

export interface XResponse<T> {
  status: number;
  headers: HeaderMap;
  data: T;
}

export class XHttp {
  readonly accountId: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly baseUrl: string;
  private readonly log: XLogger;

  constructor(private readonly opts: XHttpOptions) {
    this.accountId = opts.auth.accountId;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.baseUrl = opts.baseUrl ?? X_API_BASE;
    this.log = opts.log ?? (() => {});
  }

  get auth(): AccessTokenProvider {
    return this.opts.auth;
  }

  budgetStatus(): Promise<BudgetStatus> {
    return this.opts.budget.status();
  }

  url(req: XRequest): string {
    const u = new URL(req.path.startsWith("http") ? req.path : this.baseUrl + req.path);
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) if (v !== undefined) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  async request<T = unknown>(req: XRequest): Promise<XResponse<T>> {
    const url = this.url(req);
    let refreshed = false;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      // 1. budget: refuse at 100% so nothing is sent we cannot afford.
      try {
        await this.opts.budget.assertAvailable();
      } catch (err) {
        const s = await this.opts.budget.status();
        this.log({ type: "budgetPaused", accountId: this.accountId, used: s.used, limit: s.limit, resetsAt: s.resetsAt });
        throw err;
      }
      // 2. rate limiter: waits for bucket tokens and for X's reset window.
      await this.opts.limiter.acquire(this.accountId, req.route);

      const headers: Record<string, string> = { ...(req.headers ?? {}) };
      if ((req.auth ?? "oauth2") === "oauth2") headers["authorization"] = `Bearer ${await this.opts.auth.token()}`;
      let body: BodyInit | undefined = req.body;
      if (req.json !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(req.json);
      }
      const init: RequestInit = { method: req.method, headers };
      if (body !== undefined) init.body = body;

      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (err) {
        // 3a. network failure: counts as an attempt, back off.
        lastErr = err;
        await this.opts.budget.record(1);
        const wait = backoffMs(attempt, this.opts.backoff);
        this.log({ type: "retry", accountId: this.accountId, route: req.route, reason: `network: ${String(err)}`, waitMs: wait, attempt });
        if (attempt + 1 < this.maxAttempts) await this.sleep(wait);
        continue;
      }

      const hmap = headersToMap(res.headers);
      this.opts.limiter.observe(this.accountId, req.route, hmap);
      await this.opts.budget.record(1);
      this.log({ type: "request", accountId: this.accountId, route: req.route, method: req.method, status: res.status, attempt });

      if (res.ok) {
        const data = (await parseJson(res)) as T;
        return { status: res.status, headers: hmap, data };
      }

      const payload = await parseJson(res);
      const err = new XApiError(res.status, req.route, payload, hmap);
      lastErr = err;

      if (res.status === 401 && !refreshed && (req.auth ?? "oauth2") === "oauth2") {
        refreshed = true;
        this.log({ type: "refresh", accountId: this.accountId, route: req.route });
        await this.opts.auth.refresh(); // throws XAccountNotConnected if it cannot
        continue;
      }
      if (res.status === 429) {
        const wait = waitFromHeaders(hmap, this.now()) ?? backoffMs(attempt, this.opts.backoff);
        this.log({ type: "retry", accountId: this.accountId, route: req.route, reason: "429", waitMs: wait, attempt });
        if (attempt + 1 < this.maxAttempts) await this.sleep(wait);
        continue;
      }
      if (res.status >= 500) {
        const wait = backoffMs(attempt, this.opts.backoff);
        this.log({ type: "retry", accountId: this.accountId, route: req.route, reason: `${res.status}`, waitMs: wait, attempt });
        if (attempt + 1 < this.maxAttempts) await this.sleep(wait);
        continue;
      }
      // 4xx other than 401/429: not retriable.
      throw err;
    }

    this.log({
      type: "gaveUp",
      accountId: this.accountId,
      route: req.route,
      attempts: this.maxAttempts,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
