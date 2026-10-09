import { Redis } from "ioredis";
import type { QuantagentEvent } from "../../types/index";
import type { StreamAdapter } from "./store";

export const REDIS_CHANNEL_PREFIX = "quantagent:events";

interface Envelope {
  origin: string;
  event: QuantagentEvent;
}

type Handler = (event: QuantagentEvent, origin: string) => void;

/**
 * Redis pub/sub stream. One connection publishes, a second (subscriber-mode)
 * connection receives. Constructed only when REDIS_URL is set; see createStreamFromEnv().
 */
export class RedisStream implements StreamAdapter {
  readonly kind = "redis" as const;
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly handlers = new Map<string, Set<Handler>>(); // channel -> handlers
  private readonly all = new Set<Handler>();
  private initialized = false;

  constructor(redisUrl: string) {
    if (!redisUrl) throw new Error("RedisStream requires a redis url");
    this.pub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
    this.sub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
    this.sub.on("message", (channel: string, raw: string) => this.onMessage(channel, raw));
  }

  static channelFor(launchId: string): string {
    return `${REDIS_CHANNEL_PREFIX}:${launchId}`;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await Promise.all([this.pub.connect(), this.sub.connect()]);
    await this.sub.subscribe(REDIS_CHANNEL_PREFIX);
    this.initialized = true;
  }

  private onMessage(channel: string, raw: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(raw) as Envelope;
    } catch {
      return; // not ours; never throw inside a socket handler
    }
    if (!env || typeof env !== "object" || !env.event) return;
    if (channel === REDIS_CHANNEL_PREFIX) {
      for (const h of this.all) safeCall(h, env);
      return;
    }
    const set = this.handlers.get(channel);
    if (set) for (const h of set) safeCall(h, env);
  }

  async publish(event: QuantagentEvent, origin: string): Promise<void> {
    await this.init();
    const raw = JSON.stringify({ origin, event } satisfies Envelope);
    await Promise.all([
      this.pub.publish(RedisStream.channelFor(event.launchId), raw),
      this.pub.publish(REDIS_CHANNEL_PREFIX, raw),
    ]);
  }

  subscribe(launchId: string | null, handler: Handler): () => void {
    if (launchId === null) {
      this.all.add(handler);
      return () => {
        this.all.delete(handler);
      };
    }
    const channel = RedisStream.channelFor(launchId);
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      void this.init().then(() => this.sub.subscribe(channel));
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(channel);
        if (this.initialized) void this.sub.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
    this.all.clear();
    await Promise.all([this.pub.quit().catch(() => undefined), this.sub.quit().catch(() => undefined)]);
    this.initialized = false;
  }
}

function safeCall(h: Handler, env: Envelope): void {
  try {
    h(env.event, env.origin);
  } catch {
    // a subscriber throwing must not break delivery to the others
  }
}
