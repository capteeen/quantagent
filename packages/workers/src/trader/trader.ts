/**
 * B6 TRADER
 * At launch: observes the dev buy only. Post-launch: the deterministic support-buy
 * rules in ./decide.ts (documented in /docs/trading.md), each buy gated by
 * requireApproval({ actionClass: "trades" }) unless autopilot.trades.
 * Never trades another coin, never sells in the first 24h, never exceeds the SOL budget.
 */

import { ApprovalDenied, NotImplemented, type EventOf, type QuantagentEvent } from "@quantagent/core/types";
import type { SolanaClient } from "@quantagent/core/types/clients";
import type { PostLaunchWorker, StartResult, WorkerContext } from "../context";
import { errorText, requireClient } from "../shared";
import {
  assertSameCoin,
  decide,
  pushSample,
  sellLockRemainingMs,
  traderConfigFromEnv,
  type PriceSample,
  type TradeDecision,
  type TraderConfig,
  type TraderState,
} from "./decide";
import { waitForDeployed } from "./launchGate";

/**
 * Price source for the launch coin. SolanaClient has no quote method, so the
 * integrator injects one (Jupiter / pump.fun curve / DEX pool). Unit: anything
 * consistent (SOL or USD per token); the rules only compare ratios.
 */
export interface PriceFeed {
  price(input: { coinCa: string }): Promise<{ price: number; at?: string }>;
}

export interface TraderOptions {
  priceFeed?: PriceFeed;
  config?: Partial<TraderConfig>;
  /** Epoch-ms clock, injectable for tests. */
  now?: () => number;
  tickEveryMs?: number;
}

const WORKER = "Trader" as const;
export const PRICE_FEED_NEEDS = ["TRADER_PRICE_FEED_URL"];

export class TraderWorker implements PostLaunchWorker {
  readonly name = WORKER;
  readonly tickEveryMs: number;
  readonly config: TraderConfig;
  private readonly feed: PriceFeed | null;
  private readonly now: () => number;
  private coinCa: string | null = null;
  private deployed: EventOf<"Launcher.deployed">["payload"] | null = null;
  private devBuy: EventOf<"Launcher.devBuy">["payload"] | null = null;
  private liveAt: number | null = null;
  private lastBuyAt: number | null = null;
  private samples: PriceSample[] = [];
  private inTick = false;
  private stopped = false;

  constructor(opts: TraderOptions = {}) {
    this.config = { ...traderConfigFromEnv(), ...opts.config };
    this.feed = opts.priceFeed ?? null;
    this.now = opts.now ?? (() => Date.now());
    this.tickEveryMs = opts.tickEveryMs ?? 60_000;
  }

  /** What the Trader currently knows; exposed for the coin page and tests. */
  snapshot(): { coinCa: string | null; liveAt: number | null; lastBuyAt: number | null; samples: PriceSample[] } {
    return { coinCa: this.coinCa, liveAt: this.liveAt, lastBuyAt: this.lastBuyAt, samples: [...this.samples] };
  }

  async start(ctx: WorkerContext): Promise<StartResult> {
    requireClient(ctx, "solana", "Trader.wallet");
    const c = this.config;
    ctx.progress("observe", "at launch the Trader only observes the dev buy; support buys start after Launch.live", {
      rules: {
        dipPct: c.dipPct,
        slippageBps: c.slippageBps,
        buySol: c.buySol,
        minBuyIntervalMs: c.minBuyIntervalMs,
        sellLockMs: c.sellLockMs,
        trailingWindowMs: c.trailingWindowMs,
      },
      solBudget: ctx.budget.sol,
    });

    const deployed = await waitForDeployed(ctx, () => this.deployed);
    this.bind(ctx, deployed);

    if (ctx.options.devBuySol > 0 && !this.devBuy) {
      ctx.progress("devBuy.wait", `waiting for the Launcher's ${ctx.options.devBuySol} SOL dev buy to confirm`);
      const devBuy = ctx.waitFor("Launcher.devBuy");
      devBuy.catch(() => undefined);
      const launcherFailed = ctx.waitFor("Worker.failed", { predicate: (e) => e.worker === "Launcher" });
      launcherFailed.catch(() => undefined);
      const e = await Promise.race([
        devBuy,
        launcherFailed.then((f) => {
          throw new Error(`Launcher failed after deploying, before the dev buy confirmed: ${f.payload.reason}`);
        }),
      ]);
      this.observeDevBuy(ctx, e.payload);
    }

    return {
      coinCa: this.coinCa,
      devBuy: this.devBuy,
      rules: { dipPct: c.dipPct, slippageBps: c.slippageBps, minBuyIntervalMs: c.minBuyIntervalMs, sellLockMs: c.sellLockMs },
    };
  }

  on(event: QuantagentEvent, ctx: WorkerContext): void {
    switch (event.type) {
      case "Launcher.deployed":
        this.bind(ctx, event.payload);
        return;
      case "Launcher.devBuy":
        this.observeDevBuy(ctx, event.payload);
        return;
      case "Launch.live": {
        if (this.liveAt !== null) return;
        this.liveAt = Date.parse(event.at) || this.now();
        const lock = sellLockRemainingMs({ liveAt: this.liveAt }, this.now(), this.config);
        ctx.progress("live", `launch is live; support buys enabled, selling locked for ${Math.round(lock / 3_600_000)}h`, {
          liveAt: new Date(this.liveAt).toISOString(),
          sellLockMs: this.config.sellLockMs,
        });
        return;
      }
      default:
        return;
    }
  }

  async tick(ctx: WorkerContext): Promise<void> {
    if (this.stopped || this.inTick) return;
    this.inTick = true;
    try {
      await this.runTick(ctx);
    } finally {
      this.inTick = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private bind(ctx: WorkerContext, payload: EventOf<"Launcher.deployed">["payload"]): void {
    if (this.coinCa) {
      if (this.coinCa !== payload.coinCa) {
        throw new Error(`Trader is bound to ${this.coinCa} but a second Launcher.deployed named ${payload.coinCa}`);
      }
      return;
    }
    this.coinCa = payload.coinCa;
    this.deployed = payload;
    ctx.progress("deployed.observed", `bound to ${payload.coinCa}; the Trader will never trade any other coin`, {
      coinCa: payload.coinCa,
      txSignature: payload.txSignature,
    });
  }

  private observeDevBuy(ctx: WorkerContext, payload: EventOf<"Launcher.devBuy">["payload"]): void {
    if (this.devBuy) return;
    this.devBuy = payload;
    ctx.progress("devBuy.observed", `dev buy of ${payload.sol} SOL confirmed (${payload.txSignature}); no further trade at launch`, {
      txSignature: payload.txSignature,
      sol: payload.sol,
    });
  }

  private feedOrThrow(): PriceFeed {
    if (this.feed) return this.feed;
    throw new NotImplemented(
      "Trader.priceFeed",
      "no PriceFeed was injected and SolanaClient has no quote method; the Trader never guesses a price",
      PRICE_FEED_NEEDS,
    );
  }

  private state(ctx: WorkerContext): TraderState {
    return {
      coinCa: this.coinCa ?? "",
      liveAt: this.liveAt,
      lastBuyAt: this.lastBuyAt,
      solRemaining: Math.max(0, ctx.budget.sol - ctx.used.sol),
      samples: this.samples,
    };
  }

  private async runTick(ctx: WorkerContext): Promise<void> {
    if (!this.coinCa) {
      ctx.progress("tick.idle", "no coin deployed yet; nothing to trade");
      return;
    }
    if (this.liveAt === null) {
      ctx.progress("tick.idle", "launch is not live yet; support buys start after Launch.live");
      return;
    }
    const solana = requireClient(ctx, "solana", "Trader.buy");
    const feed = this.feedOrThrow();
    const coinCa = this.coinCa;
    const quote = await feed.price({ coinCa });
    const now = this.now();

    const decision = decide(this.state(ctx), { coinCa, now, price: quote.price }, this.config);
    this.samples = pushSample(this.samples, { at: now, price: quote.price }, this.config.trailingWindowMs);
    ctx.progress("decide", decision.reason, {
      action: decision.action,
      price: decision.price,
      trailingHigh: decision.trailingHigh,
      samples: this.samples.length,
      solRemaining: Math.max(0, ctx.budget.sol - ctx.used.sol),
    });
    if (decision.action !== "buy") return;
    await this.executeBuy(ctx, solana, decision, now);
  }

  private async executeBuy(ctx: WorkerContext, solana: SolanaClient, decision: Extract<TradeDecision, { action: "buy" }>, now: number): Promise<void> {
    const launchCoinCa = this.coinCa ?? "";
    assertSameCoin(decision.coinCa, launchCoinCa);

    let sol = decision.sol;
    try {
      const outcome = await ctx.requireApproval({
        actionClass: "trades",
        title: `Buy ${decision.sol} SOL of ${decision.coinCa.slice(0, 6)}… on the ${decision.dipPct}% dip`,
        draft: {
          side: "buy",
          coinCa: decision.coinCa,
          sol: decision.sol,
          slippageBps: decision.slippageBps,
          price: decision.price,
          trailingHigh: decision.trailingHigh,
        },
        reason: decision.reason,
      });
      if (outcome.decision === "edit") {
        const draftCa = outcome.draft.coinCa;
        if (typeof draftCa === "string") assertSameCoin(draftCa, launchCoinCa);
        const edited = Number(outcome.draft.sol);
        const remaining = Math.max(0, ctx.budget.sol - ctx.used.sol);
        if (!Number.isFinite(edited) || edited <= 0 || edited > remaining) {
          this.reject(ctx, sol, `edited amount ${String(outcome.draft.sol)} SOL is not a positive number within the remaining budget (${remaining} SOL)`);
          return;
        }
        sol = edited;
      }
    } catch (err) {
      if (err instanceof ApprovalDenied) {
        this.reject(ctx, sol, "skipped by the user");
        return;
      }
      throw err;
    }

    assertSameCoin(decision.coinCa, launchCoinCa);
    // The scoped Solana client meters SOL on buy(); charging here too would double count.
    try {
      const { txSignature } = await solana.buy({ coinCa: decision.coinCa, sol, slippageBps: decision.slippageBps, reason: decision.reason });
      this.lastBuyAt = now;
      ctx.emit({
        type: "Trader.traded",
        reason: `${decision.reason}; tx ${txSignature}`,
        payload: { side: "buy", sol, txSignature, price: decision.price },
      });
    } catch (err) {
      this.reject(ctx, sol, `buy failed: ${errorText(err)}`);
    }
  }

  private reject(ctx: WorkerContext, sol: number, why: string): void {
    ctx.emit({ type: "Trader.rejected", reason: `buy of ${sol} SOL not executed: ${why}`, payload: { side: "buy", sol, reason: why } });
  }
}
