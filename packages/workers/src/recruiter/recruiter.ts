/**
 * B8 RECRUITER
 * Finds accounts actively posting about the narrative (x.search), ranks them by
 * LLM relevance × log(reach), drafts a public reply with the LLM and sends it through
 * requireApproval({ actionClass: "recruiting" }) → x.post({ replyTo }). Hard hourly cap
 * (RECRUITER_HOURLY_CAP). Public replies only: the X client exposes nothing else and
 * this folder never asks for anything else (see recruiter.policy.test.ts).
 */

import { ApprovalDenied, type Identity, type QuantagentEvent } from "@quantagent/core/types";
import type { LlmClient, XClient, XPost } from "@quantagent/core/types/clients";
import type { PostLaunchWorker, StartResult, WorkerContext } from "../context";
import { errorText, requireClient } from "../shared";
import { extractKeywords } from "../shield/match";
import { HOUR_MS, RateWindow, hourlyCapFromEnv, llmJson, rankAccounts, type RankedAccount } from "./rank";

export interface RecruiterOptions {
  /** Max public replies per hour. Default: RECRUITER_HOURLY_CAP or 10. */
  hourlyCap?: number;
  /** Accounts reported in Recruiter.found and considered per cycle. */
  maxAccounts?: number;
  /** Minimum LLM relevance (0–1) to reach out. */
  minRelevance?: number;
  /** Posts per X search. */
  searchMax?: number;
  /** Epoch-ms clock, injectable for tests. */
  now?: () => number;
  tickEveryMs?: number;
}

const WORKER = "Recruiter" as const;
export const REPLY_MAX_CHARS = 260;

const RANK_SCHEMA = {
  type: "object",
  properties: {
    accounts: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, relevance: { type: "number", minimum: 0, maximum: 1 } },
        required: ["id", "relevance"],
      },
    },
  },
  required: ["accounts"],
} as const;

const REPLY_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
} as const;

const RANK_SYSTEM = `You score X accounts for how actively and genuinely they post about a given narrative.
Return strict JSON {"accounts":[{"id":string,"relevance":number}]}, relevance 0–1:
1 = clearly posting about this exact narrative right now, 0 = unrelated, spam or a bot.`;

const REPLY_SYSTEM = `You write one public reply on X on behalf of a memecoin's own account.
Rules: reply to what the person actually said; be specific, warm, short (under ${REPLY_MAX_CHARS} characters);
no price talk, no promises, no "DM me", no asking them to do anything except look;
mention the coin by name once; include the site link if given. Return strict JSON {"text":string}.`;

interface Candidate {
  id: string;
  handle: string;
  reach: number;
  posts: XPost[];
}

export class RecruiterWorker implements PostLaunchWorker {
  readonly name = WORKER;
  readonly tickEveryMs: number;
  readonly hourlyCap: number;
  private readonly maxAccounts: number;
  private readonly minRelevance: number;
  private readonly searchMax: number;
  private readonly now: () => number;
  private readonly window: RateWindow;
  private identity: Identity | null = null;
  private siteUrl: string | null = null;
  private readonly reached = new Set<string>();
  private cappedAnnouncedAt: number | null = null;
  private stopped = false;
  private busy = false;

  constructor(opts: RecruiterOptions = {}) {
    this.hourlyCap = opts.hourlyCap ?? hourlyCapFromEnv();
    this.maxAccounts = opts.maxAccounts ?? 20;
    this.minRelevance = opts.minRelevance ?? 0.4;
    this.searchMax = opts.searchMax ?? 30;
    this.now = opts.now ?? (() => Date.now());
    this.tickEveryMs = opts.tickEveryMs ?? 10 * 60_000;
    this.window = new RateWindow(this.hourlyCap, HOUR_MS);
  }

  async start(ctx: WorkerContext): Promise<StartResult> {
    requireClient(ctx, "x", "Recruiter.search");
    requireClient(ctx, "llm", "Recruiter.rank");
    const result = await this.cycle(ctx, "launch");
    return { ...result, hourlyCap: this.hourlyCap };
  }

  on(event: QuantagentEvent): void {
    if (event.type === "Ideator.named") this.identity = event.payload.identity;
    else if (event.type === "Builder.published") this.siteUrl = event.payload.url;
  }

  async tick(ctx: WorkerContext): Promise<void> {
    if (this.stopped || this.busy) return;
    await this.cycle(ctx, "tick");
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private queries(ctx: WorkerContext): string[] {
    const q: string[] = [];
    if (this.identity) q.push(`$${this.identity.ticker.toUpperCase()}`, this.identity.name);
    for (const k of extractKeywords(ctx.prompt)) if (!q.includes(k)) q.push(k);
    return q;
  }

  private async cycle(ctx: WorkerContext, trigger: string): Promise<{ found: number; reached: number; capped: boolean }> {
    this.busy = true;
    try {
      const x = requireClient(ctx, "x", "Recruiter.search");
      const llm = requireClient(ctx, "llm", "Recruiter.rank");
      const queries = this.queries(ctx);
      if (queries.length === 0) {
        ctx.progress("search.empty", "empty prompt and no name yet: nothing to search for", { trigger });
        return { found: 0, reached: 0, capped: false };
      }
      const candidates = await this.search(ctx, x, queries, trigger);
      if (candidates.length === 0) {
        ctx.progress("search.none", `no accounts found posting about ${queries.join(", ")}`, { trigger, queries });
        return { found: 0, reached: 0, capped: false };
      }
      const ranked = await this.rank(ctx, llm, candidates);
      const top = ranked.slice(0, this.maxAccounts);
      ctx.emit({
        type: "Recruiter.found",
        reason: `${top.length} account(s) posting about the narrative, ranked by relevance × log(reach)`,
        payload: { accounts: top.map(({ id, handle, reach, relevance }) => ({ id, handle, reach, relevance })) },
      });
      const byId = new Map(candidates.map((c) => [c.id, c]));
      let reached = 0;
      let capped = false;
      for (const a of top) {
        if (this.stopped) break;
        if (this.reached.has(a.id)) continue;
        if (a.relevance < this.minRelevance) continue;
        const now = this.now();
        if (!this.window.allows(now)) {
          capped = true;
          this.announceCap(ctx, now);
          break;
        }
        const c = byId.get(a.id);
        const target = c?.posts[0];
        if (!target) continue;
        if (await this.reach(ctx, x, llm, a, target)) reached++;
      }
      return { found: top.length, reached, capped };
    } finally {
      this.busy = false;
    }
  }

  private async search(ctx: WorkerContext, x: XClient, queries: string[], trigger: string): Promise<Candidate[]> {
    ctx.progress("search", `searching X for ${queries.map((q) => `"${q}"`).join(", ")} (${trigger})`, { queries, trigger });
    const byAuthor = new Map<string, XPost[]>();
    for (const query of queries) {
      try {
        const posts = await x.search({ query, max: this.searchMax });
        for (const p of posts) {
          if (p.authorId === x.accountId) continue;
          const list = byAuthor.get(p.authorId) ?? [];
          if (!list.some((q) => q.id === p.id)) list.push(p);
          byAuthor.set(p.authorId, list);
        }
      } catch (err) {
        ctx.progress("search.failed", `X search for "${query}" failed: ${errorText(err)}`, { query });
      }
    }
    if (byAuthor.size === 0) return [];
    const ids = [...byAuthor.keys()];
    let users: { id: string; handle: string; reach: number }[] = [];
    try {
      users = (await x.users({ ids })).map((u) => ({ id: u.id, handle: u.handle, reach: u.followers }));
    } catch (err) {
      ctx.progress("users.failed", `could not read reach for ${ids.length} accounts: ${errorText(err)}; treating reach as 0`, { ids });
    }
    const userById = new Map(users.map((u) => [u.id, u]));
    const candidates: Candidate[] = ids.map((id) => {
      const u = userById.get(id);
      const posts = (byAuthor.get(id) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { id, handle: u?.handle ?? id, reach: u?.reach ?? 0, posts };
    });
    ctx.progress("search.done", `${candidates.length} account(s) found across ${queries.length} queries`, { accounts: candidates.length });
    return candidates;
  }

  private async rank(ctx: WorkerContext, llm: LlmClient, candidates: Candidate[]): Promise<RankedAccount[]> {
    ctx.progress("rank", `asking the LLM to score ${candidates.length} account(s) for relevance, then weighting by log(reach)`);
    const narrative = this.identity
      ? `${this.identity.name} ($${this.identity.ticker}): ${this.identity.hook}. ${this.identity.lore}`
      : `the prompt "${ctx.prompt}"`;
    const listing = candidates
      .map((c) => `- id=${c.id} @${c.handle} reach=${c.reach}\n${c.posts.slice(0, 3).map((p) => `  · ${p.text.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")}`)
      .join("\n");
    const res = await llm.complete({
      system: RANK_SYSTEM,
      user: `Narrative: ${narrative}\n\nAccounts and their recent posts:\n${listing}`,
      schema: RANK_SCHEMA,
      maxTokens: 2000,
    });
    const parsed = llmJson(res) as { accounts?: { id?: unknown; relevance?: unknown }[] };
    const relevance = new Map<string, number>();
    for (const a of parsed.accounts ?? []) {
      if (typeof a.id === "string" && typeof a.relevance === "number") relevance.set(a.id, Math.min(1, Math.max(0, a.relevance)));
    }
    return rankAccounts(candidates.map((c) => ({ id: c.id, handle: c.handle, reach: c.reach, relevance: relevance.get(c.id) ?? 0 })));
  }

  private async reach(ctx: WorkerContext, x: XClient, llm: LlmClient, a: RankedAccount, target: XPost): Promise<boolean> {
    const coin = this.identity ? `${this.identity.name} ($${this.identity.ticker})` : `the coin from the prompt "${ctx.prompt}"`;
    let text: string;
    try {
      const res = await llm.complete({
        system: REPLY_SYSTEM,
        user: `Coin: ${coin}\nSite: ${this.siteUrl ?? "(not published yet)"}\n@${a.handle} posted: "${target.text}"`,
        schema: REPLY_SCHEMA,
        maxTokens: 300,
      });
      const parsed = llmJson(res) as { text?: unknown };
      if (typeof parsed.text !== "string" || !parsed.text.trim()) throw new Error("LLM returned no reply text");
      text = parsed.text.trim().slice(0, REPLY_MAX_CHARS);
    } catch (err) {
      ctx.progress("draft.failed", `could not draft a reply to @${a.handle}: ${errorText(err)}`, { accountId: a.id });
      return false;
    }

    const reason = `@${a.handle} (reach ${a.reach}, relevance ${a.relevance.toFixed(2)}, score ${a.score.toFixed(2)}) is posting about the narrative`;
    let approvedText = text;
    try {
      const outcome = await ctx.requireApproval({
        actionClass: "recruiting",
        title: `Reply to @${a.handle}`,
        draft: { text, replyTo: target.id, accountId: a.id, handle: a.handle, targetText: target.text, targetUrl: target.url },
        reason,
      });
      const edited = outcome.draft.text;
      if (typeof edited === "string" && edited.trim()) approvedText = edited.trim().slice(0, REPLY_MAX_CHARS);
    } catch (err) {
      if (err instanceof ApprovalDenied) {
        ctx.progress("reach.skipped", `user skipped the reply to @${a.handle}`, { accountId: a.id });
        return false;
      }
      throw err;
    }

    const now = this.now();
    if (!this.window.allows(now)) {
      this.announceCap(ctx, now);
      return false;
    }
    try {
      const post = await x.post({ text: approvedText, replyTo: target.id });
      this.window.record(now);
      this.reached.add(a.id);
      ctx.emit({
        type: "Recruiter.reached",
        reason: `${reason}; replied publicly (${post.id})`,
        payload: { accountId: a.id, postId: post.id, text: approvedText },
      });
      return true;
    } catch (err) {
      ctx.progress("reach.failed", `reply to @${a.handle} failed: ${errorText(err)}`, { accountId: a.id, replyTo: target.id });
      return false;
    }
  }

  private announceCap(ctx: WorkerContext, now: number): void {
    // Once per window so the log is not spammed every tick.
    if (this.cappedAnnouncedAt !== null && now - this.cappedAnnouncedAt < HOUR_MS) return;
    this.cappedAnnouncedAt = now;
    ctx.emit({
      type: "Recruiter.capped",
      reason: `hourly outreach cap of ${this.hourlyCap} reached; no more replies until the window clears`,
      payload: { cap: this.hourlyCap, windowMs: HOUR_MS },
    });
  }
}
