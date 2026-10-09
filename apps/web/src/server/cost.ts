/**
 * The cost line under the LaunchButton: "launch · dev buy · agent budget · you pay".
 * Every number comes from env or a package constant; nothing is invented.
 */
import { DEFAULT_BUDGETS } from "@quantagent/core";
import { CREATE_OVERHEAD_SOL } from "@quantagent/solana";
import { DEFAULT_DEV_BUY_SOL } from "@quantagent/workers";
import type { Cluster, CostLine, Env } from "./types";

export const DEFAULT_PRIORITY_FEE_SOL = 0.0005;

export function envNumber(env: Env, name: string, fallback: number, min = 0): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export function devBuySolFromEnv(env: Env = process.env): number {
  return envNumber(env, "LAUNCH_DEV_BUY_SOL", DEFAULT_DEV_BUY_SOL);
}

export function traderBudgetSolFromEnv(env: Env = process.env): number {
  return envNumber(env, "TRADER_BUDGET_SOL", DEFAULT_BUDGETS.Trader.sol);
}

export function priorityFeeSolFromEnv(env: Env = process.env): number {
  return envNumber(env, "PUMPPORTAL_PRIORITY_FEE_SOL", DEFAULT_PRIORITY_FEE_SOL);
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export function costLine(env: Env, cluster: Cluster, devBuyOverride?: number): CostLine {
  const devBuySol = devBuyOverride ?? devBuySolFromEnv(env);
  const agentBudgetSol = traderBudgetSolFromEnv(env);
  const launchSol = round(CREATE_OVERHEAD_SOL + priorityFeeSolFromEnv(env));
  return {
    cluster,
    launchSol,
    devBuySol: round(devBuySol),
    agentBudgetSol: round(agentBudgetSol),
    youPaySol: round(launchSol + devBuySol + agentBudgetSol),
    notes: [
      "launch = pump.fun create overhead (mint rent, bonding-curve accounts) + priority fee",
      "dev buy is folded into the create transaction; PumpPortal takes 0.5% and pump.fun's bonding curve ~1% on buys",
      "agent budget is the Trader's SOL cap for the life of the coin, enforced in code",
      "you pay = what the per-launch agent wallet is funded with; unspent SOL stays in it",
      cluster === "devnet" ? "devnet: no real SOL moves; pump.fun deploys need PUMPPORTAL_URL on devnet" : "mainnet-beta: real SOL",
    ],
  };
}
