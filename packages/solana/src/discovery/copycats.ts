/**
 * Name / ticker / logo copycat discovery over pump.fun for the Shield.
 */

import type { Copycat } from "@quantagent/core/types";
import { envNumber, envOf, fetchOf, type Env, type FetchLike } from "../env";
import { hammingHex, phashImage, similarityFromHamming, PHASH_BITS } from "./phash";
import { coinUrl, pumpFunApiConfigFromEnv, recentCoins, searchCoins, type PumpCoin, type PumpFunApiConfig } from "./pumpfunApi";

export function normalizeName(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeTicker(s: string): string {
  return s.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** Sørensen–Dice over character bigrams, 0–1. */
export function diceSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(x);
  const gb = grams(y);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (x.length - 1 + (y.length - 1));
}

export interface DiscoveryOptions {
  env?: Env;
  fetch?: FetchLike;
  api?: PumpFunApiConfig;
  /** Minimum name similarity to report as a copycat (default 0.8). */
  nameThreshold?: number;
  /** How many recent coins to hash for logo search (default 200, env COPYCAT_RECENT_COINS). */
  recentLimit?: number;
  /** Image-fetch concurrency (default 8). */
  concurrency?: number;
  /** Override image bytes fetch (tests). */
  fetchImage?: (url: string) => Promise<Uint8Array | null>;
  /** Override hashing (tests); default sharp/jimp pHash. */
  hashImage?: (bytes: Uint8Array) => Promise<string>;
}

export class CopycatFinder {
  private readonly api: PumpFunApiConfig;
  private readonly nameThreshold: number;
  private readonly recentLimit: number;
  private readonly concurrency: number;
  private readonly fetch: FetchLike;
  private readonly hashCache = new Map<string, string>();

  constructor(private readonly opts: DiscoveryOptions = {}) {
    const env = envOf(opts.env);
    this.fetch = fetchOf(opts.fetch);
    this.api = opts.api ?? pumpFunApiConfigFromEnv(env, this.fetch);
    this.nameThreshold = opts.nameThreshold ?? 0.8;
    this.recentLimit = opts.recentLimit ?? envNumber(env, "COPYCAT_RECENT_COINS", 200);
    this.concurrency = opts.concurrency ?? 8;
  }

  private async candidatesFor(name: string, ticker: string): Promise<PumpCoin[]> {
    const seen = new Map<string, PumpCoin>();
    const terms = Array.from(new Set([name.trim(), ticker.trim()].filter((t) => t.length > 0)));
    const results = await Promise.allSettled(terms.map((t) => searchCoins({ searchTerm: t, limit: 100 }, this.api)));
    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") r.value.forEach((c) => seen.set(c.mint, c));
      else failures.push(`${terms[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    });
    if (failures.length === results.length && results.length > 0) {
      throw new Error(`pump.fun search failed: ${failures.join("; ")}`);
    }
    return [...seen.values()];
  }

  async isNameTaken(input: { name: string; ticker: string }): Promise<{ name: boolean; ticker: boolean }> {
    const coins = await this.candidatesFor(input.name, input.ticker);
    const n = normalizeName(input.name);
    const t = normalizeTicker(input.ticker);
    return {
      name: n.length > 0 && coins.some((c) => normalizeName(c.name ?? "") === n),
      ticker: t.length > 0 && coins.some((c) => normalizeTicker(c.symbol ?? "") === t),
    };
  }

  async findNameMatches(input: { name: string; ticker: string }): Promise<Copycat[]> {
    const coins = await this.candidatesFor(input.name, input.ticker);
    const t = normalizeTicker(input.ticker);
    const out: Copycat[] = [];
    for (const c of coins) {
      const seenAt = c.created_timestamp ? new Date(c.created_timestamp).toISOString() : new Date().toISOString();
      const nameScore = diceSimilarity(input.name, c.name ?? "");
      if (nameScore >= this.nameThreshold) {
        out.push({ source: "pump.fun", externalId: c.mint, url: coinUrl(c.mint), match: "name", score: nameScore, seenAt });
      }
      if (t.length > 0 && normalizeTicker(c.symbol ?? "") === t) {
        out.push({ source: "pump.fun", externalId: c.mint, url: coinUrl(c.mint), match: "ticker", score: 1, seenAt });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }

  private async imageBytes(url: string): Promise<Uint8Array | null> {
    if (this.opts.fetchImage) return this.opts.fetchImage(url);
    try {
      const res = await this.fetch(url, { headers: { accept: "image/*" } });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  private async hashOf(coin: PumpCoin): Promise<string | null> {
    const cached = this.hashCache.get(coin.mint);
    if (cached) return cached;
    if (!coin.image_uri) return null;
    const bytes = await this.imageBytes(coin.image_uri);
    if (!bytes || bytes.length === 0) return null;
    try {
      const h = this.opts.hashImage ? await this.opts.hashImage(bytes) : await phashImage(bytes);
      this.hashCache.set(coin.mint, h);
      return h;
    } catch {
      return null;
    }
  }

  /**
   * `threshold` is the maximum hamming distance (0–64) when > 1, or a minimum
   * similarity (0–1) otherwise. Score reported is 1 − distance/64.
   */
  async findLogoMatches(input: { phash: string; threshold: number }): Promise<Copycat[]> {
    const maxDistance = input.threshold > 1 ? Math.floor(input.threshold) : Math.round((1 - input.threshold) * PHASH_BITS);
    const coins = await recentCoins({ limit: this.recentLimit }, this.api);
    const out: Copycat[] = [];
    let i = 0;
    const worker = async () => {
      while (i < coins.length) {
        const coin = coins[i++]!;
        const h = await this.hashOf(coin);
        if (!h) continue;
        let d: number;
        try {
          d = hammingHex(input.phash, h);
        } catch {
          continue;
        }
        if (d <= maxDistance) {
          out.push({
            source: "pump.fun",
            externalId: coin.mint,
            url: coinUrl(coin.mint),
            match: "logo",
            score: similarityFromHamming(d),
            seenAt: coin.created_timestamp ? new Date(coin.created_timestamp).toISOString() : new Date().toISOString(),
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(1, coins.length)) }, worker));
    return out.sort((a, b) => b.score - a.score);
  }
}
