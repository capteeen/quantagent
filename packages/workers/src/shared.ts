/**
 * Small helpers shared by workers. No provider code, no fakes.
 */

import { NotImplemented, type EventOf, type QuantagentEvent } from "@quantagent/core/types";
import type { WorkerClients, WorkerContext } from "./context";

/**
 * Env vars that unblock each client when the runtime did not inject one.
 * The client implementations live in other packages (x, solana) or in this
 * package's adapters (image providers, hosting). Documented in README "Environment".
 */
export const CLIENT_NEEDS: Record<keyof WorkerClients, string[]> = {
  llm: ["LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL"],
  image: ["IMAGE_PROVIDER=openai|fal|replicate", "OPENAI_API_KEY | FAL_KEY | REPLICATE_API_TOKEN"],
  x: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  solana: ["SOLANA_RPC_URL", "AGENT_WALLET_KEY"],
  hosting: [
    "HOSTING_PROVIDER=cloudflare|vercel",
    "CF_API_TOKEN, CF_ACCOUNT_ID, CF_PAGES_PROJECT | VERCEL_TOKEN, VERCEL_PROJECT",
  ],
  quantum: ["ANU_QRNG_API_KEY"],
};

/** Returns the client or throws NotImplemented naming the exact env vars. */
export function requireClient<K extends keyof WorkerClients>(
  ctx: WorkerContext,
  key: K,
  capability: string,
): NonNullable<WorkerClients[K]> {
  const client = ctx.clients[key];
  if (!client) {
    throw new NotImplemented(capability, `no ${key} client was injected into the worker context`, CLIENT_NEEDS[key]);
  }
  return client as NonNullable<WorkerClients[K]>;
}

/** One-line error text for reasons and payloads. */
export function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** Run `fn` with at most `limit` concurrent invocations; results keep input order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (next < items.length) {
        const i = next++;
        const item = items[i] as T;
        try {
          results[i] = { status: "fulfilled", value: await fn(item, i) };
        } catch (reason) {
          results[i] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}

/** Base58 alphabet (no 0, O, I, l). Solana addresses are 32–44 chars of it. */
export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isBase58Address(s: string): boolean {
  return BASE58_RE.test(s);
}

/** Every base58 token of Solana-address length found in a text (for "CA is never wrong" checks). */
export function findBase58Addresses(text: string): string[] {
  return (text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? []).filter((t) => BASE58_RE.test(t));
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Resolves when `ms` elapsed or rejects when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Reads an env var; empty string counts as unset. */
export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Throws NotImplemented listing every missing env var for `capability`. */
export function requireEnv(capability: string, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const n of names) {
    const v = env(n);
    if (v) out[n] = v;
    else missing.push(n);
  }
  if (missing.length) throw new NotImplemented(capability, `missing environment: ${missing.join(", ")}`, missing);
  return out;
}

/** A url-safe slug: lowercase a–z0–9 and hyphens, 1–63 chars. */
export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return slug || "coin";
}

/* ───────────── launch gate ─────────────
 * Wait for Launcher.deployed without ever deadlocking the launch: the orchestrator
 * emits Launch.failed only after every worker's start() has settled, so a worker that
 * waits for the coin must also give up when the Launcher fails. Used by the Builder,
 * Voice, Trader and Shield.
 */

/** Records the Launcher's failure from a worker's on(); feed it to waitForDeployed as `alreadyFailed`. */
export function launcherFailureOf(event: QuantagentEvent): string | null {
  if (event.type === "Worker.failed" && event.worker === "Launcher") return event.payload.reason;
  if (event.type === "Launch.failed") return event.payload.reason;
  return null;
}

export class LauncherFailed extends Error {
  override readonly name = "LauncherFailed";
  constructor(public readonly launcherReason: string) {
    super(`Launcher failed before deploying a coin: ${launcherReason}`);
  }
}

/**
 * Resolves with the Launcher.deployed payload, or throws LauncherFailed when the
 * Launcher's Worker.failed (or Launch.failed) arrives first; rejects on abort/stop.
 *
 * The bus only delivers future events to a new wait, so a caller that reaches this
 * point late (after its own scans) must feed what its on() already saw: `already`
 * short-circuits on a recorded deploy, `alreadyFailed` on a recorded Launcher failure
 * (the reason). Without the second probe a Launcher that died first would be missed
 * and the worker would wait forever.
 */
export async function waitForDeployed(
  ctx: WorkerContext,
  already?: () => EventOf<"Launcher.deployed">["payload"] | null,
  alreadyFailed?: () => string | null,
): Promise<EventOf<"Launcher.deployed">["payload"]> {
  const seen = already?.();
  if (seen) return seen;
  const failed = alreadyFailed?.();
  if (failed) throw new LauncherFailed(failed);

  const deployed = ctx.waitFor("Launcher.deployed");
  const launcherFailed = ctx.waitFor("Worker.failed", { predicate: (e) => e.worker === "Launcher" });
  const launchFailed = ctx.waitFor("Launch.failed");
  // Whichever waits lose the race are aborted/garbage later; never let them surface as unhandled.
  deployed.catch(() => undefined);
  launcherFailed.catch(() => undefined);
  launchFailed.catch(() => undefined);

  return Promise.race([
    deployed.then((e) => e.payload),
    launcherFailed.then((e) => {
      throw new LauncherFailed(e.payload.reason);
    }),
    launchFailed.then((e) => {
      throw new LauncherFailed(e.payload.reason);
    }),
  ]);
}
