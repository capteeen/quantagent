/**
 * Cluster + RPC resolution.
 *
 * Mainnet-beta is the default: pump.fun only exists there. Devnet is used only
 * when a caller asks for it explicitly (cluster: "devnet" or SOLANA_CLUSTER=devnet),
 * for wallet, budget and watcher testing without real SOL. Real SOL is still
 * protected by the per-launch SOL budget, the approval gates and autopilot opt-ins,
 * not by the cluster choice.
 */

import { Connection } from "@solana/web3.js";
import { envOf, type Env } from "./env";

export type Cluster = "devnet" | "mainnet-beta";

export const DEFAULT_CLUSTER: Cluster = "mainnet-beta";
export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
export const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export class UnknownCluster extends Error {
  override readonly name = "UnknownCluster";
  constructor(requested: string) {
    super(`unknown cluster "${requested}" (expected "mainnet-beta" or "devnet")`);
  }
}

/**
 * The explicit request wins, then SOLANA_CLUSTER, then mainnet-beta.
 * Anything other than the two known clusters is refused rather than guessed.
 */
export function resolveCluster(requested: Cluster | undefined, env?: Env): Cluster {
  const e = envOf(env);
  const raw = requested ?? (e.SOLANA_CLUSTER?.trim() || undefined);
  if (raw === undefined) return DEFAULT_CLUSTER;
  if (raw === "mainnet-beta" || raw === "devnet") return raw;
  throw new UnknownCluster(String(raw));
}

/**
 * SOLANA_RPC_URL wins when set. Otherwise HELIUS_API_KEY selects the Helius
 * endpoint for the cluster, else the public Solana RPC for the cluster.
 */
export function rpcUrlFor(cluster: Cluster, env?: Env): string {
  const e = envOf(env);
  if (e.SOLANA_RPC_URL && e.SOLANA_RPC_URL.trim() !== "") return e.SOLANA_RPC_URL.trim();
  if (e.HELIUS_API_KEY && e.HELIUS_API_KEY.trim() !== "") {
    const host = cluster === "devnet" ? "devnet.helius-rpc.com" : "mainnet.helius-rpc.com";
    return `https://${host}/?api-key=${encodeURIComponent(e.HELIUS_API_KEY.trim())}`;
  }
  return cluster === "devnet" ? DEFAULT_DEVNET_RPC : DEFAULT_MAINNET_RPC;
}

export function createConnection(cluster: Cluster, env?: Env): Connection {
  return new Connection(rpcUrlFor(cluster, env), { commitment: "confirmed" });
}

/** The subset of Connection this package uses; tests pass a mock. */
export type Rpc = Pick<
  Connection,
  | "rpcEndpoint"
  | "sendRawTransaction"
  | "confirmTransaction"
  | "getLatestBlockhash"
  | "getBalance"
  | "getSignaturesForAddress"
  | "getParsedTransactions"
  | "getProgramAccounts"
>;

export function explorerTxUrl(signature: string, cluster: Cluster): string {
  return cluster === "devnet"
    ? `https://solscan.io/tx/${signature}?cluster=devnet`
    : `https://solscan.io/tx/${signature}`;
}
