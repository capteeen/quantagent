/**
 * pump.fun operations through PumpPortal, signed by the agent wallet.
 *
 * Devnet: PumpPortal's FAQ states it serves mainnet only, and pump.fun has no
 * official devnet program deployment that we could verify. On devnet this
 * module therefore throws NotImplemented unless PUMPPORTAL_URL points at a
 * devnet-capable equivalent (a self-hosted transaction builder against a
 * devnet fork of the pump program). Wallets, balances, discovery and the
 * watchers all work on devnet regardless.
 */

import { Keypair } from "@solana/web3.js";
import { NotImplemented } from "@quantagent/core/types";
import type { Identity } from "@quantagent/core/types";
import type { Cluster, Rpc } from "../cluster";
import { envOf, fetchOf, type Env, type FetchLike } from "../env";
import type { AgentWallet } from "../wallet/agentWallet";
import {
  buyBody,
  collectCreatorFeeBody,
  createBody,
  DEFAULT_SLIPPAGE_BPS,
  metadataUploaderFromEnv,
  PUMPPORTAL_LOCAL_FEE_RATE,
  PUMPPORTAL_TRADE_LOCAL_URL,
  pumpPortalConfigFromEnv,
  requestTradeLocal,
  sellBody,
  type MetadataUploader,
  type PumpPortalConfig,
} from "./pumpportal";

/** Rough on-chain cost of a pump.fun create (mint rent + bonding-curve accounts + fees). Reserved against the budget, reconciled after confirm. */
export const CREATE_OVERHEAD_SOL = 0.03;
/** Network fee headroom reserved per trade beyond amount + priority fee. */
export const TX_FEE_HEADROOM_SOL = 0.0001;

export interface PumpFunLauncherOptions {
  wallet: AgentWallet;
  rpc: Rpc;
  cluster: Cluster;
  env?: Env;
  fetch?: FetchLike;
  uploader?: MetadataUploader;
  portal?: PumpPortalConfig;
  /** Override how the logo bytes are fetched (tests). */
  fetchLogo?: (url: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
}

export function estimateBuyCostSol(sol: number, priorityFeeSol: number): number {
  return sol * (1 + PUMPPORTAL_LOCAL_FEE_RATE) + priorityFeeSol + TX_FEE_HEADROOM_SOL;
}

export function estimateCreateCostSol(devBuySol: number, priorityFeeSol: number): number {
  return estimateBuyCostSol(devBuySol, priorityFeeSol) + CREATE_OVERHEAD_SOL;
}

export class PumpFunLauncher {
  private readonly env: Env;
  private readonly fetch: FetchLike;
  private readonly portal: PumpPortalConfig;
  private uploader: MetadataUploader | undefined;

  constructor(private readonly opts: PumpFunLauncherOptions) {
    this.env = envOf(opts.env);
    this.fetch = fetchOf(opts.fetch);
    this.portal = opts.portal ?? pumpPortalConfigFromEnv(this.env, this.fetch);
    this.uploader = opts.uploader;
  }

  /** PumpPortal is mainnet-only; on devnet require an explicit alternative endpoint. */
  assertPortalAvailable(capability: string): void {
    if (this.opts.cluster === "devnet" && this.portal.tradeLocalUrl === PUMPPORTAL_TRADE_LOCAL_URL) {
      throw new NotImplemented(
        capability,
        "PumpPortal serves mainnet only (its FAQ: \"We currently don't provide APIs for devnet or testnet\") and pump.fun has no official devnet deployment",
        ["PUMPPORTAL_URL=<devnet-capable trade-local endpoint>", "or QUANTAGENT_MAINNET=true with cluster \"mainnet-beta\""],
      );
    }
  }

  private async logoBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    if (this.opts.fetchLogo) return this.opts.fetchLogo(url);
    const res = await this.fetch(url);
    if (!res.ok) throw new Error(`could not fetch logo ${url}: HTTP ${res.status}`);
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType };
  }

  async deploy(input: { identity: Identity; logoUrl: string; siteUrl: string; xUrl?: string; devBuySol: number }) {
    this.assertPortalAvailable("pump.fun deploy");
    if (!this.uploader) this.uploader = metadataUploaderFromEnv(this.env, this.fetch);
    const image = await this.logoBytes(input.logoUrl);
    const metaInput: Parameters<MetadataUploader["upload"]>[0] = {
      name: input.identity.name,
      symbol: input.identity.ticker,
      description: input.identity.lore,
      image,
      website: input.siteUrl,
    };
    if (input.xUrl) metaInput.twitter = input.xUrl;
    const { metadataUri } = await this.uploader.upload(metaInput);

    const mint = Keypair.generate();
    const body = createBody({
      publicKey: this.opts.wallet.address,
      mint: mint.publicKey.toBase58(),
      name: input.identity.name,
      symbol: input.identity.ticker,
      metadataUri,
      devBuySol: input.devBuySol,
      slippageBps: DEFAULT_SLIPPAGE_BPS,
      priorityFeeSol: this.portal.priorityFeeSol,
    });
    const tx = await requestTradeLocal(body, this.portal);
    const txSignature = await this.opts.wallet.signAndSend({
      tx,
      worker: "Launcher",
      estimatedCostSol: estimateCreateCostSol(input.devBuySol, this.portal.priorityFeeSol),
      rpc: this.opts.rpc,
      extraSigners: [mint],
    });
    // PumpPortal folds the dev buy into the create transaction: one signature covers both.
    return { coinCa: mint.publicKey.toBase58(), txSignature, devBuySignature: txSignature, metadataUri };
  }

  async buy(input: { coinCa: string; sol: number; slippageBps: number; reason: string }) {
    this.assertPortalAvailable("pump.fun buy");
    const body = buyBody({
      publicKey: this.opts.wallet.address,
      mint: input.coinCa,
      sol: input.sol,
      slippageBps: input.slippageBps,
      priorityFeeSol: this.portal.priorityFeeSol,
      pool: this.portal.pool,
    });
    const tx = await requestTradeLocal(body, this.portal);
    const txSignature = await this.opts.wallet.signAndSend({
      tx,
      worker: "Trader",
      estimatedCostSol: estimateBuyCostSol(input.sol, this.portal.priorityFeeSol),
      rpc: this.opts.rpc,
    });
    return { txSignature };
  }

  async sell(input: { coinCa: string; percent: number; slippageBps: number; reason: string }) {
    this.assertPortalAvailable("pump.fun sell");
    const body = sellBody({
      publicKey: this.opts.wallet.address,
      mint: input.coinCa,
      percent: input.percent,
      slippageBps: input.slippageBps,
      priorityFeeSol: this.portal.priorityFeeSol,
      pool: this.portal.pool,
    });
    const tx = await requestTradeLocal(body, this.portal);
    const txSignature = await this.opts.wallet.signAndSend({
      tx,
      worker: "Trader",
      estimatedCostSol: this.portal.priorityFeeSol + TX_FEE_HEADROOM_SOL,
      rpc: this.opts.rpc,
    });
    return { txSignature };
  }

  /** PumpPortal action "collectCreatorFee" (https://pumpportal.fun/creator-fee). Claims all pump.fun creator fees for the wallet. */
  async claimCreatorFees(input: { coinCa: string }) {
    this.assertPortalAvailable("pump.fun creator fee claim");
    const body = collectCreatorFeeBody({ publicKey: this.opts.wallet.address, priorityFeeSol: this.portal.priorityFeeSol, mint: input.coinCa });
    const tx = await requestTradeLocal(body, this.portal);
    const before = await this.opts.rpc.getBalance(this.opts.wallet.publicKey, "confirmed");
    const txSignature = await this.opts.wallet.signAndSend({
      tx,
      worker: "Launcher",
      estimatedCostSol: this.portal.priorityFeeSol + TX_FEE_HEADROOM_SOL,
      rpc: this.opts.rpc,
    });
    const after = await this.opts.rpc.getBalance(this.opts.wallet.publicKey, "confirmed");
    return { txSignature, sol: Math.max(0, after - before) / 1_000_000_000 };
  }
}
