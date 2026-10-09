/**
 * Transaction shape shared by the Helius webhook path and the RPC polling
 * fallback so the detectors are source-agnostic.
 */

export interface NormalizedTokenTransfer {
  /** Owner wallet the tokens left ("" when unknown, e.g. minted). */
  from: string;
  /** Owner wallet the tokens reached ("" when unknown, e.g. burned). */
  to: string;
  mint: string;
  /** UI amount (decimals applied). */
  amount: number;
}

export interface NormalizedNativeTransfer {
  from: string;
  to: string;
  lamports: number;
}

export interface NormalizedTx {
  signature: string;
  slot: number;
  /** Unix seconds, null when the node has no block time. */
  blockTime: number | null;
  feePayer: string;
  tokenTransfers: NormalizedTokenTransfer[];
  nativeTransfers: NormalizedNativeTransfer[];
  /** Helius type / source when known (e.g. "CREATE", "PUMP_FUN"). */
  type?: string;
  source?: string;
}
