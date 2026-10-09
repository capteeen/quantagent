/**
 * Monthly X API call budget.
 *
 * Every HTTP call this package makes to X counts as one. The limit comes from
 * X_MONTHLY_CALL_BUDGET (default 1500). At 100% every call is refused with
 * XBudgetPaused and budget().paused is true, so the Voice stops posting and
 * the UI can say exactly why. The counter resets on the first of the next
 * calendar month (UTC).
 *
 * Counter storage: in-memory, or Redis (REDIS_URL) key `x:budget:<YYYY-MM>`.
 */
import { XBudgetPaused } from "../errors";
import type { RedisLike } from "../ratelimit/dlq";

export const DEFAULT_MONTHLY_CALL_BUDGET = 1500;

export interface BudgetStore {
  get(key: string): Promise<number>;
  incr(key: string, n: number): Promise<number>;
}

export class MemoryBudgetStore implements BudgetStore {
  private readonly counts = new Map<string, number>();
  async get(key: string): Promise<number> {
    return this.counts.get(key) ?? 0;
  }
  async incr(key: string, n: number): Promise<number> {
    const v = (this.counts.get(key) ?? 0) + n;
    this.counts.set(key, v);
    return v;
  }
}

export class RedisBudgetStore implements BudgetStore {
  constructor(private readonly redis: Pick<RedisLike, "get" | "incrby">) {}
  async get(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  async incr(key: string, n: number): Promise<number> {
    return this.redis.incrby(key, n);
  }
}

export interface BudgetStatus {
  used: number;
  limit: number;
  /** ISO, first instant of next month (UTC). */
  resetsAt: string;
  paused: boolean;
  /** 0..100, rounded. */
  percent: number;
  /** "YYYY-MM" the counter belongs to. */
  month: string;
}

export interface MonthlyBudgetOptions {
  limit?: number;
  store?: BudgetStore;
  now?: () => number;
  keyPrefix?: string;
}

export function monthKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthResetAt(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

/** Parses X_MONTHLY_CALL_BUDGET; malformed values fall back to the default rather than silently 0. */
export function budgetLimitFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["X_MONTHLY_CALL_BUDGET"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_MONTHLY_CALL_BUDGET;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`X_MONTHLY_CALL_BUDGET must be a positive number, got "${raw}"`);
  }
  return Math.floor(n);
}

export class MonthlyBudget {
  readonly limit: number;
  private readonly store: BudgetStore;
  private readonly now: () => number;
  private readonly prefix: string;

  constructor(opts: MonthlyBudgetOptions = {}) {
    this.limit = opts.limit ?? DEFAULT_MONTHLY_CALL_BUDGET;
    this.store = opts.store ?? new MemoryBudgetStore();
    this.now = opts.now ?? Date.now;
    this.prefix = opts.keyPrefix ?? "x:budget:";
  }

  private key(): string {
    return this.prefix + monthKey(this.now());
  }

  async status(): Promise<BudgetStatus> {
    const t = this.now();
    const used = await this.store.get(this.key());
    return {
      used,
      limit: this.limit,
      resetsAt: monthResetAt(t),
      paused: used >= this.limit,
      percent: Math.min(100, Math.round((used / this.limit) * 100)),
      month: monthKey(t),
    };
  }

  /** Throws XBudgetPaused when the month's budget is spent. */
  async assertAvailable(): Promise<void> {
    const s = await this.status();
    if (s.paused) throw new XBudgetPaused(s.used, s.limit, s.resetsAt);
  }

  /** Counts `n` calls made. Returns the new total. */
  async record(n = 1): Promise<number> {
    return this.store.incr(this.key(), n);
  }
}
