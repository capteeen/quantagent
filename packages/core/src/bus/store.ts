import type { QuantagentEvent } from "../../types/index";

export type StoreKind = "memory" | "postgres";
export type StreamKind = "memory" | "redis";

/**
 * Durable, append-only log of events keyed by launch id.
 * The bus assigns `seq` before calling append; stores never reorder.
 */
export interface EventStore {
  readonly kind: StoreKind;
  /** Create tables / open connections. Idempotent. */
  init(): Promise<void>;
  append(event: QuantagentEvent): Promise<void>;
  /** All events of a launch ordered by seq, optionally only those with seq > afterSeq. */
  list(launchId: string, afterSeq?: number): Promise<QuantagentEvent[]>;
  /** Highest seq persisted for the launch, or 0 when none. */
  maxSeq(launchId: string): Promise<number>;
  /** Launch ids known to the store, most recent first. */
  launchIds(limit?: number): Promise<string[]>;
  close(): Promise<void>;
}

export type StreamHandler = (event: QuantagentEvent) => void;

/**
 * Cross-process fan-out. Events published here are delivered to every
 * subscriber in every process, including the publisher (the bus dedupes by origin).
 */
export interface StreamAdapter {
  readonly kind: StreamKind;
  init(): Promise<void>;
  publish(event: QuantagentEvent, origin: string): Promise<void>;
  /** Subscribe to one launch, or to every launch with launchId === null. Returns unsubscribe. */
  subscribe(launchId: string | null, handler: (event: QuantagentEvent, origin: string) => void): () => void;
  close(): Promise<void>;
}

/** In-memory store: the default when DATABASE_URL is not set. Lost on process exit. */
export class MemoryEventStore implements EventStore {
  readonly kind = "memory" as const;
  private readonly logs = new Map<string, QuantagentEvent[]>();

  async init(): Promise<void> {}

  async append(event: QuantagentEvent): Promise<void> {
    const log = this.logs.get(event.launchId) ?? [];
    if (log.length === 0) this.logs.set(event.launchId, log);
    log.push(event);
  }

  async list(launchId: string, afterSeq = 0): Promise<QuantagentEvent[]> {
    return (this.logs.get(launchId) ?? []).filter((e) => e.seq > afterSeq).sort((a, b) => a.seq - b.seq);
  }

  async maxSeq(launchId: string): Promise<number> {
    const log = this.logs.get(launchId) ?? [];
    return log.reduce((m, e) => (e.seq > m ? e.seq : m), 0);
  }

  async launchIds(limit = 100): Promise<string[]> {
    return [...this.logs.keys()].reverse().slice(0, limit);
  }

  async close(): Promise<void> {
    this.logs.clear();
  }
}

/** In-process stream: delivers to subscribers in this process only. */
export class MemoryStream implements StreamAdapter {
  readonly kind = "memory" as const;
  private readonly handlers = new Set<{
    launchId: string | null;
    handler: (event: QuantagentEvent, origin: string) => void;
  }>();

  async init(): Promise<void> {}

  async publish(event: QuantagentEvent, origin: string): Promise<void> {
    for (const h of this.handlers) {
      if (h.launchId === null || h.launchId === event.launchId) h.handler(event, origin);
    }
  }

  subscribe(launchId: string | null, handler: (event: QuantagentEvent, origin: string) => void): () => void {
    const entry = { launchId, handler };
    this.handlers.add(entry);
    return () => {
      this.handlers.delete(entry);
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
