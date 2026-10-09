import { nanoid } from "nanoid";
import type { EmitInput, EventType, QuantagentEvent, WorkerName } from "../../types/index";
import { MemoryEventStore, MemoryStream, type EventStore, type StreamAdapter } from "./store";

export interface SubscribeFilter {
  launchId?: string;
  types?: readonly EventType[];
  worker?: WorkerName;
}

export type EventHandler = (event: QuantagentEvent) => void;

export interface EventBusOptions {
  store?: EventStore;
  stream?: StreamAdapter;
  /** Called when persistence or streaming fails. Default: console.error. */
  onError?: (error: unknown, event: QuantagentEvent) => void;
  now?: () => Date;
}

interface Subscription {
  filter: SubscribeFilter;
  handler: EventHandler;
}

/**
 * Typed event bus.
 *
 * - `emit` assigns id/at/seq, delivers to in-process subscribers synchronously
 *   (so reactions to e.g. Launcher.deployed happen on the same tick), then persists
 *   through the store and fans out through the stream adapter.
 * - `replay`/`log` read the persisted log; `toSSE` streams history + live events.
 */
export class EventBus {
  readonly store: EventStore;
  readonly stream: StreamAdapter;
  /** Identifies this process's bus so stream echoes are ignored. */
  readonly origin = nanoid(12);
  private readonly subs = new Set<Subscription>();
  private readonly seqs = new Map<string, number>();
  private readonly pending = new Set<Promise<void>>();
  private readonly onError: (error: unknown, event: QuantagentEvent) => void;
  private readonly now: () => Date;
  private unsubscribeStream: (() => void) | null = null;
  private closed = false;

  constructor(opts: EventBusOptions = {}) {
    this.store = opts.store ?? new MemoryEventStore();
    this.stream = opts.stream ?? new MemoryStream();
    this.onError = opts.onError ?? ((err, ev) => console.error(`[bus] ${ev.type} ${ev.launchId}`, err));
    this.now = opts.now ?? (() => new Date());
    this.unsubscribeStream = this.stream.subscribe(null, (event, origin) => {
      if (origin === this.origin) return; // our own echo
      this.dispatch(event);
    });
  }

  getStoreKind(): EventStore["kind"] {
    return this.store.kind;
  }

  getStreamKind(): StreamAdapter["kind"] {
    return this.stream.kind;
  }

  /**
   * Continue a launch's seq counter from the store (after a process restart).
   * Returns the seq it resumed at.
   */
  async resume(launchId: string): Promise<number> {
    const max = await this.store.maxSeq(launchId);
    const current = this.seqs.get(launchId) ?? 0;
    const seq = Math.max(max, current);
    this.seqs.set(launchId, seq);
    return seq;
  }

  /** Current in-memory seq for a launch (0 when nothing was emitted here). */
  seq(launchId: string): number {
    return this.seqs.get(launchId) ?? 0;
  }

  emit(launchId: string, input: EmitInput): QuantagentEvent {
    if (this.closed) throw new Error("EventBus is closed");
    const seq = (this.seqs.get(launchId) ?? 0) + 1;
    this.seqs.set(launchId, seq);
    const event = {
      ...input,
      id: nanoid(),
      launchId,
      at: this.now().toISOString(),
      seq,
    } as QuantagentEvent;
    // Persist before dispatching: a subscriber may emit a nested event (e.g. Launch.live
    // in reaction to Builder.published) and the log must keep seq order.
    this.track(this.store.append(event), event);
    this.dispatch(event);
    this.track(this.stream.publish(event, this.origin), event);
    return event;
  }

  private track(p: Promise<void>, event: QuantagentEvent): void {
    const tracked: Promise<void> = p
      .catch((err) => this.onError(err, event))
      .finally(() => {
        this.pending.delete(tracked);
      });
    this.pending.add(tracked);
  }

  /** Resolves once every emitted event so far has been persisted and published. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  private dispatch(event: QuantagentEvent): void {
    for (const sub of [...this.subs]) {
      if (!matches(sub.filter, event)) continue;
      try {
        sub.handler(event);
      } catch (err) {
        this.onError(err, event);
      }
    }
  }

  subscribe(handler: EventHandler, filter: SubscribeFilter = {}): () => void {
    const sub: Subscription = { filter, handler };
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  /** Resolves with the first event matching the filter (and predicate), or rejects on timeout/abort. */
  waitFor<T extends EventType>(
    launchId: string,
    type: T,
    opts: { predicate?: (e: Extract<QuantagentEvent, { type: T }>) => boolean; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<Extract<QuantagentEvent, { type: T }>> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        unsub();
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(opts.signal?.reason instanceof Error ? opts.signal.reason : new Error("aborted"));
      };
      const unsub = this.subscribe(
        (e) => {
          const typed = e as Extract<QuantagentEvent, { type: T }>;
          if (opts.predicate && !opts.predicate(typed)) return;
          cleanup();
          resolve(typed);
        },
        { launchId, types: [type] },
      );
      if (opts.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`timed out waiting for ${type} on launch ${launchId}`));
        }, opts.timeoutMs);
      }
      if (opts.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /** The persisted log of a launch, ordered by seq. */
  async log(launchId: string, afterSeq = 0): Promise<QuantagentEvent[]> {
    await this.flush();
    return this.store.list(launchId, afterSeq);
  }

  /** Replays the persisted log through `handler` in order. Returns the events replayed. */
  async replay(launchId: string, handler: EventHandler, afterSeq = 0): Promise<QuantagentEvent[]> {
    const events = await this.log(launchId, afterSeq);
    for (const e of events) handler(e);
    return events;
  }

  /**
   * Async iterator over a launch's events: persisted history first (after `afterSeq`),
   * then live events as they arrive. Ends when `signal` aborts.
   */
  async *events(
    launchId: string,
    opts: { afterSeq?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<QuantagentEvent, void, undefined> {
    const queue: QuantagentEvent[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    const unsub = this.subscribe(
      (e) => {
        queue.push(e);
        wake?.();
      },
      { launchId },
    );
    const onAbort = () => {
      done = true;
      wake?.();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      let lastSeq = opts.afterSeq ?? 0;
      const history = await this.store.list(launchId, lastSeq);
      for (const e of history) {
        lastSeq = e.seq;
        yield e;
      }
      while (!done) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            wake = r;
          });
          wake = null;
          continue;
        }
        const e = queue.shift()!;
        if (e.seq <= lastSeq) continue; // already yielded from history
        lastSeq = e.seq;
        yield e;
      }
    } finally {
      unsub();
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * SSE frames (`id`, `event`, `data`) for one launch: history then live.
   * Pass `afterSeq` from the client's Last-Event-ID header to resume.
   */
  async *toSSE(
    launchId: string,
    opts: { afterSeq?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<string, void, undefined> {
    for await (const e of this.events(launchId, opts)) yield sseFrame(e);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribeStream?.();
    this.unsubscribeStream = null;
    await this.flush();
    this.subs.clear();
    await Promise.all([this.store.close(), this.stream.close()]);
  }
}

/** Formats one event as a text/event-stream frame. */
export function sseFrame(event: QuantagentEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function matches(filter: SubscribeFilter, event: QuantagentEvent): boolean {
  if (filter.launchId !== undefined && event.launchId !== filter.launchId) return false;
  if (filter.types && !filter.types.includes(event.type)) return false;
  if (filter.worker !== undefined && ("worker" in event ? event.worker : undefined) !== filter.worker) return false;
  return true;
}
