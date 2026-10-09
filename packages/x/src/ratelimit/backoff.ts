/**
 * Backoff and X rate-limit header parsing.
 *
 * X returns on every response:
 *   x-rate-limit-limit      window ceiling for this endpoint
 *   x-rate-limit-remaining  calls left in the window
 *   x-rate-limit-reset      epoch SECONDS when the window resets
 * and on 429 sometimes also `retry-after` (seconds).
 */
import type { HeaderMap } from "../errors";

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 0..1 fraction of jitter applied to the computed delay. */
  jitter?: number;
  random?: () => number;
}

/** Exponential backoff: base * 2^attempt, capped, with optional jitter. attempt is 0-based. */
export function backoffMs(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 1000;
  const max = opts.maxMs ?? 60_000;
  const jitter = opts.jitter ?? 0.2;
  const rnd = opts.random ?? Math.random;
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt));
  const spread = raw * jitter * (rnd() * 2 - 1);
  return Math.max(0, Math.round(raw + spread));
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  /** Epoch milliseconds. */
  resetAt?: number;
  /** From `retry-after`, in ms. */
  retryAfterMs?: number;
}

export function parseRateLimitHeaders(headers: HeaderMap): RateLimitInfo {
  const info: RateLimitInfo = {};
  const limit = num(headers["x-rate-limit-limit"]);
  const remaining = num(headers["x-rate-limit-remaining"]);
  const reset = num(headers["x-rate-limit-reset"]);
  const retryAfter = num(headers["retry-after"]);
  if (limit !== undefined) info.limit = limit;
  if (remaining !== undefined) info.remaining = remaining;
  if (reset !== undefined) info.resetAt = reset * 1000;
  if (retryAfter !== undefined) info.retryAfterMs = retryAfter * 1000;
  return info;
}

/**
 * How long to wait after a 429 given its headers: retry-after wins, then the
 * reset timestamp, else undefined (caller falls back to exponential backoff).
 */
export function waitFromHeaders(headers: HeaderMap, now: number): number | undefined {
  const info = parseRateLimitHeaders(headers);
  if (info.retryAfterMs !== undefined) return info.retryAfterMs;
  if (info.resetAt !== undefined) return Math.max(0, info.resetAt - now);
  return undefined;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
