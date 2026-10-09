/**
 * PumpPortal Local Transaction API (https://pumpportal.fun/local-trading-api/trading-api).
 *
 * Verified against the live docs on 2026-10-09:
 *   POST https://pumpportal.fun/api/trade-local  → serialized VersionedTransaction bytes
 *   body: { publicKey, action: "create"|"buy"|"sell"|"collectCreatorFee", mint,
 *           tokenMetadata: { name, symbol, uri } (create only),
 *           denominatedInSol: "true"|"false" (strings), amount, slippage (percent),
 *           priorityFee (SOL), pool: "pump" | "pump-amm" | "raydium" | "auto" | ... }
 *   sell amount may be a percentage string such as "100%".
 *   Local trades carry a 0.5% PumpPortal fee (https://pumpportal.fun/fees).
 *   FAQ: "We currently don't provide APIs for devnet or testnet."
 *   Creation page: "Pump.fun no longer allows direct metadata uploads to their API";
 *   its examples upload image + metadata JSON to Pinata and pass the resulting
 *   ipfs:// / gateway URI as tokenMetadata.uri. The legacy pump.fun/api/ipfs
 *   form endpoint is kept here as an opt-in because older examples still use it.
 */

import { VersionedTransaction } from "@solana/web3.js";
import { NotImplemented } from "@quantagent/core/types";
import { envNumber, envOf, fetchOf, type Env, type FetchLike } from "../env";

export const PUMPPORTAL_TRADE_LOCAL_URL = "https://pumpportal.fun/api/trade-local";
export const PUMPFUN_IPFS_URL = "https://pump.fun/api/ipfs";
export const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
export const DEFAULT_PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";
export const DEFAULT_PRIORITY_FEE_SOL = 0.0005;
export const DEFAULT_SLIPPAGE_BPS = 1000; // 10% — PumpPortal's own example value
export const PUMPPORTAL_LOCAL_FEE_RATE = 0.005; // 0.5%
export type PumpPool = "pump" | "pump-amm" | "raydium" | "raydium-cpmm" | "launchlab" | "bonk" | "auto";

export interface PumpPortalConfig {
  tradeLocalUrl: string;
  priorityFeeSol: number;
  pool: PumpPool;
  fetch: FetchLike;
}

export function pumpPortalConfigFromEnv(env?: Env, fetch?: FetchLike): PumpPortalConfig {
  const e = envOf(env);
  const pool = (e.PUMPPORTAL_POOL ?? "pump") as PumpPool;
  return {
    tradeLocalUrl: e.PUMPPORTAL_URL?.trim() || PUMPPORTAL_TRADE_LOCAL_URL,
    priorityFeeSol: envNumber(e, "PUMPPORTAL_PRIORITY_FEE_SOL", DEFAULT_PRIORITY_FEE_SOL),
    pool,
    fetch: fetchOf(fetch),
  };
}

export function bpsToPercent(bps: number): number {
  if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) throw new Error(`slippageBps out of range: ${bps}`);
  return bps / 100;
}

/* ───────── request bodies (pure, tested) ───────── */

export interface CreateBody {
  publicKey: string;
  action: "create";
  tokenMetadata: { name: string; symbol: string; uri: string };
  mint: string;
  denominatedInSol: "true";
  amount: number;
  slippage: number;
  priorityFee: number;
  pool: "pump";
}

export function createBody(input: {
  publicKey: string;
  mint: string;
  name: string;
  symbol: string;
  metadataUri: string;
  devBuySol: number;
  slippageBps: number;
  priorityFeeSol: number;
}): CreateBody {
  if (!Number.isFinite(input.devBuySol) || input.devBuySol < 0) throw new Error(`invalid devBuySol ${input.devBuySol}`);
  return {
    publicKey: input.publicKey,
    action: "create",
    tokenMetadata: { name: input.name, symbol: input.symbol, uri: input.metadataUri },
    mint: input.mint,
    denominatedInSol: "true",
    amount: input.devBuySol,
    slippage: bpsToPercent(input.slippageBps),
    priorityFee: input.priorityFeeSol,
    pool: "pump",
  };
}

export interface TradeBody {
  publicKey: string;
  action: "buy" | "sell";
  mint: string;
  denominatedInSol: "true" | "false";
  amount: number | string;
  slippage: number;
  priorityFee: number;
  pool: PumpPool;
}

export function buyBody(input: {
  publicKey: string;
  mint: string;
  sol: number;
  slippageBps: number;
  priorityFeeSol: number;
  pool: PumpPool;
}): TradeBody {
  if (!Number.isFinite(input.sol) || input.sol <= 0) throw new Error(`buy amount must be > 0 SOL, got ${input.sol}`);
  return {
    publicKey: input.publicKey,
    action: "buy",
    mint: input.mint,
    denominatedInSol: "true",
    amount: input.sol,
    slippage: bpsToPercent(input.slippageBps),
    priorityFee: input.priorityFeeSol,
    pool: input.pool,
  };
}

export function sellBody(input: {
  publicKey: string;
  mint: string;
  percent: number;
  slippageBps: number;
  priorityFeeSol: number;
  pool: PumpPool;
}): TradeBody {
  if (!Number.isFinite(input.percent) || input.percent <= 0 || input.percent > 100) {
    throw new Error(`sell percent must be in (0, 100], got ${input.percent}`);
  }
  return {
    publicKey: input.publicKey,
    action: "sell",
    mint: input.mint,
    denominatedInSol: "false",
    amount: `${input.percent}%`,
    slippage: bpsToPercent(input.slippageBps),
    priorityFee: input.priorityFeeSol,
    pool: input.pool,
  };
}

export interface CollectCreatorFeeBody {
  publicKey: string;
  action: "collectCreatorFee";
  priorityFee: number;
  /** Docs: pump.fun claims all creator fees at once, so mint is informational for pool "pump". */
  mint?: string;
  pool?: "pump" | "meteora-dbc";
}

export function collectCreatorFeeBody(input: { publicKey: string; priorityFeeSol: number; mint?: string }): CollectCreatorFeeBody {
  const body: CollectCreatorFeeBody = { publicKey: input.publicKey, action: "collectCreatorFee", priorityFee: input.priorityFeeSol, pool: "pump" };
  if (input.mint) body.mint = input.mint;
  return body;
}

/* ───────── transport ───────── */

export class PumpPortalError extends Error {
  override readonly name = "PumpPortalError";
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`PumpPortal ${status}: ${body.slice(0, 300)}`);
  }
}

/** POST the body and deserialize the returned transaction. */
export async function requestTradeLocal(body: CreateBody | TradeBody | CollectCreatorFeeBody, cfg: PumpPortalConfig): Promise<VersionedTransaction> {
  const res = await cfg.fetch(cfg.tradeLocalUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/octet-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new PumpPortalError(res.status, await res.text());
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) throw new PumpPortalError(res.status, "empty transaction body");
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch (err) {
    const text = Buffer.from(bytes).toString("utf8").slice(0, 300);
    throw new PumpPortalError(res.status, `could not deserialize transaction: ${err instanceof Error ? err.message : String(err)} — ${text}`);
  }
}

/* ───────── metadata upload ───────── */

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

export interface TokenMetadataInput {
  name: string;
  symbol: string;
  description: string;
  /** Logo bytes + mime type. */
  image: { bytes: Uint8Array; contentType: string; fileName?: string };
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface MetadataUploader {
  readonly name: string;
  upload(input: TokenMetadataInput): Promise<{ metadataUri: string; imageUri?: string }>;
}

/** Pinata (what PumpPortal's current token-creation examples use). Needs PINATA_JWT. */
export class PinataUploader implements MetadataUploader {
  readonly name = "pinata";
  constructor(
    private readonly jwt: string,
    private readonly fetch: FetchLike,
    private readonly gateway: string = DEFAULT_PINATA_GATEWAY,
    private readonly uploadUrl: string = PINATA_UPLOAD_URL,
  ) {}

  private async putFile(blob: Blob, fileName: string): Promise<string> {
    const form = new FormData();
    form.append("file", blob, fileName);
    form.append("network", "public");
    const res = await this.fetch(this.uploadUrl, { method: "POST", headers: { authorization: `Bearer ${this.jwt}` }, body: form });
    const text = await res.text();
    if (!res.ok) throw new Error(`Pinata upload failed ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text) as { data?: { cid?: string }; IpfsHash?: string };
    const cid = json.data?.cid ?? json.IpfsHash;
    if (!cid) throw new Error(`Pinata response had no cid: ${text.slice(0, 300)}`);
    return cid;
  }

  async upload(input: TokenMetadataInput) {
    const imageCid = await this.putFile(new Blob([toArrayBuffer(input.image.bytes)], { type: input.image.contentType }), input.image.fileName ?? "logo.png");
    const imageUri = `${this.gateway}/${imageCid}`;
    const meta: Record<string, string> = { name: input.name, symbol: input.symbol, description: input.description, image: imageUri };
    if (input.twitter) meta.twitter = input.twitter;
    if (input.telegram) meta.telegram = input.telegram;
    if (input.website) meta.website = input.website;
    const metaCid = await this.putFile(new Blob([JSON.stringify(meta)], { type: "application/json" }), "metadata.json");
    return { metadataUri: `${this.gateway}/${metaCid}`, imageUri };
  }
}

/** Legacy pump.fun multipart endpoint. PumpPortal's docs say it is no longer supported; opt-in via PUMPFUN_IPFS_URL. */
export class PumpFunIpfsUploader implements MetadataUploader {
  readonly name = "pump.fun-ipfs";
  constructor(
    private readonly fetch: FetchLike,
    private readonly url: string = PUMPFUN_IPFS_URL,
  ) {}

  async upload(input: TokenMetadataInput) {
    const form = new FormData();
    form.append("file", new Blob([toArrayBuffer(input.image.bytes)], { type: input.image.contentType }), input.image.fileName ?? "logo.png");
    form.append("name", input.name);
    form.append("symbol", input.symbol);
    form.append("description", input.description);
    form.append("twitter", input.twitter ?? "");
    form.append("telegram", input.telegram ?? "");
    form.append("website", input.website ?? "");
    form.append("showName", "true");
    const res = await this.fetch(this.url, { method: "POST", body: form });
    const text = await res.text();
    if (!res.ok) throw new Error(`pump.fun ipfs upload failed ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text) as { metadataUri?: string; metadata?: { image?: string } };
    if (!json.metadataUri) throw new Error(`pump.fun ipfs response had no metadataUri: ${text.slice(0, 300)}`);
    const out: { metadataUri: string; imageUri?: string } = { metadataUri: json.metadataUri };
    if (json.metadata?.image) out.imageUri = json.metadata.image;
    return out;
  }
}

export function metadataUploaderFromEnv(env?: Env, fetch?: FetchLike): MetadataUploader {
  const e = envOf(env);
  const f = fetchOf(fetch);
  if (e.PINATA_JWT && e.PINATA_JWT.trim() !== "") {
    return new PinataUploader(e.PINATA_JWT.trim(), f, e.PINATA_GATEWAY?.replace(/\/$/, "") || DEFAULT_PINATA_GATEWAY);
  }
  if (e.PUMPFUN_IPFS_URL && e.PUMPFUN_IPFS_URL.trim() !== "") {
    return new PumpFunIpfsUploader(f, e.PUMPFUN_IPFS_URL.trim());
  }
  throw new NotImplemented(
    "token metadata upload",
    "no metadata host configured: PumpPortal's docs say pump.fun no longer accepts direct metadata uploads, so a Pinata JWT is required (or PUMPFUN_IPFS_URL to opt into the legacy endpoint)",
    ["PINATA_JWT", "PUMPFUN_IPFS_URL"],
  );
}
