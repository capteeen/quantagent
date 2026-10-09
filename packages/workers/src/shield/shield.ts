/**
 * B7 SHIELD
 * From t=0 scans pump.fun (solana.findNameMatches) and X (x.search) for the prompt's
 * keywords; after Ideator.named rescans with the real name/ticker; after
 * Artist.logoReady scans by perceptual hash (solana.findLogoMatches). On
 * Launcher.deployed registers the canonical CA synchronously and watches the coin for
 * bundled launches / dev-wallet anomalies. Every match is filed as Shield.copycatFound
 * plus a fresh Shield.report; the Voice and Builder react to those events.
 */

import type { BundleFlag, Copycat, EventOf, Identity, QuantagentEvent, ShieldReport } from "@quantagent/core/types";
import type { SolanaClient, XClient } from "@quantagent/core/types/clients";
import type { PostLaunchWorker, StartResult, WorkerContext } from "../context";
import { errorText, requireClient } from "../shared";
import { waitForDeployed } from "../trader/launchGate";
import { buildReport, copycatKey, extractKeywords, postToCopycat, weakenKeywordMatch } from "./match";

export interface ShieldOptions {
  /** Perceptual-hash similarity threshold for solana.findLogoMatches (0–1). */
  logoThreshold?: number;
  /** Posts per X search. */
  searchMax?: number;
  tickEveryMs?: number;
}

const WORKER = "Shield" as const;

export class ShieldWorker implements PostLaunchWorker {
  readonly name = WORKER;
  readonly tickEveryMs: number;
  private readonly logoThreshold: number;
  private readonly searchMax: number;
  private identity: Identity | null = null;
  private logoPhash: string | null = null;
  private canonicalCa: string | null = null;
  private deployed: EventOf<"Launcher.deployed">["payload"] | null = null;
  private readonly copycats = new Map<string, Copycat>();
  private readonly bundleFlags: BundleFlag[] = [];
  private unwatch: (() => void) | null = null;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(opts: ShieldOptions = {}) {
    this.logoThreshold = opts.logoThreshold ?? 0.9;
    this.searchMax = opts.searchMax ?? 25;
    this.tickEveryMs = opts.tickEveryMs ?? 5 * 60_000;
  }

  report(): ShieldReport {
    return buildReport(this.canonicalCa, this.copycats.values(), this.bundleFlags);
  }

  async start(ctx: WorkerContext): Promise<StartResult> {
    const solana = requireClient(ctx, "solana", "Shield.scan.pumpfun");
    const x = requireClient(ctx, "x", "Shield.scan.x");

    const keywords = extractKeywords(ctx.prompt);
    ctx.progress("scan.prompt", keywords.length ? `scanning pump.fun and X for the prompt keywords ${keywords.join(", ")} before a name exists` : "empty prompt: no keywords to scan before the Ideator names the coin", { keywords });
    for (const kw of keywords) {
      await this.scanPumpFun(ctx, solana, { name: kw, ticker: kw.slice(0, 6).toUpperCase() }, true);
      await this.scanX(ctx, x, kw, keywords);
    }
    ctx.progress("scan.prompt.done", `${this.copycats.size} suspicious item(s) after the prompt scan; waiting for the name, the logo and the deploy`, { found: this.copycats.size });

    await waitForDeployed(ctx, () => this.deployed);
    await this.chain;
    const report = this.report();
    return { report, canonicalCa: report.canonicalCa, copycats: report.copycats.length, bundleFlags: report.bundleFlags.length };
  }

  on(event: QuantagentEvent, ctx: WorkerContext): Promise<void> | void {
    switch (event.type) {
      case "Ideator.named": {
        this.identity = event.payload.identity;
        return this.enqueue(() => this.rescanIdentity(ctx, "Ideator.named"));
      }
      case "Artist.logoReady": {
        const phash = event.payload.asset.phash;
        if (!phash) {
          ctx.progress("logo.nophash", "logo arrived without a perceptual hash; logo-match scan skipped until one is available", { url: event.payload.asset.url });
          return;
        }
        this.logoPhash = phash;
        return this.enqueue(() => this.rescanLogo(ctx, "Artist.logoReady"));
      }
      case "Launcher.deployed": {
        // Synchronous: the canonical CA is registered on the same tick the deploy is announced.
        if (this.canonicalCa) return;
        this.canonicalCa = event.payload.coinCa;
        this.deployed = event.payload;
        ctx.emit({
          type: "Shield.canonicalRegistered",
          reason: `the only real ${this.tag()} contract address is ${event.payload.coinCa} (deploy tx ${event.payload.txSignature})`,
          payload: { coinCa: event.payload.coinCa },
        });
        this.emitReport(ctx, "canonical CA registered");
        return this.enqueue(() => this.watch(ctx, event.payload.coinCa));
      }
      default:
        return;
    }
  }

  async tick(ctx: WorkerContext): Promise<void> {
    if (this.stopped) return;
    await this.enqueue(async () => {
      await this.rescanIdentity(ctx, "tick");
      await this.rescanLogo(ctx, "tick");
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const unwatch = this.unwatch;
    this.unwatch = null;
    unwatch?.();
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private tag(): string {
    return this.identity ? `$${this.identity.ticker.toUpperCase()}` : "the coin";
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const next = this.chain.then(job);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async rescanIdentity(ctx: WorkerContext, trigger: string): Promise<void> {
    if (!this.identity || this.stopped) return;
    const solana = requireClient(ctx, "solana", "Shield.scan.pumpfun");
    const x = requireClient(ctx, "x", "Shield.scan.x");
    const { name, ticker } = this.identity;
    ctx.progress("scan.identity", `scanning pump.fun and X for "${name}" / $${ticker} (${trigger})`, { name, ticker, trigger });
    await this.scanPumpFun(ctx, solana, { name, ticker }, false);
    await this.scanX(ctx, x, `$${ticker}`, []);
    await this.scanX(ctx, x, name, []);
  }

  private async rescanLogo(ctx: WorkerContext, trigger: string): Promise<void> {
    if (!this.logoPhash || this.stopped) return;
    const solana = requireClient(ctx, "solana", "Shield.scan.logo");
    ctx.progress("scan.logo", `scanning pump.fun for logos within ${this.logoThreshold} of ours (${trigger})`, { phash: this.logoPhash, threshold: this.logoThreshold });
    try {
      const matches = await solana.findLogoMatches({ phash: this.logoPhash, threshold: this.logoThreshold });
      for (const m of matches) this.file(ctx, { ...m, match: "logo" });
    } catch (err) {
      ctx.progress("scan.failed", `logo scan failed: ${errorText(err)}`, { scan: "logo" });
    }
  }

  private async scanPumpFun(ctx: WorkerContext, solana: SolanaClient, q: { name: string; ticker: string }, weak: boolean): Promise<void> {
    try {
      const matches = await solana.findNameMatches(q);
      for (const m of matches) this.file(ctx, weak ? weakenKeywordMatch(m) : m);
    } catch (err) {
      ctx.progress("scan.failed", `pump.fun scan for "${q.name}" failed: ${errorText(err)}`, { scan: "pumpfun", query: q });
    }
  }

  private async scanX(ctx: WorkerContext, x: XClient, query: string, keywords: readonly string[]): Promise<void> {
    try {
      const posts = await x.search({ query, max: this.searchMax });
      for (const post of posts) {
        const c = postToCopycat({
          post,
          name: this.identity?.name,
          ticker: this.identity?.ticker,
          keywords,
          canonicalCa: this.canonicalCa,
          ownAccountId: x.accountId,
        });
        if (c) this.file(ctx, c);
      }
    } catch (err) {
      ctx.progress("scan.failed", `X search for "${query}" failed: ${errorText(err)}`, { scan: "x", query });
    }
  }

  /** Files one copycat (deduped by source+id) and publishes the updated report. */
  private file(ctx: WorkerContext, c: Copycat): void {
    if (this.canonicalCa && c.source === "pump.fun" && c.externalId === this.canonicalCa) return;
    const key = copycatKey(c);
    if (this.copycats.has(key)) return;
    this.copycats.set(key, c);
    ctx.emit({
      type: "Shield.copycatFound",
      reason: `${c.source} ${c.externalId} matches our ${c.match} (score ${c.score}); evidence: ${c.url}`,
      payload: { copycat: c },
    });
    this.emitReport(ctx, `copycat ${key} filed`);
  }

  private emitReport(ctx: WorkerContext, why: string): void {
    const report = this.report();
    ctx.emit({
      type: "Shield.report",
      reason: `${why}: ${report.copycats.length} copycat(s), ${report.bundleFlags.length} bundle flag(s), canonical ${report.canonicalCa ?? "pending launch"}`,
      payload: { report },
    });
  }

  private async watch(ctx: WorkerContext, coinCa: string): Promise<void> {
    const solana = requireClient(ctx, "solana", "Shield.anomalies");
    ctx.progress("anomalies.watch", `watching ${coinCa} for bundled launches and dev-wallet anomalies`, { coinCa });
    const unwatch = await solana.watchAnomalies({
      coinCa,
      onFlag: (flag) => {
        if (this.stopped) return;
        this.bundleFlags.push(flag);
        ctx.emit({
          type: "Shield.bundleFlag",
          reason: `${flag.kind} on ${coinCa}: ${flag.evidence}`,
          payload: { flag },
        });
        this.emitReport(ctx, `${flag.kind} detected`);
      },
    });
    if (this.stopped) unwatch();
    else this.unwatch = unwatch;
  }
}
