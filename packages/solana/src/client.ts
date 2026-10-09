/**
 * createSolanaClient: the SolanaClient from @quantagent/core/types/clients,
 * scoped to one launch's agent wallet.
 */

import type { SolanaClient } from "@quantagent/core/types/clients";
import { createHeliusWebhookHandler, heliusWebhookConfigFromEnv, WebhookHub, type HeliusWebhookConfig } from "./anomalies/helius";
import { watchAnomalies } from "./anomalies/watch";
import { watchMilestones, type HolderCounter } from "./anomalies/milestones";
import { createConnection, resolveCluster, type Cluster, type Rpc } from "./cluster";
import { CopycatFinder, type DiscoveryOptions } from "./discovery/copycats";
import { pumpFunApiConfigFromEnv, type PumpFunApiConfig } from "./discovery/pumpfunApi";
import { envOf, type Env, type FetchLike } from "./env";
import { PumpFunLauncher, type PumpFunLauncherOptions } from "./pumpfun/launcher";
import { qsdLaunch, registerWithQsd } from "./qsd/index";
import { AgentWallet } from "./wallet/agentWallet";
import { MemoryKeyStore, type KeyStore } from "./wallet/keystore";

export interface CreateSolanaClientOptions {
  launchId: string;
  /** devnet unless "mainnet-beta" is passed AND QUANTAGENT_MAINNET=true. */
  cluster?: Cluster;
  /** Total SOL the agent wallet may spend over the launch's life. */
  budgetSol: number;
  /** Postgres in production (PgKeyStore); MemoryKeyStore by default for tests only. */
  keyStore?: KeyStore;
  env?: Env;
  fetch?: FetchLike;
  rpc?: Rpc;
  /** Shared across launches so one HTTP route serves every Helius webhook. */
  hub?: WebhookHub;
  helius?: HeliusWebhookConfig | null;
  holderCounter?: HolderCounter;
  discovery?: Partial<DiscoveryOptions>;
  launcher?: Partial<Pick<PumpFunLauncherOptions, "uploader" | "portal" | "fetchLogo">>;
  qsdImporter?: (name: string) => Promise<unknown>;
  onError?: (err: Error) => void;
}

export interface SolanaClientHandle extends SolanaClient {
  readonly wallet: AgentWallet;
  readonly rpc: Rpc;
  readonly hub: WebhookHub;
  /** Mount on POST <HELIUS_WEBHOOK_URL>; null when Helius webhooks are not configured. */
  readonly webhookHandler: ReturnType<typeof createHeliusWebhookHandler> | null;
}

export async function createSolanaClient(opts: CreateSolanaClientOptions): Promise<SolanaClientHandle> {
  const env = envOf(opts.env);
  const cluster = resolveCluster(opts.cluster, env);
  const rpc: Rpc = opts.rpc ?? createConnection(cluster, env);
  const keyStore = opts.keyStore ?? new MemoryKeyStore();
  const wallet = await AgentWallet.open({ launchId: opts.launchId, cluster, budgetSol: opts.budgetSol, keyStore, env });
  const api: PumpFunApiConfig = pumpFunApiConfigFromEnv(env, opts.fetch);
  const hub = opts.hub ?? new WebhookHub();
  const helius = opts.helius === undefined ? heliusWebhookConfigFromEnv(env, opts.fetch) : opts.helius;
  const webhookHandler = helius ? createHeliusWebhookHandler({ secret: helius.secret, hub }) : null;

  const launcherOpts: PumpFunLauncherOptions = { wallet, rpc, cluster, env, ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.launcher ?? {}) };
  const launcher = new PumpFunLauncher(launcherOpts);
  const discoveryOpts: DiscoveryOptions = { env, api, ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.discovery ?? {}) };
  const copycats = new CopycatFinder(discoveryOpts);
  const qsdCtx = { cluster, ...(opts.qsdImporter ? { importer: opts.qsdImporter } : {}) };
  const onError = opts.onError ?? (() => {});

  return {
    cluster,
    agentWallet: wallet.address,
    wallet,
    rpc,
    hub,
    webhookHandler,

    qsdLaunch: (input, handlers) => qsdLaunch(input, handlers, qsdCtx),
    registerWithQsd: (input) => registerWithQsd(input, qsdCtx),

    async deployPumpFun(input) {
      const r = await launcher.deploy(input);
      return { coinCa: r.coinCa, txSignature: r.txSignature, devBuySignature: r.devBuySignature };
    },
    buy: (input) => launcher.buy(input),
    sell: (input) => launcher.sell(input),
    claimCreatorFees: (input) => launcher.claimCreatorFees(input),

    isNameTaken: (input) => copycats.isNameTaken(input),
    findNameMatches: (input) => copycats.findNameMatches(input),
    findLogoMatches: (input) => copycats.findLogoMatches(input),

    watchAnomalies: (input) =>
      watchAnomalies(input, { rpc, cluster, env, api, hub, helius, wallets: [wallet.address], onError, ...(opts.fetch ? { fetch: opts.fetch } : {}) }),
    watchMilestones: (input) =>
      watchMilestones(input, {
        rpc,
        cluster,
        env,
        api,
        onError,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.holderCounter ? { holderCounter: opts.holderCounter } : {}),
      }),

    balanceSol: () => wallet.balanceSol(rpc),
  };
}
