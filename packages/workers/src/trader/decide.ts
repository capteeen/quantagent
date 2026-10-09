/**
 * B6 TRADER — the deterministic, pure post-launch rule set.
 * Documented in /docs/trading.md; keep that file and this one in sync.
 *
 * `decide(state, tick)` never touches a clock, a wallet or the network: every input
 * is in `state` and `tick`, every output carries a one-line reason, and the same
 * inputs always give the same decision.
 */

export interface TraderConfig {
  /** Buy when price ≤ (1 − dipPct/100) × trailing high. Env DIP_PCT, default 20. */
  dipPct: number;
  /** Slippage tolerance in basis points for every buy. Env SLIPPAGE_BPS, default 500. */
  slippageBps: number;
  /** SOL per support buy (capped by the remaining budget). Env TRADER_BUY_SOL, default 0.02. */
  buySol: number;
  /** At most one buy per window. Env TRADER_MIN_BUY_INTERVAL_MS, default 15 min. */
  minBuyIntervalMs: number;
  /** No sell within this long after Launch.live. Env TRADER_SELL_LOCK_MS, default 24 h. */
  sellLockMs: number;
  /** The trailing high is the max price over this window before the tick. Env TRADER_TRAILING_WINDOW_MS, default 1 h. */
  trailingWindowMs: number;
}

export const DEFAULT_TRADER_CONFIG: Readonly<TraderConfig> = {
  dipPct: 20,
  slippageBps: 500,
  buySol: 0.02,
  minBuyIntervalMs: 15 * 60_000,
  sellLockMs: 24 * 60 * 60_000,
  trailingWindowMs: 60 * 60_000,
};

/** Smallest buy worth sending (dust guard). */
export const MIN_BUY_SOL = 0.001;

/** Reads TraderConfig from process.env; unset or invalid values keep the defaults. */
export function traderConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TraderConfig {
  const num = (name: string, fallback: number, min = 0): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  return {
    dipPct: Math.min(99, num("DIP_PCT", DEFAULT_TRADER_CONFIG.dipPct, 1)),
    slippageBps: num("SLIPPAGE_BPS", DEFAULT_TRADER_CONFIG.slippageBps, 1),
    buySol: num("TRADER_BUY_SOL", DEFAULT_TRADER_CONFIG.buySol, MIN_BUY_SOL),
    minBuyIntervalMs: num("TRADER_MIN_BUY_INTERVAL_MS", DEFAULT_TRADER_CONFIG.minBuyIntervalMs),
    sellLockMs: num("TRADER_SELL_LOCK_MS", DEFAULT_TRADER_CONFIG.sellLockMs),
    trailingWindowMs: num("TRADER_TRAILING_WINDOW_MS", DEFAULT_TRADER_CONFIG.trailingWindowMs, 1),
  };
}

export interface PriceSample {
  /** Epoch ms. */
  at: number;
  /** Quote per token in one consistent unit (SOL or USD); only ratios matter. */
  price: number;
}

export interface TraderState {
  /** The coin this Trader was bound to by Launcher.deployed. The only coin it will ever trade. */
  coinCa: string;
  /** Epoch ms of Launch.live, or null before the launch is live. */
  liveAt: number | null;
  /** Epoch ms of the last executed buy, or null. */
  lastBuyAt: number | null;
  /** SOL still allowed by the worker budget (budget.sol − used.sol). */
  solRemaining: number;
  /** Price samples strictly before this tick, oldest first. */
  samples: readonly PriceSample[];
}

export interface TraderTick {
  coinCa: string;
  /** Epoch ms. */
  now: number;
  price: number;
}

export type TradeDecision =
  | {
      action: "buy";
      coinCa: string;
      sol: number;
      slippageBps: number;
      price: number;
      trailingHigh: number;
      dipPct: number;
      reason: string;
    }
  | { action: "hold"; coinCa: string; price: number; trailingHigh: number | null; reason: string };

export class WrongCoin extends Error {
  override readonly name = "WrongCoin";
  constructor(
    public readonly coinCa: string,
    public readonly launchCoinCa: string,
  ) {
    super(`Trader refuses to trade ${coinCa}: the launch coin is ${launchCoinCa}`);
  }
}

/** Throws WrongCoin unless `coinCa` is exactly the launch coin. Called before every trade. */
export function assertSameCoin(coinCa: string, launchCoinCa: string): void {
  if (!launchCoinCa) throw new WrongCoin(coinCa, "(none deployed yet)");
  if (coinCa !== launchCoinCa) throw new WrongCoin(coinCa, launchCoinCa);
}

/** Max price over samples in (now − window, now]; null when there is none. */
export function trailingHigh(samples: readonly PriceSample[], now: number, windowMs: number): number | null {
  let high: number | null = null;
  for (const s of samples) {
    if (s.at > now || s.at <= now - windowMs) continue;
    if (!Number.isFinite(s.price) || s.price <= 0) continue;
    if (high === null || s.price > high) high = s.price;
  }
  return high;
}

/** Appends a sample and drops everything older than the window. Returns a new array. */
export function pushSample(samples: readonly PriceSample[], sample: PriceSample, windowMs: number): PriceSample[] {
  return [...samples, sample].filter((s) => s.at > sample.at - windowMs);
}

/** Milliseconds until a sell is allowed; 0 when the lock has passed. Infinity before Launch.live. */
export function sellLockRemainingMs(state: Pick<TraderState, "liveAt">, now: number, cfg: TraderConfig = DEFAULT_TRADER_CONFIG): number {
  if (state.liveAt === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, state.liveAt + cfg.sellLockMs - now);
}

export function canSell(state: Pick<TraderState, "liveAt">, now: number, cfg: TraderConfig = DEFAULT_TRADER_CONFIG): boolean {
  return sellLockRemainingMs(state, now, cfg) === 0;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toPrecision(4).replace(/\.?0+$/, "");
}

/**
 * The rule set, in order. The first rule that applies decides:
 *  1. tick.coinCa must be the launch coin (throws WrongCoin otherwise).
 *  2. Not live yet → hold.
 *  3. No price sample in the trailing window → hold (nothing to dip from).
 *  4. price > (1 − dipPct/100) × trailingHigh → hold.
 *  5. A buy happened less than minBuyIntervalMs ago → hold.
 *  6. Remaining SOL budget < MIN_BUY_SOL → hold.
 *  7. Otherwise buy min(buySol, solRemaining) at slippageBps.
 * Selling: this rule set never sells. `canSell` is false for sellLockMs after Launch.live
 * and is the guard any future sell rule must pass.
 */
export function decide(state: TraderState, tick: TraderTick, cfg: TraderConfig = DEFAULT_TRADER_CONFIG): TradeDecision {
  assertSameCoin(tick.coinCa, state.coinCa);
  const { coinCa, price } = tick;
  const high = trailingHigh(state.samples, tick.now, cfg.trailingWindowMs);

  if (!Number.isFinite(price) || price <= 0) {
    return { action: "hold", coinCa, price, trailingHigh: high, reason: `price ${String(price)} is not a positive number; holding` };
  }
  if (state.liveAt === null) {
    return { action: "hold", coinCa, price, trailingHigh: high, reason: "launch is not live yet; support buys start after Launch.live" };
  }
  if (high === null) {
    return { action: "hold", coinCa, price, trailingHigh: null, reason: `no price sample in the last ${fmt(cfg.trailingWindowMs / 60_000)} min yet; nothing to dip from` };
  }
  const threshold = high * (1 - cfg.dipPct / 100);
  if (price > threshold) {
    const dip = ((high - price) / high) * 100;
    return {
      action: "hold",
      coinCa,
      price,
      trailingHigh: high,
      reason: `price ${fmt(price)} is ${fmt(Math.max(0, dip))}% under the 1h high ${fmt(high)}; the support rule needs ${fmt(cfg.dipPct)}%`,
    };
  }
  if (state.lastBuyAt !== null && tick.now - state.lastBuyAt < cfg.minBuyIntervalMs) {
    const ago = Math.round((tick.now - state.lastBuyAt) / 60_000);
    return {
      action: "hold",
      coinCa,
      price,
      trailingHigh: high,
      reason: `dip of ${fmt(((high - price) / high) * 100)}% qualifies but the last buy was ${ago} min ago; one buy per ${fmt(cfg.minBuyIntervalMs / 60_000)} min`,
    };
  }
  const sol = Math.min(cfg.buySol, state.solRemaining);
  if (!(sol >= MIN_BUY_SOL)) {
    return {
      action: "hold",
      coinCa,
      price,
      trailingHigh: high,
      reason: `dip qualifies but the SOL budget is exhausted (${fmt(Math.max(0, state.solRemaining))} SOL left); never exceeding the budget`,
    };
  }
  return {
    action: "buy",
    coinCa,
    sol,
    slippageBps: cfg.slippageBps,
    price,
    trailingHigh: high,
    dipPct: cfg.dipPct,
    reason: `support buy ${fmt(sol)} SOL: price ${fmt(price)} is ${fmt(((high - price) / high) * 100)}% under the 1h high ${fmt(high)} (rule: ≥${fmt(cfg.dipPct)}% dip, ≤1 buy/${fmt(cfg.minBuyIntervalMs / 60_000)}min, slippage ${cfg.slippageBps} bps)`,
  };
}
