/**
 * Pure ranking and rate-cap helpers for the Recruiter.
 */

export interface RankedAccount {
  id: string;
  handle: string;
  reach: number;
  /** 0–1 from the LLM. */
  relevance: number;
  score: number;
}

/** relevance (0–1) × ln(1 + reach). Reach 0 scores 0 no matter how relevant. */
export function recruitScore(relevance: number, reach: number): number {
  const r = Math.min(1, Math.max(0, Number.isFinite(relevance) ? relevance : 0));
  return r * Math.log1p(Math.max(0, Number.isFinite(reach) ? reach : 0));
}

export function rankAccounts(accounts: Omit<RankedAccount, "score">[]): RankedAccount[] {
  return accounts
    .map((a) => ({ ...a, score: recruitScore(a.relevance, a.reach) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export const HOUR_MS = 60 * 60_000;
export const DEFAULT_HOURLY_CAP = 10;

/** RECRUITER_HOURLY_CAP, default 10; invalid values keep the default, 0 disables outreach. */
export function hourlyCapFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RECRUITER_HOURLY_CAP;
  if (raw === undefined || raw.trim() === "") return DEFAULT_HOURLY_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_HOURLY_CAP;
}

/** Sliding-window counter: at most `cap` events per `windowMs`. */
export class RateWindow {
  private stamps: number[] = [];

  constructor(
    readonly cap: number,
    readonly windowMs: number = HOUR_MS,
  ) {}

  private prune(now: number): void {
    this.stamps = this.stamps.filter((t) => t > now - this.windowMs);
  }

  count(now: number): number {
    this.prune(now);
    return this.stamps.length;
  }

  allows(now: number): boolean {
    return this.count(now) < this.cap;
  }

  record(now: number): void {
    this.prune(now);
    this.stamps.push(now);
  }
}

/** Parses an LLM completion as JSON: prefers `json`, else the text with code fences stripped. */
export function llmJson(res: { text: string; json?: unknown }): unknown {
  if (res.json !== undefined && res.json !== null) return res.json;
  const text = res.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`LLM did not return JSON: ${text.slice(0, 120)}`);
  }
}
