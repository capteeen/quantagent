/**
 * Cluster + RPC resolution.
 *
 * Devnet is the default. "mainnet-beta" is accepted only when BOTH hold:
 *   1. the caller passes cluster: "mainnet-beta" explicitly, and
 *   2. QUANTAGENT_MAINNET=true is set in the environment.
 * Either one alone is refused (MainnetRefused). The flag never flips the
 * default on its own, so a forgotten env var can never move real SOL.
 */

import { Connection } from "@solana/web3.js";
import { envFlag, envOf, type Env } from "./env";

export type Cluster = "devnet" | "mainnet-beta";

export const MAINNET_FLAG = "QUANTAGENT_MAINNET";
export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
export const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export class MainnetRefused extends Error {
  override readonly name = "MainnetRefused";
  constructor(because: string) {
    super(`mainnet-beta refused: ${because}`);
  }
}

export function resolveCluster(requested: Cluster | undefined, env?: Env): Cluster {
  const e = envOf(env);
  if (requested === undefined || requested === "devnet") return "devnet";
  if (requested === "mainnet-beta") {
    if (!envFlag(e, MAINNET_FLAG)) {
      throw new MainnetRefused(`${MAINNET_FLAG}=true is not set (cluster "mainnet-beta" was requested explicitly)`);
    }
    return "mainnet-beta";
  }
  throw new MainnetRefused(`unknown cluster "${String(requested)}"`);
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
