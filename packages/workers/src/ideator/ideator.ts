/**
 * B1 IDEATOR
 * Input: prompt (possibly empty) + live X trends. Output: 5 candidate identities,
 * emitted as Worker.candidates (via ctx.collapse) for the orchestrator to collapse
 * with a quantum draw. When Orchestrator.collapsed / Orchestrator.userPicked arrives
 * for the Ideator the worker emits Ideator.named and finishes.
 * Post-launch: on Voice.needsAngle emits Ideator.angles (3 angles from mentions + chart).
 *
 * Constraints enforced in code (constraints.ts): ticker ≤ 6 chars, real-person
 * deny-list (plus an LLM check), protected-brand deny-list, pump.fun availability
 * via ctx.clients.solana.isNameTaken. The LLM is injected (ctx.clients.llm).
 */

import type { Candidate, Identity, QuantagentEvent } from "@quantagent/core/types";
import type { LlmClient } from "@quantagent/core/types/clients";
import type { StartResult, Worker, WorkerContext } from "../context";
import { errorText, mapConcurrent, requireClient, truncate } from "../shared";
import { checkIdentityConstraints } from "./constraints";
import {
  ANGLES_JSON_SCHEMA,
  AnglesSchema,
  CANDIDATES_JSON_SCHEMA,
  CandidatesSchema,
  PERSON_CHECK_JSON_SCHEMA,
  PersonCheckSchema,
  parseLlmJson,
} from "./schema";

export interface IdeatorOptions {
  /** How many candidates to hand the orchestrator. Spec: 5. */
  candidateCount?: number;
  /** LLM regeneration rounds when candidates fail constraints or availability. */
  maxRounds?: number;
  /** Trends to include in the brief. */
  maxTrends?: number;
}

const WORKER = "Ideator" as const;

const SYSTEM_PROMPT = `You name memecoins for pump.fun launches.
Return strict JSON only. Each candidate has:
- name: 1–32 chars, original, memorable, never a real person, never a protected brand/character/franchise.
- ticker: 1–6 chars, A–Z/0–9 only, no leading "$".
- lore: 2–4 sentences of origin story, present tense, no financial promises.
- hook: one line under 200 chars that would stop a scroll.
- trend: the live trend (from the list given) this identity rides, or "none".
Never reuse a name or ticker from the exclusion list. Never produce slurs, sexual or violent content.`;

export interface IdeatorOutputs extends Record<string, unknown> {
  identity: Identity;
  candidates: Identity[];
  selection: "quantum draw" | "user pick";
}

export class IdeatorWorker implements Worker {
  readonly name = WORKER;
  private candidates: Candidate<Identity>[] = [];
  private named: Identity | undefined;
  private stopped = false;
  private milestones: { kind: "mcap" | "holders"; value: number }[] = [];
  private readonly opts: Required<IdeatorOptions>;

  constructor(opts: IdeatorOptions = {}) {
    this.opts = {
      candidateCount: opts.candidateCount ?? 5,
      maxRounds: opts.maxRounds ?? 3,
      maxTrends: opts.maxTrends ?? 15,
    };
  }

  async start(ctx: WorkerContext): Promise<StartResult> {
    ctx.progress(
      "brief",
      ctx.prompt.trim() ? `ideating from prompt "${truncate(ctx.prompt, 60)}"` : "ideating from an empty prompt and live trends",
    );
    const llm = requireClient(ctx, "llm", "Ideator.ideate");
    const x = requireClient(ctx, "x", "Ideator.trends");
    const solana = requireClient(ctx, "solana", "Ideator.availability");

    ctx.progress("trends", "pulling live X trends to ground the candidates");
    const trends = (await x.trends()).slice(0, this.opts.maxTrends);
    ctx.progress("trends.done", `got ${trends.length} live trends`, { trends: trends.map((t) => t.name) });

    const accepted: Candidate<Identity>[] = [];
    const excluded: string[] = [];
    const rejections: string[] = [];

    for (let round = 1; round <= this.opts.maxRounds && accepted.length < this.opts.candidateCount; round++) {
      if (this.stopped || ctx.signal.aborted) return;
      const want = this.opts.candidateCount - accepted.length;
      ctx.progress("ideate", `round ${round}: asking the LLM for ${want} candidate identities`, { round, want, excluded });
      const proposals = await this.propose(ctx, llm, trends, want, excluded, rejections);
      ctx.progress("ideate.done", `LLM proposed ${proposals.length} candidates`, {
        names: proposals.map((p) => `${p.name} ($${p.ticker})`),
      });

      // 1. In-code constraints: ticker length/charset, real-person + brand deny-lists.
      ctx.progress("constraints", "checking ticker length, real-person and brand deny-lists in code");
      const passing: Identity[] = [];
      for (const p of proposals) {
        const v = checkIdentityConstraints(p);
        excluded.push(p.name, p.ticker);
        if (v.length) {
          rejections.push(`${p.name}: ${v.join("; ")}`);
          ctx.progress("constraints.rejected", `rejected ${p.name}: ${v.join("; ")}`, { name: p.name, violations: v });
        } else passing.push(p);
      }

      // 2. LLM real-person check (additive to the deny-list, never a substitute).
      const afterLlm = await this.llmPersonCheck(ctx, llm, passing, rejections);

      // 3. Availability on pump.fun via the Solana client.
      ctx.progress("availability", `checking ${afterLlm.length} names on pump.fun`);
      const checks = await mapConcurrent(afterLlm, 4, (id) => solana.isNameTaken({ name: id.name, ticker: id.ticker }));
      afterLlm.forEach((id, i) => {
        const r = checks[i];
        if (!r) return;
        if (r.status === "rejected") {
          rejections.push(`${id.name}: availability check failed (${errorText(r.reason)})`);
          ctx.progress("availability.failed", `availability check failed for ${id.name}: ${errorText(r.reason)}`, { name: id.name });
          return;
        }
        if (r.value.name || r.value.ticker) {
          const what = r.value.name ? "name" : "ticker";
          rejections.push(`${id.name}: ${what} already live on pump.fun`);
          ctx.progress("availability.rejected", `rejected ${id.name}: ${what} already live on pump.fun`, { candidate: id.name, nameTaken: r.value.name, tickerTaken: r.value.ticker });
          return;
        }
        if (accepted.length < this.opts.candidateCount && !accepted.some((a) => a.value.ticker === id.ticker)) {
          accepted.push({
            id: `ideator-${accepted.length + 1}-${id.ticker.toLowerCase()}`,
            value: id,
            label: `$${id.ticker} · ${id.name}`,
            reason: id.trend && id.trend !== "none" ? `rides live trend "${id.trend}"` : "fits the prompt; no trend tie-in",
          });
        }
      });
      ctx.progress("round.done", `${accepted.length}/${this.opts.candidateCount} candidates pass every check after round ${round}`);
    }

    if (accepted.length === 0) {
      throw new Error(
        `no candidate passed constraints and availability after ${this.opts.maxRounds} rounds: ${rejections.slice(-5).join(" | ")}`,
      );
    }
    this.candidates = accepted;

    // Emits Worker.candidates and resolves on Orchestrator.collapsed (quantum draw) or
    // Orchestrator.userPicked (QRNG unreachable, user tapped one).
    const { chosen, proof } = await ctx.collapse(accepted, `${accepted.length} identities ready for the quantum draw`);
    const identity = chosen.value;
    const selection = proof ? "quantum draw" : "user pick";
    this.named = identity;
    ctx.emit({
      type: "Ideator.named",
      reason: `${selection} collapsed ${accepted.length} candidates to ${identity.name} ($${identity.ticker})`,
      payload: { identity },
    });
    const outputs: IdeatorOutputs = { identity, candidates: accepted.map((c) => c.value), selection };
    return outputs;
  }

  async on(event: QuantagentEvent, ctx: WorkerContext): Promise<void> {
    if (this.stopped) return;
    switch (event.type) {
      case "Chain.milestone":
        this.milestones.push(event.payload);
        return;
      case "Voice.needsAngle":
        await this.angles(ctx, event.payload);
        return;
      default:
        return;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  /* ───────────── internals ───────────── */

  private async propose(
    ctx: WorkerContext,
    llm: LlmClient,
    trends: { name: string; volume?: number }[],
    want: number,
    excluded: string[],
    rejections: string[],
  ): Promise<Identity[]> {
    const trendLines = trends.length
      ? trends.map((t) => `- ${t.name}${t.volume ? ` (${t.volume} posts)` : ""}`).join("\n")
      : "- (no trends available)";
    const user = [
      `Prompt from the user: ${ctx.prompt.trim() ? JSON.stringify(ctx.prompt) : "(empty — invent from the trends)"}`,
      `Live X trends right now:\n${trendLines}`,
      excluded.length ? `Exclude these names/tickers: ${[...new Set(excluded)].join(", ")}` : "",
      rejections.length ? `Earlier rejections (avoid the same mistakes):\n${rejections.slice(-8).map((r) => `- ${r}`).join("\n")}` : "",
      `Return JSON: {"candidates":[...]} with exactly ${want} candidates.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const res = await llm.complete({ system: SYSTEM_PROMPT, user, schema: CANDIDATES_JSON_SCHEMA, maxTokens: 1500 });
    const parsed = CandidatesSchema.safeParse(parseLlmJson(res));
    if (!parsed.success) {
      throw new Error(
        `LLM candidates failed validation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    return parsed.data.candidates;
  }

  private async llmPersonCheck(ctx: WorkerContext, llm: LlmClient, ids: Identity[], rejections: string[]): Promise<Identity[]> {
    if (ids.length === 0) return ids;
    ctx.progress("personCheck", `asking the LLM whether any of ${ids.length} names refers to a real person`);
    const res = await llm.complete({
      system: "You are a strict compliance checker. Answer in JSON only.",
      user: `For each name, say whether it refers to a real living or historical person (including nicknames and obvious misspellings). Names:\n${ids
        .map((i) => `- ${i.name} ($${i.ticker})`)
        .join("\n")}\n\nReturn {"verdicts":[{"name":..., "isRealPerson":bool, "who":...}]}`,
      schema: PERSON_CHECK_JSON_SCHEMA,
      maxTokens: 600,
    });
    const parsed = PersonCheckSchema.safeParse(parseLlmJson(res));
    if (!parsed.success) {
      // A malformed check is a hard failure: we do not pass names we could not verify.
      throw new Error(`LLM real-person check returned invalid JSON: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    const flagged = new Map(
      parsed.data.verdicts.filter((v) => v.isRealPerson).map((v) => [v.name.toLowerCase(), v.who ?? "a real person"]),
    );
    return ids.filter((id) => {
      const who = flagged.get(id.name.toLowerCase());
      if (who) {
        rejections.push(`${id.name}: LLM says it refers to ${who}`);
        ctx.progress("personCheck.rejected", `rejected ${id.name}: LLM flagged it as a real person (${who})`, { name: id.name, who });
        return false;
      }
      return true;
    });
  }

  private async angles(ctx: WorkerContext, signal: { mentions: number; engagement: number }): Promise<void> {
    const llm = requireClient(ctx, "llm", "Ideator.angles");
    const x = requireClient(ctx, "x", "Ideator.angles.mentions");
    ctx.progress("angles", `Voice asked for angles (engagement ${signal.engagement}); reading mentions and chart`);
    const mentions = await x.mentions({});
    const identity = this.named;
    const chart = this.milestones.length ? this.milestones.slice(-5).map((m) => `${m.kind}=${m.value}`).join(", ") : "no milestones yet";
    const res = await llm.complete({
      system: "You write fresh content angles for a memecoin's X account. JSON only.",
      user: [
        identity ? `Coin: ${identity.name} ($${identity.ticker}). Lore: ${identity.lore}` : `Coin from prompt: ${ctx.prompt}`,
        `Engagement signal: ${signal.engagement}, mentions: ${signal.mentions}.`,
        `Chart: ${chart}.`,
        `Recent mentions:\n${mentions.slice(0, 20).map((m) => `- @${m.authorId}: ${truncate(m.text, 140)}`).join("\n") || "- none"}`,
        `Return {"angles":[three one-line angles]} — concrete, reply-worthy, no financial promises.`,
      ].join("\n\n"),
      schema: ANGLES_JSON_SCHEMA,
      maxTokens: 400,
    });
    const parsed = AnglesSchema.safeParse(parseLlmJson(res));
    if (!parsed.success) throw new Error(`LLM angles failed validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    ctx.emit({
      type: "Ideator.angles",
      reason: `3 new angles from ${mentions.length} mentions and chart (${chart})`,
      payload: { angles: parsed.data.angles },
    });
  }
}

export function createIdeator(opts?: IdeatorOptions): IdeatorWorker {
  return new IdeatorWorker(opts);
}
