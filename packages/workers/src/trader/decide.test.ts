import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRADER_CONFIG,
  WrongCoin,
  assertSameCoin,
  canSell,
  decide,
  pushSample,
  sellLockRemainingMs,
  trailingHigh,
  traderConfigFromEnv,
  type TraderState,
} from "./decide";

const CA = "CoinCA1111111111111111111111111111111111111";
const H = 60 * 60_000;
const T0 = 1_800_000_000_000;

function state(over: Partial<TraderState> = {}): TraderState {
  return {
    coinCa: CA,
    liveAt: T0 - 10 * 60_000,
    lastBuyAt: null,
    solRemaining: 0.1,
    samples: [
      { at: T0 - 50 * 60_000, price: 1.0 },
      { at: T0 - 20 * 60_000, price: 0.9 },
    ],
    ...over,
  };
}

describe("decide (pure)", () => {
  it("buys on a dip of at least DIP_PCT under the trailing 1h high", () => {
    const d = decide(state(), { coinCa: CA, now: T0, price: 0.8 });
    expect(d.action).toBe("buy");
    if (d.action !== "buy") return;
    expect(d.sol).toBe(DEFAULT_TRADER_CONFIG.buySol);
    expect(d.slippageBps).toBe(500);
    expect(d.trailingHigh).toBe(1.0);
    expect(d.reason).toMatch(/support buy/);
  });

  it("holds when the price is above the threshold", () => {
    const d = decide(state(), { coinCa: CA, now: T0, price: 0.81 });
    expect(d.action).toBe("hold");
    expect(d.reason).toMatch(/under the 1h high/);
  });

  it("is deterministic", () => {
    const a = decide(state(), { coinCa: CA, now: T0, price: 0.75 });
    const b = decide(state(), { coinCa: CA, now: T0, price: 0.75 });
    expect(a).toEqual(b);
  });

  it("allows at most one buy per 15 minutes", () => {
    const recent = decide(state({ lastBuyAt: T0 - 14 * 60_000 }), { coinCa: CA, now: T0, price: 0.7 });
    expect(recent.action).toBe("hold");
    expect(recent.reason).toMatch(/one buy per 15 min/);
    const later = decide(state({ lastBuyAt: T0 - 15 * 60_000 }), { coinCa: CA, now: T0, price: 0.7 });
    expect(later.action).toBe("buy");
  });

  it("never exceeds the SOL budget", () => {
    const capped = decide(state({ solRemaining: 0.005 }), { coinCa: CA, now: T0, price: 0.7 });
    expect(capped.action).toBe("buy");
    if (capped.action === "buy") expect(capped.sol).toBe(0.005);
    const empty = decide(state({ solRemaining: 0 }), { coinCa: CA, now: T0, price: 0.7 });
    expect(empty.action).toBe("hold");
    expect(empty.reason).toMatch(/budget is exhausted/);
  });

  it("holds before Launch.live and without a trailing sample", () => {
    expect(decide(state({ liveAt: null }), { coinCa: CA, now: T0, price: 0.5 }).reason).toMatch(/not live/);
    expect(decide(state({ samples: [] }), { coinCa: CA, now: T0, price: 0.5 }).reason).toMatch(/no price sample/);
    // samples older than the window do not count
    const stale = state({ samples: [{ at: T0 - 2 * H, price: 5 }] });
    expect(decide(stale, { coinCa: CA, now: T0, price: 0.5 }).reason).toMatch(/no price sample/);
  });

  it("throws WrongCoin for a different CA, before anything else", () => {
    const other = "OtherCA111111111111111111111111111111111111";
    expect(() => decide(state(), { coinCa: other, now: T0, price: 0.1 })).toThrow(WrongCoin);
    expect(() => assertSameCoin(other, CA)).toThrow(/refuses to trade/);
    expect(() => assertSameCoin(CA, "")).toThrow(WrongCoin);
    expect(() => assertSameCoin(CA, CA)).not.toThrow();
  });

  it("never sells within 24h of Launch.live and never returns a sell", () => {
    const live = T0;
    expect(canSell({ liveAt: live }, live + 23 * H)).toBe(false);
    expect(sellLockRemainingMs({ liveAt: live }, live + 23 * H)).toBe(H);
    expect(canSell({ liveAt: live }, live + 24 * H)).toBe(true);
    expect(canSell({ liveAt: null }, live)).toBe(false);
    // even a 90% crash in the first hour is a buy or a hold, never a sell
    const d = decide(state({ liveAt: live - 60_000 }), { coinCa: CA, now: live, price: 0.1 });
    expect(d.action).not.toBe("sell");
  });

  it("trailingHigh and pushSample respect the window", () => {
    const samples = pushSample([{ at: T0 - 2 * H, price: 9 }], { at: T0, price: 1 }, H);
    expect(samples).toEqual([{ at: T0, price: 1 }]);
    expect(trailingHigh([{ at: T0 - 30 * 60_000, price: 2 }, { at: T0 + 1, price: 50 }], T0, H)).toBe(2);
  });

  it("reads config from env with safe fallbacks", () => {
    const cfg = traderConfigFromEnv({ DIP_PCT: "30", SLIPPAGE_BPS: "abc", TRADER_BUY_SOL: "0.05" });
    expect(cfg.dipPct).toBe(30);
    expect(cfg.slippageBps).toBe(500);
    expect(cfg.buySol).toBe(0.05);
    expect(traderConfigFromEnv({})).toEqual(DEFAULT_TRADER_CONFIG);
  });
});
