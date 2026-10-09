/**
 * Dead-letter queue for X writes that failed after all retries.
 *
 * Every failed write is kept with its input, the error, and attempt count, so
 * the UI can show it and a human (or the Voice, on an enabled autopilot) can
 * retry it by id. Nothing here is silent: `list()` is the visible failure log.
 *
 * Storage: in-memory, or Redis (REDIS_URL) as one hash `x:dlq` of id → JSON.
 */
import { errorMessage } from "../errors";

export type DeadLetterStatus = "failed" | "retrying" | "resolved";

export interface DeadLetter {
  id: string;
  accountId: string;
  /** Operation name, e.g. "post", "thread", "uploadMedia", "updateProfile". */
  op: string;
  /** The exact input the operation was called with (replayable). */
  input: unknown;
  error: string;
  attempts: number;
  status: DeadLetterStatus;
  createdAt: string;
  lastTriedAt?: string;
  /** Populated when a retry succeeded. */
  result?: unknown;
}

export type DeadLetterInput = Pick<DeadLetter, "accountId" | "op" | "input"> & {
  error: unknown;
  attempts?: number;
};

export type RetryResult =
  | { ok: true; entry: DeadLetter; result: unknown }
  | { ok: false; entry: DeadLetter; error: string };

export type DeadLetterHandler = (entry: DeadLetter) => Promise<unknown>;

export interface DeadLetterQueue {
  add(input: DeadLetterInput): Promise<DeadLetter>;
  get(id: string): Promise<DeadLetter | null>;
  /** Newest first. */
  list(): Promise<DeadLetter[]>;
  /** Re-runs the original operation. Handlers are keyed by `${accountId}:${op}`. */
  retry(id: string): Promise<RetryResult>;
  remove(id: string): Promise<void>;
  setHandler(accountId: string, op: string, handler: DeadLetterHandler): void;
  /** Used when no specific handler matches; lets a runtime build the client lazily. */
  setDefaultHandler(handler: DeadLetterHandler): void;
}

let seq = 0;
function newId(now: number): string {
  seq += 1;
  return `dlq_${now.toString(36)}_${seq.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Shared retry/handler logic; subclasses supply storage. */
export abstract class BaseDeadLetterQueue implements DeadLetterQueue {
  private readonly handlers = new Map<string, DeadLetterHandler>();
  private defaultHandler: DeadLetterHandler | null = null;
  protected readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  protected abstract load(id: string): Promise<DeadLetter | null>;
  protected abstract save(entry: DeadLetter): Promise<void>;
  protected abstract all(): Promise<DeadLetter[]>;
  protected abstract del(id: string): Promise<void>;

  async add(input: DeadLetterInput): Promise<DeadLetter> {
    const t = this.now();
    const entry: DeadLetter = {
      id: newId(t),
      accountId: input.accountId,
      op: input.op,
      input: input.input,
      error: errorMessage(input.error),
      attempts: input.attempts ?? 1,
      status: "failed",
      createdAt: new Date(t).toISOString(),
    };
    await this.save(entry);
    return entry;
  }

  get(id: string): Promise<DeadLetter | null> {
    return this.load(id);
  }

  async list(): Promise<DeadLetter[]> {
    const rows = await this.all();
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  remove(id: string): Promise<void> {
    return this.del(id);
  }

  setHandler(accountId: string, op: string, handler: DeadLetterHandler): void {
    this.handlers.set(`${accountId}:${op}`, handler);
  }

  setDefaultHandler(handler: DeadLetterHandler): void {
    this.defaultHandler = handler;
  }

  async retry(id: string): Promise<RetryResult> {
    const entry = await this.load(id);
    if (!entry) throw new Error(`x.dlq: no dead letter ${id}`);
    if (entry.status === "resolved") return { ok: true, entry, result: entry.result };
    const handler = this.handlers.get(`${entry.accountId}:${entry.op}`) ?? this.defaultHandler;
    if (!handler) {
      return { ok: false, entry, error: `no handler for ${entry.accountId}:${entry.op}` };
    }
    entry.status = "retrying";
    entry.attempts += 1;
    entry.lastTriedAt = new Date(this.now()).toISOString();
    await this.save(entry);
    try {
      const result = await handler(entry);
      entry.status = "resolved";
      entry.result = result;
      await this.save(entry);
      return { ok: true, entry, result };
    } catch (err) {
      entry.status = "failed";
      entry.error = errorMessage(err);
      await this.save(entry);
      return { ok: false, entry, error: entry.error };
    }
  }
}

/* ─────────────────────────── in-memory ─────────────────────────── */

export class MemoryDeadLetterQueue extends BaseDeadLetterQueue {
  private readonly rows = new Map<string, DeadLetter>();
  protected async load(id: string): Promise<DeadLetter | null> {
    const e = this.rows.get(id);
    return e ? structuredClone(e) : null;
  }
  protected async save(entry: DeadLetter): Promise<void> {
    this.rows.set(entry.id, structuredClone(entry));
  }
  protected async all(): Promise<DeadLetter[]> {
    return [...this.rows.values()].map((e) => structuredClone(e));
  }
  protected async del(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

/* ─────────────────────────── redis ─────────────────────────── */

/** The slice of ioredis we use, so tests can inject a fake. */
export interface RedisLike {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, field: string): Promise<unknown>;
  incrby(key: string, n: number): Promise<number>;
  get(key: string): Promise<string | null>;
}

export const DLQ_REDIS_KEY = "x:dlq";

export class RedisDeadLetterQueue extends BaseDeadLetterQueue {
  constructor(
    private readonly redis: RedisLike,
    now: () => number = Date.now,
    private readonly key: string = DLQ_REDIS_KEY,
  ) {
    super(now);
  }
  protected async load(id: string): Promise<DeadLetter | null> {
    const raw = await this.redis.hget(this.key, id);
    return raw ? (JSON.parse(raw) as DeadLetter) : null;
  }
  protected async save(entry: DeadLetter): Promise<void> {
    await this.redis.hset(this.key, entry.id, JSON.stringify(entry));
  }
  protected async all(): Promise<DeadLetter[]> {
    const map = await this.redis.hgetall(this.key);
    return Object.values(map).map((raw) => JSON.parse(raw) as DeadLetter);
  }
  protected async del(id: string): Promise<void> {
    await this.redis.hdel(this.key, id);
  }
}

/** Connects ioredis to REDIS_URL. Only imported when actually needed. */
export async function connectRedis(url: string): Promise<RedisLike> {
  const { default: Redis } = await import("ioredis");
  return new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false }) as unknown as RedisLike;
}

/** REDIS_URL set → Redis-backed; else in-memory (failures vanish on restart; the README says so). */
export async function createDeadLetterQueueFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  now: () => number = Date.now,
): Promise<DeadLetterQueue> {
  const url = env["REDIS_URL"];
  if (url) return new RedisDeadLetterQueue(await connectRedis(url), now);
  return new MemoryDeadLetterQueue(now);
}
