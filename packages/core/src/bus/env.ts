import { PostgresEventStore } from "./postgres";
import { RedisStream } from "./redis";
import { MemoryEventStore, MemoryStream, type EventStore, type StoreKind, type StreamAdapter, type StreamKind } from "./store";
import { EventBus } from "./bus";

export interface EnvLike {
  DATABASE_URL?: string | undefined;
  REDIS_URL?: string | undefined;
}

/** Postgres when DATABASE_URL is set, otherwise in-memory. Never fakes persistence. */
export function createStoreFromEnv(env: EnvLike = process.env): EventStore {
  const url = env.DATABASE_URL?.trim();
  return url ? new PostgresEventStore(url) : new MemoryEventStore();
}

/** Redis pub/sub when REDIS_URL is set, otherwise in-process. */
export function createStreamFromEnv(env: EnvLike = process.env): StreamAdapter {
  const url = env.REDIS_URL?.trim();
  return url ? new RedisStream(url) : new MemoryStream();
}

export function storeKindFromEnv(env: EnvLike = process.env): StoreKind {
  return env.DATABASE_URL?.trim() ? "postgres" : "memory";
}

export function streamKindFromEnv(env: EnvLike = process.env): StreamKind {
  return env.REDIS_URL?.trim() ? "redis" : "memory";
}

/** A bus wired from the environment. `init()`s the store and stream before returning. */
export async function createBusFromEnv(env: EnvLike = process.env): Promise<EventBus> {
  const store = createStoreFromEnv(env);
  const stream = createStreamFromEnv(env);
  await Promise.all([store.init(), stream.init()]);
  return new EventBus({ store, stream });
}
