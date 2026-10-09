/**
 * pump.fun frontend API (https://frontend-api-v3.pump.fun).
 *
 * Verified live on 2026-10-09:
 *   GET /coins?offset=0&limit=N&sort=created_timestamp&order=DESC&includeNsfw=false
 *     → JSON array of coins with mint, name, symbol, image_uri, metadata_uri,
 *       description, creator, created_timestamp, usd_market_cap, market_cap,
 *       complete, twitter, website, bonding_curve, ...
 * From third-party references (not verified live, treated as best effort):
 *   GET /coins/search?searchTerm=&limit=&offset=&sort=&order=&includeNsfw=
 *     → either an array or { data: [...], total } ; both handled.
 *   GET /coins/{mint} → single coin object.
 * Some references say a JWT Bearer is required; the unauthenticated /coins call
 * worked, and PUMPFUN_API_JWT is attached when present.
 */

import { envOf, fetchOf, type Env, type FetchLike } from "../env";

export const PUMPFUN_FRONTEND_URL = "https://frontend-api-v3.pump.fun";

export interface PumpCoin {
  mint: string;
  name: string;
  symbol: string;
  description?: string;
  image_uri?: string | null;
  metadata_uri?: string | null;
  creator?: string;
  created_timestamp?: number;
  usd_market_cap?: number;
  market_cap?: number;
  complete?: boolean;
  twitter?: string | null;
  website?: string | null;
  bonding_curve?: string;
}

export interface PumpFunApiConfig {
  baseUrl: string;
  fetch: FetchLike;
  jwt?: string;
}

export function pumpFunApiConfigFromEnv(env?: Env, fetch?: FetchLike): PumpFunApiConfig {
  const e = envOf(env);
  const cfg: PumpFunApiConfig = { baseUrl: (e.PUMPFUN_API_URL?.trim() || PUMPFUN_FRONTEND_URL).replace(/\/$/, ""), fetch: fetchOf(fetch) };
  if (e.PUMPFUN_API_JWT && e.PUMPFUN_API_JWT.trim() !== "") cfg.jwt = e.PUMPFUN_API_JWT.trim();
  return cfg;
}

async function getJson(path: string, cfg: PumpFunApiConfig): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "quantagent/0.1 (+https://quantagent.fun)" };
  if (cfg.jwt) headers.authorization = `Bearer ${cfg.jwt}`;
  const res = await cfg.fetch(`${cfg.baseUrl}${path}`, { headers });
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pump.fun api ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`pump.fun api ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function asCoinList(json: unknown): PumpCoin[] {
  const arr = Array.isArray(json) ? json : (json as { data?: unknown; coins?: unknown })?.data ?? (json as { coins?: unknown })?.coins;
  if (!Array.isArray(arr)) return [];
  return arr.filter((c): c is PumpCoin => !!c && typeof c === "object" && typeof (c as PumpCoin).mint === "string");
}

export async function recentCoins(input: { limit: number; offset?: number }, cfg: PumpFunApiConfig): Promise<PumpCoin[]> {
  const limit = Math.max(1, Math.min(input.limit, 500));
  const q = new URLSearchParams({
    offset: String(input.offset ?? 0),
    limit: String(limit),
    sort: "created_timestamp",
    order: "DESC",
    includeNsfw: "false",
  });
  return asCoinList(await getJson(`/coins?${q.toString()}`, cfg));
}

export async function searchCoins(input: { searchTerm: string; limit?: number }, cfg: PumpFunApiConfig): Promise<PumpCoin[]> {
  const q = new URLSearchParams({
    offset: "0",
    limit: String(Math.max(1, Math.min(input.limit ?? 50, 200))),
    sort: "market_cap",
    order: "DESC",
    includeNsfw: "false",
    searchTerm: input.searchTerm,
  });
  return asCoinList(await getJson(`/coins/search?${q.toString()}`, cfg));
}

export async function getCoin(mint: string, cfg: PumpFunApiConfig): Promise<PumpCoin | null> {
  const json = await getJson(`/coins/${encodeURIComponent(mint)}`, cfg);
  if (!json || typeof json !== "object" || typeof (json as PumpCoin).mint !== "string") return null;
  return json as PumpCoin;
}

export function coinUrl(mint: string): string {
  return `https://pump.fun/coin/${mint}`;
}
