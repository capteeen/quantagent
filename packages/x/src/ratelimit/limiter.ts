/**
 * Rate limiter for X API calls.
 *
 *  - one global token bucket (the app's overall pace)
 *  - one token bucket per connected account
 *  - per (account, route) window tracking from X's x-rate-limit-* headers:
 *    when X says remaining=0, nothing is sent on that route until reset.
 *
 * `acquire` waits (via injected sleep) rather than failing, bounded by
 * maxWaitMs; past that it throws so a stuck caller is visible instead of hung.
 */
import type { HeaderMap } from "../errors";
import { parseRateLimitHeaders } from "./backoff";
import { TokenBucket, type BucketOptions } from "./tokenBucket";

export interface RateLimiterOptions {
  global?: BucketOptions;
  perAccount?: BucketOptions;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Longest a single acquire will wait. Default 16 minutes (one X window + slack). */
  maxWaitMs?: number;
}

export interface RouteWindow {
  limit?: number;
  remaining?: number;
  resetAt?: number;
  observedAt: number;
}

export interface RateLimitSnapshot {
  global: { available: number; capacity: number };
  accounts: Record<string, { available: number; capacity: number; routes: Record<string, RouteWindow> }>;
}

export class XRateLimitWait extends Error {
  override readonly name = "XRateLimitWait";
  constructor(
    public readonly accountId: string,
    public readonly route: string,
    public readonly waitMs: number,
    public readonly maxWaitMs: number,
  ) {
    super(`X rate limit on ${route} for ${accountId} needs ${waitMs}ms, over the ${maxWaitMs}ms ceiling`);
  }
}

/** Defaults sized under X's common 15-minute windows. */
export const DEFAULT_GLOBAL_BUCKET: BucketOptions = { capacity: 300, refillPerSecond: 300 / 900 };
export const DEFAULT_ACCOUNT_BUCKET: BucketOptions = { capacity: 100, refillPerSecond: 100 / 900 };

export class RateLimiter {
  private readonly global: TokenBucket;
  private readonly accounts = new Map<string, TokenBucket>();
  private readonly routes = new Map<string, RouteWindow>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxWaitMs: number;
  private readonly accountOpts: BucketOptions;

  constructor(opts: RateLimiterOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxWaitMs = opts.maxWaitMs ?? 16 * 60 * 1000;
    this.accountOpts = opts.perAccount ?? DEFAULT_ACCOUNT_BUCKET;
    this.global = new TokenBucket(opts.global ?? DEFAULT_GLOBAL_BUCKET, this.now);
  }

  private bucket(accountId: string): TokenBucket {
    let b = this.accounts.get(accountId);
    if (!b) {
      b = new TokenBucket(this.accountOpts, this.now);
      this.accounts.set(accountId, b);
    }
    return b;
  }

  private key(accountId: string, route: string): string {
    return `${accountId}\u0000${route}`;
  }

  /** How long the caller must wait before sending on this route, in ms (0 = go). */
  waitFor(accountId: string, route: string): number {
    let wait = 0;
    const w = this.routes.get(this.key(accountId, route));
    if (w && w.remaining !== undefined && w.remaining <= 0 && w.resetAt !== undefined) {
      wait = Math.max(wait, w.resetAt - this.now());
    }
    wait = Math.max(wait, this.global.msUntilToken(), this.bucket(accountId).msUntilToken());
    return Math.max(0, wait);
  }

  /** Blocks until a call on (accountId, route) is allowed, then consumes a token from both buckets. */
  async acquire(accountId: string, route: string): Promise<void> {
    for (;;) {
      const wait = this.waitFor(accountId, route);
      if (wait > this.maxWaitMs) throw new XRateLimitWait(accountId, route, wait, this.maxWaitMs);
      if (wait > 0) {
        await this.sleep(wait);
        continue;
      }
      // Both buckets had a token available per waitFor; take them.
      const g = this.global.tryTake();
      const a = this.bucket(accountId).tryTake();
      if (g && a) {
        const w = this.routes.get(this.key(accountId, route));
        if (w?.remaining !== undefined && w.remaining > 0) w.remaining -= 1;
        return;
      }
      // Lost a race with a concurrent acquire; loop and wait again.
      await this.sleep(Math.max(1, this.waitFor(accountId, route)));
    }
  }

  /** Records X's rate-limit headers from a response. */
  observe(accountId: string, route: string, headers: HeaderMap): void {
    const info = parseRateLimitHeaders(headers);
    if (info.limit === undefined && info.remaining === undefined && info.resetAt === undefined) return;
    const w: RouteWindow = { observedAt: this.now() };
    if (info.limit !== undefined) w.limit = info.limit;
    if (info.remaining !== undefined) w.remaining = info.remaining;
    if (info.resetAt !== undefined) w.resetAt = info.resetAt;
    this.routes.set(this.key(accountId, route), w);
  }

  snapshot(): RateLimitSnapshot {
    const accounts: RateLimitSnapshot["accounts"] = {};
    for (const [id, b] of this.accounts) {
      accounts[id] = { available: b.available(), capacity: b.capacity, routes: {} };
    }
    for (const [k, w] of this.routes) {
      const [id, route] = k.split("\u0000") as [string, string];
      const acc = (accounts[id] ??= { available: this.bucket(id).available(), capacity: this.accountOpts.capacity, routes: {} });
      acc.routes[route] = { ...w };
    }
    return { global: { available: this.global.available(), capacity: this.global.capacity }, accounts };
  }
}
