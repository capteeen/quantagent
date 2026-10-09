/**
 * @quantagent/solana — chain layer for quantagent.
 *
 *   createSolanaClient  → SolanaClient (core/types/clients) for one launch
 *   createQuantumClient → QuantumClient backed by ANU QRNG, no fallback
 *   wallet/   per-launch encrypted agent wallet + SOL budget (AgentWallet, KeyStore)
 *   pumpfun/  PumpPortal local-transaction create / buy / sell / collectCreatorFee
 *   discovery/ pump.fun name/ticker/logo copycat search (pHash)
 *   anomalies/ Helius webhooks + RPC polling detectors, milestone watcher
 *   qsd/      declared boundary to qsd-market (NotImplemented until linked)
 */

export { createSolanaClient } from "./client";
export type { CreateSolanaClientOptions, SolanaClientHandle } from "./client";
export {
  createConnection,
  DEFAULT_DEVNET_RPC,
  DEFAULT_MAINNET_RPC,
  explorerTxUrl,
  MAINNET_FLAG,
  MainnetRefused,
  resolveCluster,
  rpcUrlFor,
} from "./cluster";
export type { Cluster, Rpc } from "./cluster";
export type { Env, FetchLike } from "./env";

export * from "./wallet/index";
export * from "./quantum/index";
export * from "./pumpfun/index";
export * from "./discovery/index";
export * from "./anomalies/index";
export { loadQsd, QSD_NOT_LINKED, QSD_PACKAGES, qsdLaunch, registerWithQsd } from "./qsd/index";
export type { QsdContext, QsdModules, QsdPackageName } from "./qsd/index";

export type { SolanaClient, QuantumClient, QsdLaunchHandlers, QsdLaunchResult } from "@quantagent/core/types/clients";
