/**
 * Builds every client the launches share from the environment, once per process.
 * A client that cannot be built is kept as its NotImplemented (exact text + env
 * var names) and surfaces on /api/status and on each launch; nothing is faked.
 */
import type { Env } from "./types";
import { storeKindFromEnv, streamKindFromEnv } from "@quantagent/core";
import type { HostingClient, ImageClient, LlmClient, QuantumClient } from "@quantagent/core/types/clients";
import {
  MemoryKeyStore,
  PgKeyStore,
  WebhookHub,
  anuProviderFromEnv,
  createHeliusWebhookHandler,
  createQuantumClient,
  heliusWebhookConfigFromEnv,
  type KeyStore,
  type WebhookRequest,
  type WebhookResponse,
} from "@quantagent/solana";
import { hostingClientFromEnv, imageClientFromEnv } from "@quantagent/workers";
import { createXRuntime, type XRuntime } from "@quantagent/x";
import { NotImplemented } from "@quantagent/core/types";
import { attempt, attemptSync, type Result } from "./errors";
import { llmClientFromEnv } from "./llm";

export interface SharedClients {
  llm: Result<LlmClient>;
  image: Result<ImageClient>;
  hosting: Result<HostingClient>;
  quantum: Result<QuantumClient>;
  x: Result<XRuntime>;
  wallets: { kind: "memory" | "postgres"; keyStore: KeyStore };
  /** Shared across launches so one HTTP route serves every Helius webhook. */
  hub: WebhookHub;
  webhook: Result<(req: WebhookRequest) => WebhookResponse>;
  store: { events: "memory" | "postgres"; stream: "memory" | "redis"; tokens: "memory" | "postgres" | "unavailable" };
}

export interface BuildSharedOptions {
  fetch?: typeof fetch;
  /** Injected Postgres pool (tests); default: a pg Pool on DATABASE_URL when set. */
  pg?: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
}

async function walletKeyStore(env: Env, opts: BuildSharedOptions): Promise<SharedClients["wallets"]> {
  const url = env["DATABASE_URL"]?.trim();
  if (!url && !opts.pg) return { kind: "memory", keyStore: new MemoryKeyStore() };
  let db = opts.pg;
  if (!db) {
    const { default: pg } = await import("pg");
    db = new pg.Pool({ connectionString: url });
  }
  const store = new PgKeyStore(db);
  await store.ensureSchema();
  return { kind: "postgres", keyStore: store };
}

export async function buildSharedClients(env: Env = process.env, opts: BuildSharedOptions = {}): Promise<SharedClients> {
  const e = env as Record<string, string | undefined>;
  const fetchOpt = opts.fetch ? { fetch: opts.fetch } : {};

  const llm = attemptSync(() => llmClientFromEnv(env, opts.fetch));
  const image = attemptSync(() => imageClientFromEnv(fetchOpt));
  const hosting = attemptSync(() => hostingClientFromEnv(fetchOpt));
  // The ANU provider is resolved now so a missing key is reported before any draw.
  const quantum = attemptSync(() => {
    const provider = anuProviderFromEnv(e, opts.fetch);
    return createQuantumClient({ provider, env: e, ...fetchOpt });
  });
  // @quantagent/x types its env as NodeJS.ProcessEnv; Next augments that with a required NODE_ENV the app does not rely on.
  const x = await attempt(() => createXRuntime({ env: env as NodeJS.ProcessEnv, ...(opts.fetch ? { fetch: opts.fetch } : {}) }));

  const walletsResult = await attempt(() => walletKeyStore(env, opts));
  const wallets: SharedClients["wallets"] = walletsResult.ok ? walletsResult.value : { kind: "memory", keyStore: new MemoryKeyStore() };

  const hub = new WebhookHub();
  const webhook = attemptSync(() => {
    const cfg = heliusWebhookConfigFromEnv(e, opts.fetch);
    if (!cfg) {
      throw new NotImplemented("Helius webhook", "Helius webhooks are not configured; anomaly detection falls back to RPC polling", [
        "HELIUS_API_KEY",
        "HELIUS_WEBHOOK_URL",
        "HELIUS_WEBHOOK_SECRET",
      ]);
    }
    return createHeliusWebhookHandler({ secret: cfg.secret, hub });
  });

  const tokens: SharedClients["store"]["tokens"] = x.ok
    ? env["DATABASE_URL"]?.trim()
      ? "postgres"
      : "memory"
    : "unavailable";

  return {
    llm,
    image,
    hosting,
    quantum,
    x,
    wallets,
    hub,
    webhook,
    store: { events: storeKindFromEnv(env), stream: streamKindFromEnv(env), tokens },
  };
}
