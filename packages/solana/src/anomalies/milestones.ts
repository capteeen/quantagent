/**
 * watchMilestones: polls market cap (pump.fun coin endpoint, usd_market_cap)
 * and holder count (Helius DAS getTokenAccounts when HELIUS_API_KEY is set,
 * else getProgramAccounts on the token program) and emits each threshold
 * once, in ascending order.
 *
 * Helius DAS (verified field list): POST <helius rpc> {"jsonrpc":"2.0","id":"1",
 * "method":"getTokenAccounts","params":{"mint","page","limit","cursor","options":{"showZeroBalance":false}}}
 * → result { total, limit, cursor, token_accounts[{address, mint, owner, amount, delegated_amount, frozen}] }
 */

import { PublicKey } from "@solana/web3.js";
import type { Cluster, Rpc } from "../cluster";
import { envNumber, envNumberList, envOf, fetchOf, type Env, type FetchLike } from "../env";
import { getCoin, pumpFunApiConfigFromEnv, type PumpFunApiConfig } from "../discovery/pumpfunApi";

export const DEFAULT_MCAP_USD = [10_000, 50_000, 100_000, 1_000_000];
export const DEFAULT_HOLDERS = [100, 500, 1_000];
export const DEFAULT_MILESTONE_POLL_MS = 30_000;
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export type HolderCounter = (mint: string) => Promise<number>;

/** Distinct owners with a non-zero balance via Helius DAS. */
export function heliusHolderCounter(input: { apiKey: string; cluster: Cluster; fetch?: FetchLike; rpcUrl?: string }): HolderCounter {
  const fetch = fetchOf(input.fetch);
  const url = input.rpcUrl ?? `https://${input.cluster === "devnet" ? "devnet" : "mainnet"}.helius-rpc.com/?api-key=${encodeURIComponent(input.apiKey)}`;
  return async (mint) => {
    const owners = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const params: Record<string, unknown> = { mint, limit: 1000, options: { showZeroBalance: false } };
      if (cursor) params.cursor = cursor;
      else params.page = 1;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "quantagent-holders", method: "getTokenAccounts", params }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Helius getTokenAccounts HTTP ${res.status}: ${text.slice(0, 200)}`);
      const json = JSON.parse(text) as { result?: unknown; error?: { message?: string } };
      if (json.error) throw new Error(`Helius getTokenAccounts error: ${json.error.message ?? JSON.stringify(json.error)}`);
      const result = (json.result ?? json) as { token_accounts?: { owner?: string; amount?: number }[]; cursor?: string };
      const accounts = result.token_accounts ?? [];
      for (const a of accounts) if (a.owner && Number(a.amount ?? 0) > 0) owners.add(a.owner);
      if (!result.cursor || accounts.length === 0) break;
      cursor = result.cursor;
    }
    return owners.size;
  };
}

/** Keyless fallback: SPL token accounts for the mint with amount > 0 (dataSlice on the u64 amount at offset 64). */
export function rpcHolderCounter(rpc: Rpc): HolderCounter {
  return async (mint) => {
    const accounts = await rpc.getProgramAccounts(TOKEN_PROGRAM_ID, {
      commitment: "confirmed",
      dataSlice: { offset: 64, length: 8 },
      filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }],
    });
    let n = 0;
    for (const a of accounts) {
      const data = a.account.data as Buffer;
      if (data.length >= 8 && data.readBigUInt64LE(0) > 0n) n++;
    }
    return n;
  };
}

export interface WatchMilestonesOptions {
  rpc: Rpc;
  cluster: Cluster;
  env?: Env;
  fetch?: FetchLike;
  api?: PumpFunApiConfig;
  holderCounter?: HolderCounter;
  mcapUsdOf?: (mint: string) => Promise<number | null>;
  pollMs?: number;
  thresholds?: { mcapUsd?: number[]; holders?: number[] };
  onError?: (err: Error) => void;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}

export async function watchMilestones(
  input: { coinCa: string; onMilestone: (m: { kind: "mcap" | "holders"; value: number }) => void },
  opts: WatchMilestonesOptions,
): Promise<() => void> {
  const env = envOf(opts.env);
  const api = opts.api ?? pumpFunApiConfigFromEnv(env, opts.fetch);
  const onError = opts.onError ?? (() => {});
  const mcapThresholds = opts.thresholds?.mcapUsd ?? envNumberList(env, "MILESTONE_MCAP_USD", DEFAULT_MCAP_USD);
  const holderThresholds = opts.thresholds?.holders ?? envNumberList(env, "MILESTONE_HOLDERS", DEFAULT_HOLDERS);
  const pollMs = opts.pollMs ?? envNumber(env, "MILESTONE_POLL_MS", DEFAULT_MILESTONE_POLL_MS);

  const holders =
    opts.holderCounter ??
    (env.HELIUS_API_KEY && env.HELIUS_API_KEY.trim() !== ""
      ? heliusHolderCounter({ apiKey: env.HELIUS_API_KEY.trim(), cluster: opts.cluster, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
      : rpcHolderCounter(opts.rpc));
  const mcapOf =
    opts.mcapUsdOf ??
    (async (mint: string) => {
      const c = await getCoin(mint, api);
      return typeof c?.usd_market_cap === "number" ? c.usd_market_cap : null;
    });

  let mcapIdx = 0;
  let holdersIdx = 0;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const [mcap, holderCount] = await Promise.allSettled([mcapOf(input.coinCa), holders(input.coinCa)]);
      if (mcap.status === "fulfilled" && mcap.value !== null) {
        while (mcapIdx < mcapThresholds.length && mcap.value >= mcapThresholds[mcapIdx]!) {
          input.onMilestone({ kind: "mcap", value: mcapThresholds[mcapIdx]! });
          mcapIdx++;
        }
      } else if (mcap.status === "rejected") onError(mcap.reason instanceof Error ? mcap.reason : new Error(String(mcap.reason)));
      if (holderCount.status === "fulfilled") {
        while (holdersIdx < holderThresholds.length && holderCount.value >= holderThresholds[holdersIdx]!) {
          input.onMilestone({ kind: "holders", value: holderThresholds[holdersIdx]! });
          holdersIdx++;
        }
      } else onError(holderCount.reason instanceof Error ? holderCount.reason : new Error(String(holderCount.reason)));
    } finally {
      busy = false;
    }
  };
  await tick();
  const setI = opts.setInterval ?? globalThis.setInterval;
  const clearI = opts.clearInterval ?? globalThis.clearInterval;
  const handle = setI(() => void tick(), pollMs);
  return () => clearI(handle);
}
