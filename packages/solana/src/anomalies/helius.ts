/**
 * Helius webhooks (https://www.helius.dev/docs/api-reference/webhooks).
 *
 * Verified from the Helius API reference (field list, 2026-10-09):
 *   POST https://api.helius.xyz/v0/webhooks?api-key=KEY
 *   body { webhookURL, transactionTypes, accountAddresses, webhookType, authHeader, txnStatus, encoding }
 *   webhookType ∈ enhanced | raw | discord | enhancedDevnet | rawDevnet | discordDevnet
 *   DELETE https://api.helius.xyz/v0/webhooks/{webhookID}?api-key=KEY
 * The enhanced transaction payload shape below (signature, slot, timestamp,
 * feePayer, tokenTransfers[], nativeTransfers[], type, source) follows the
 * Helius "Enhanced Transactions" sample and is treated as best-effort.
 *
 * Helius posts to webhookURL with `Authorization: <authHeader>`; the handler
 * here compares it with HELIUS_WEBHOOK_SECRET in constant time.
 */

import { timingSafeEqual } from "node:crypto";
import type { Cluster } from "../cluster";
import { envOf, fetchOf, type Env, type FetchLike } from "../env";
import type { NormalizedTx } from "./types";

export const HELIUS_WEBHOOK_API = "https://api.helius.xyz/v0/webhooks";

export interface HeliusWebhookConfig {
  apiKey: string;
  webhookUrl: string;
  secret: string;
  fetch: FetchLike;
  apiBase?: string;
}

/** null when any of HELIUS_API_KEY / HELIUS_WEBHOOK_URL / HELIUS_WEBHOOK_SECRET is missing (polling fallback is used). */
export function heliusWebhookConfigFromEnv(env?: Env, fetch?: FetchLike): HeliusWebhookConfig | null {
  const e = envOf(env);
  const apiKey = e.HELIUS_API_KEY?.trim();
  const webhookUrl = e.HELIUS_WEBHOOK_URL?.trim();
  const secret = e.HELIUS_WEBHOOK_SECRET?.trim();
  if (!apiKey || !webhookUrl || !secret) return null;
  const cfg: HeliusWebhookConfig = { apiKey, webhookUrl, secret, fetch: fetchOf(fetch) };
  if (e.HELIUS_WEBHOOK_API) cfg.apiBase = e.HELIUS_WEBHOOK_API;
  return cfg;
}

export function webhookTypeFor(cluster: Cluster): "enhanced" | "enhancedDevnet" {
  return cluster === "devnet" ? "enhancedDevnet" : "enhanced";
}

export async function createWebhook(input: { addresses: string[]; cluster: Cluster }, cfg: HeliusWebhookConfig): Promise<{ webhookID: string }> {
  const url = `${cfg.apiBase ?? HELIUS_WEBHOOK_API}?api-key=${encodeURIComponent(cfg.apiKey)}`;
  const body = {
    webhookURL: cfg.webhookUrl,
    transactionTypes: ["ANY"],
    accountAddresses: input.addresses,
    webhookType: webhookTypeFor(input.cluster),
    authHeader: cfg.secret,
    txnStatus: "success",
  };
  const res = await cfg.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Helius create webhook failed ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { webhookID?: string };
  if (!json.webhookID) throw new Error(`Helius create webhook returned no webhookID: ${text.slice(0, 300)}`);
  return { webhookID: json.webhookID };
}

export async function deleteWebhook(webhookID: string, cfg: HeliusWebhookConfig): Promise<void> {
  const url = `${cfg.apiBase ?? HELIUS_WEBHOOK_API}/${encodeURIComponent(webhookID)}?api-key=${encodeURIComponent(cfg.apiKey)}`;
  const res = await cfg.fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Helius delete webhook ${webhookID} failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/* ───────── enhanced transaction payload ───────── */

export interface EnhancedTransaction {
  signature: string;
  slot: number;
  timestamp?: number;
  type?: string;
  source?: string;
  feePayer?: string;
  transactionError?: unknown;
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[];
  tokenTransfers?: {
    fromUserAccount?: string;
    toUserAccount?: string;
    fromTokenAccount?: string;
    toTokenAccount?: string;
    tokenAmount?: number;
    mint?: string;
  }[];
}

export function normalizeEnhanced(tx: EnhancedTransaction): NormalizedTx {
  const out: NormalizedTx = {
    signature: tx.signature,
    slot: tx.slot,
    blockTime: typeof tx.timestamp === "number" ? tx.timestamp : null,
    feePayer: tx.feePayer ?? "",
    tokenTransfers: (tx.tokenTransfers ?? [])
      .filter((t) => typeof t.mint === "string")
      .map((t) => ({ from: t.fromUserAccount ?? "", to: t.toUserAccount ?? "", mint: t.mint as string, amount: Number(t.tokenAmount ?? 0) })),
    nativeTransfers: (tx.nativeTransfers ?? []).map((n) => ({ from: n.fromUserAccount ?? "", to: n.toUserAccount ?? "", lamports: Number(n.amount ?? 0) })),
  };
  if (tx.type) out.type = tx.type;
  if (tx.source) out.source = tx.source;
  return out;
}

/* ───────── routing from one HTTP endpoint to many watchers ───────── */

export type TxListener = (txs: NormalizedTx[]) => void;

export class WebhookHub {
  private readonly listeners = new Map<string, Set<{ fn: TxListener; wallets: Set<string> }>>();

  /** `wallets` are extra addresses (creator, agent wallet) whose activity also belongs to this mint. */
  subscribe(mint: string, fn: TxListener, wallets: string[] = []): () => void {
    const entry = { fn, wallets: new Set(wallets) };
    const set = this.listeners.get(mint) ?? new Set();
    set.add(entry);
    this.listeners.set(mint, set);
    return () => {
      set.delete(entry);
      if (set.size === 0) this.listeners.delete(mint);
    };
  }

  get size(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }

  dispatch(txs: NormalizedTx[]): void {
    for (const [mint, set] of this.listeners) {
      for (const l of set) {
        const mine = txs.filter(
          (tx) =>
            tx.tokenTransfers.some((t) => t.mint === mint) ||
            l.wallets.has(tx.feePayer) ||
            tx.nativeTransfers.some((n) => l.wallets.has(n.from) || l.wallets.has(n.to)),
        );
        if (mine.length > 0) l.fn(mine);
      }
    }
  }
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Parsed JSON body, or the raw string. */
  body: unknown;
}

export interface WebhookResponse {
  status: number;
  body: string;
}

function headerValue(h: WebhookRequest["headers"], name: string): string | undefined {
  const v = h[name] ?? h[name.toLowerCase()] ?? h[name.charAt(0).toUpperCase() + name.slice(1)];
  return Array.isArray(v) ? v[0] : v;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Framework-agnostic handler: mount it on the app's HTTP route, feed it headers + body. */
export function createHeliusWebhookHandler(input: { secret: string; hub: WebhookHub }): (req: WebhookRequest) => WebhookResponse {
  return (req) => {
    const auth = headerValue(req.headers, "authorization") ?? "";
    if (!safeEqual(auth, input.secret)) return { status: 401, body: "bad webhook secret" };
    let parsed: unknown = req.body;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return { status: 400, body: "body is not JSON" };
      }
    }
    if (!Array.isArray(parsed)) return { status: 400, body: "expected an array of enhanced transactions" };
    const txs = (parsed as EnhancedTransaction[])
      .filter((t) => t && typeof t.signature === "string" && typeof t.slot === "number" && !t.transactionError)
      .map(normalizeEnhanced);
    input.hub.dispatch(txs);
    return { status: 200, body: `ok ${txs.length}` };
  };
}
