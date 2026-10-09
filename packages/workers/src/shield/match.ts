/**
 * Pure matching helpers for the Shield: prompt keywords, X post → copycat evidence,
 * report assembly. No clients, no clocks.
 */

import type { BundleFlag, Copycat, ShieldReport } from "@quantagent/core/types";
import type { XPost } from "@quantagent/core/types/clients";
import { BASE58_RE } from "../shared";

const STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "into",
  "about",
  "runs",
  "running",
  "the",
  "and",
  "for",
  "coin",
  "token",
  "meme",
  "memecoin",
  "launch",
  "pump",
  "make",
  "like",
  "just",
  "your",
  "their",
  "have",
  "what",
  "when",
  "where",
  "which",
  "will",
  "would",
  "very",
  "them",
  "they",
  "than",
  "then",
]);

/** The most useful words of a prompt: ≥4 letters, no stopwords, order kept, deduped. */
export function extractKeywords(prompt: string, max = 3): string[] {
  const out: string[] = [];
  for (const raw of prompt.toLowerCase().split(/[^a-z0-9$]+/)) {
    const w = raw.replace(/^\$/, "");
    if (w.length < 4 || STOPWORDS.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** Base58 tokens of Solana-address length found in free text. */
export function addressesIn(text: string): string[] {
  const found: string[] = [];
  for (const token of text.split(/[^1-9A-HJ-NP-Za-km-z]+/)) {
    if (BASE58_RE.test(token) && !found.includes(token)) found.push(token);
  }
  return found;
}

function mentionsWord(text: string, word: string): boolean {
  const w = word.trim();
  if (!w) return false;
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

export interface PostMatchInput {
  post: XPost;
  /** Chosen identity once known. */
  name?: string | undefined;
  ticker?: string | undefined;
  /** Prompt keywords used before a name exists. */
  keywords: readonly string[];
  /** The real CA once deployed; posts carrying it are ours or honest. */
  canonicalCa: string | null;
  /** The connected account; its own posts are never copycats. */
  ownAccountId: string;
}

/**
 * A post is copycat evidence when it names our identity (ticker, name, or before a
 * name exists a prompt keyword) AND carries a contract address that is not ours.
 * Posts without an address are hype, not copycats.
 */
export function postToCopycat(input: PostMatchInput): Copycat | null {
  const { post, name, ticker, keywords, canonicalCa, ownAccountId } = input;
  if (post.authorId === ownAccountId) return null;
  const text = post.text;
  const foreign = addressesIn(text).filter((a) => a !== canonicalCa);
  if (foreign.length === 0) return null;
  if (canonicalCa && text.includes(canonicalCa)) return null;

  const tickerHit = ticker ? mentionsWord(text, `$${ticker}`) || mentionsWord(text, ticker) : false;
  const nameHit = name ? mentionsWord(text, name) : false;
  const keywordHit = !name && !ticker ? keywords.some((k) => mentionsWord(text, k)) : false;
  if (!tickerHit && !nameHit && !keywordHit) return null;

  const score = tickerHit ? 0.9 : nameHit ? 0.8 : 0.4;
  return {
    source: "x",
    externalId: post.id,
    url: post.url,
    match: tickerHit ? "ticker" : "name",
    score,
    seenAt: post.createdAt,
  };
}

/** Pump.fun matches found from prompt keywords (no name yet) are weak evidence: half score. */
export function weakenKeywordMatch(c: Copycat): Copycat {
  return { ...c, score: Math.round(c.score * 0.5 * 1000) / 1000 };
}

export function copycatKey(c: Pick<Copycat, "source" | "externalId">): string {
  return `${c.source}:${c.externalId}`;
}

export function buildReport(canonicalCa: string | null, copycats: Iterable<Copycat>, bundleFlags: readonly BundleFlag[]): ShieldReport {
  return {
    canonicalCa,
    copycats: [...copycats].sort((a, b) => b.score - a.score || a.seenAt.localeCompare(b.seenAt)),
    bundleFlags: [...bundleFlags],
  };
}
