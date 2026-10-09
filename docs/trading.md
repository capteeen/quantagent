# Trader rules

The Trader (`packages/workers/src/trader`) controls the per-launch agent wallet through
the Solana client. Its behaviour is deterministic: the whole rule set is the pure function
`decide(state, tick, config)` in `src/trader/decide.ts`. Same inputs, same decision, one
human-readable reason per decision. This file is the contract; the code and its tests
follow it.

## At launch

The Trader makes no trade of its own. It binds itself to the coin from
`Launcher.deployed` and observes `Launcher.devBuy` (the dev buy is executed by the
Launcher inside the pump.fun deploy and was approved by the launch tap). It emits
`Worker.progress` for both observations and finishes with `Worker.done`
`{ coinCa, devBuy: { txSignature, sol } }`.

If the Launcher fails before deploying, the Trader fails too ("Launcher failed before
deploying a coin"), so the orchestrator can emit `Launch.failed`.

## Post-launch tick

Every tick (`tickEveryMs`, default 60 s) the Trader:

1. Reads the current price of the launch coin from the injected price feed
   (`PriceFeed.price({ coinCa })`). Without a feed it throws
   `NotImplemented("Trader.priceFeed", …, ["TRADER_PRICE_FEED_URL"])` and the worker
   fails honestly; it never guesses a price.
2. Builds `TraderState` from what it observed: the launch `coinCa`, the time of
   `Launch.live`, the time of its last buy, the remaining SOL budget
   (`ctx.budget.sol − ctx.used.sol`) and the price samples of the trailing window.
3. Calls `decide(state, { coinCa, now, price })` and logs the reason as
   `Worker.progress { step: "decide" }`.
4. On a `buy` decision: asserts the coin, asks for approval, charges the budget, sends the
   buy, logs the signature.

## The rule set (`decide`)

Rules apply in this order; the first one that applies decides.

| # | Rule | Decision |
|---|------|----------|
| 1 | `tick.coinCa !== state.coinCa` | **throws `WrongCoin`**: the Trader never trades another coin. |
| 2 | `Launch.live` has not happened | hold |
| 3 | No price sample in the trailing window (default 1 h) | hold (nothing to dip from) |
| 4 | `price > (1 − DIP_PCT/100) × trailingHigh` | hold |
| 5 | Last buy less than `TRADER_MIN_BUY_INTERVAL_MS` ago (default 15 min) | hold |
| 6 | Remaining SOL budget `< 0.001` | hold (never exceeds the budget) |
| 7 | otherwise | **buy** `min(TRADER_BUY_SOL, remaining)` SOL at `SLIPPAGE_BPS` |

`trailingHigh` is the maximum price over samples with `now − window < at ≤ now`,
i.e. samples recorded on previous ticks; the current tick's price is appended after the
decision, so a price can never be compared with itself.

### Selling

This rule set never sells. `canSell(state, now)` is `false` for `TRADER_SELL_LOCK_MS`
(default 24 h) after `Launch.live` and `Infinity` before it; any future sell rule must
pass that guard. Creator-fee claims are not trades and are not the Trader's job.

## Executing a buy

1. `assertSameCoin(decision.coinCa, launchCoinCa)` — a mismatch throws and fails the
   worker (tested).
2. `ctx.requireApproval({ actionClass: "trades", draft: { side: "buy", coinCa, sol,
   slippageBps, price, trailingHigh } })`. The card is pre-filled; the user taps approve,
   edits the amount, or skips. Autopilot (`autopilot.trades`) resolves it instantly.
   - **edit**: `sol` is taken from the edited draft and must be a positive number within
     the remaining budget, and `coinCa` (if present) must still be the launch coin;
     otherwise the trade is rejected with the reason.
   - **skip**: `Trader.rejected { side: "buy", sol, reason: "skipped by the user" }`.
3. `ctx.spend("sol", sol)` before the trade (throws `BudgetExceeded` and fails the worker
   if the cap would be passed; nothing is sent).
4. `solana.buy({ coinCa, sol, slippageBps, reason })`.
5. `Trader.traded { side: "buy", sol, txSignature, price }`, or
   `Trader.rejected { side, sol, reason }` when the client throws.

`lastBuyAt` is set only when the buy actually executed.

## Configuration (environment)

| Variable | Default | Meaning |
|----------|---------|---------|
| `DIP_PCT` | `20` | Dip under the trailing 1 h high that triggers a support buy (1–99). |
| `SLIPPAGE_BPS` | `500` | Slippage tolerance per buy, in basis points. |
| `TRADER_BUY_SOL` | `0.02` | SOL per support buy, capped by the remaining budget. |
| `TRADER_MIN_BUY_INTERVAL_MS` | `900000` | Minimum time between two buys (15 min). |
| `TRADER_SELL_LOCK_MS` | `86400000` | No sell within this long after `Launch.live` (24 h). |
| `TRADER_TRAILING_WINDOW_MS` | `3600000` | Window of the trailing high (1 h). |
| `TRADER_PRICE_FEED_URL` | — | Named in the `NotImplemented` when no `PriceFeed` is injected. |

The SOL budget itself is the Trader's worker budget (`LaunchOptions.budgets.Trader.sol`,
default `0.1` in core). Invalid or unset values keep the defaults; `traderConfigFromEnv`
never throws.

## Events

| Event | When |
|-------|------|
| `Worker.progress { step: "observe" }` | start: waiting for the deploy |
| `Worker.progress { step: "deployed.observed" }` | bound to the coin |
| `Worker.progress { step: "devBuy.observed" }` | dev buy signature seen |
| `Worker.progress { step: "decide" }` | every tick, with the one-line reason |
| `Worker.awaitingApproval` / `Worker.approvalResolved` | every gated buy |
| `Worker.spent { dimension: "sol" }` | before every buy |
| `Trader.traded` | a buy executed, with its tx signature |
| `Trader.rejected` | a decided buy that did not execute (skip, invalid edit, client error) |
