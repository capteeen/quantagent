/**
 * RPC polling fallback: turns parsed transactions (getParsedTransactions) into
 * NormalizedTx by diffing pre/post token balances for the mint. Works on any
 * cluster with a plain RPC, no Helius key needed.
 */

import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import type { Rpc } from "../cluster";
import type { NormalizedTokenTransfer, NormalizedTx } from "./types";

export function normalizeParsed(signature: string, tx: ParsedTransactionWithMeta, mint: string): NormalizedTx | null {
  if (!tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys;
  const feePayer = keys[0]?.pubkey.toBase58() ?? "";
  const deltas = new Map<string, number>();
  for (const b of tx.meta.preTokenBalances ?? []) {
    if (b.mint !== mint || !b.owner) continue;
    deltas.set(b.owner, (deltas.get(b.owner) ?? 0) - (b.uiTokenAmount.uiAmount ?? 0));
  }
  for (const b of tx.meta.postTokenBalances ?? []) {
    if (b.mint !== mint || !b.owner) continue;
    deltas.set(b.owner, (deltas.get(b.owner) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
  }
  const tokenTransfers: NormalizedTokenTransfer[] = [];
  let biggestOut = "";
  let biggestOutAmt = 0;
  let biggestIn = "";
  let biggestInAmt = 0;
  for (const [owner, d] of deltas) {
    if (d < -biggestOutAmt) {
      biggestOutAmt = -d;
      biggestOut = owner;
    }
    if (d > biggestInAmt) {
      biggestInAmt = d;
      biggestIn = owner;
    }
  }
  for (const [owner, d] of deltas) {
    if (Math.abs(d) < 1e-9) continue;
    if (d > 0) tokenTransfers.push({ from: biggestOut === owner ? "" : biggestOut, to: owner, mint, amount: d });
    else tokenTransfers.push({ from: owner, to: biggestIn === owner ? "" : biggestIn, mint, amount: -d });
  }
  const nativeTransfers: NormalizedTx["nativeTransfers"] = [];
  const pre = tx.meta.preBalances ?? [];
  const post = tx.meta.postBalances ?? [];
  for (let i = 1; i < keys.length; i++) {
    const d = (post[i] ?? 0) - (pre[i] ?? 0);
    if (d > 0) nativeTransfers.push({ from: feePayer, to: keys[i]!.pubkey.toBase58(), lamports: d });
  }
  return { signature, slot: tx.slot, blockTime: tx.blockTime ?? null, feePayer, tokenTransfers, nativeTransfers };
}

/** Oldest signature that touched the mint — the create tx for a pump.fun coin. */
export async function findCreateSignature(rpc: Rpc, mint: string, maxPages = 10): Promise<{ signature: string; slot: number; blockTime: number | null } | null> {
  const pk = new PublicKey(mint);
  let before: string | undefined;
  let oldest: { signature: string; slot: number; blockTime: number | null } | null = null;
  for (let page = 0; page < maxPages; page++) {
    const opts: { limit: number; before?: string } = { limit: 1000 };
    if (before) opts.before = before;
    const sigs = await rpc.getSignaturesForAddress(pk, opts, "confirmed");
    if (sigs.length === 0) break;
    const last = sigs[sigs.length - 1]!;
    oldest = { signature: last.signature, slot: last.slot, blockTime: last.blockTime ?? null };
    if (sigs.length < 1000) break;
    before = last.signature;
  }
  return oldest;
}

export async function fetchNormalized(rpc: Rpc, mint: string, signatures: string[]): Promise<NormalizedTx[]> {
  const out: NormalizedTx[] = [];
  for (let i = 0; i < signatures.length; i += 100) {
    const chunk = signatures.slice(i, i + 100);
    const txs = await rpc.getParsedTransactions(chunk, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    txs.forEach((tx, j) => {
      if (!tx) return;
      const n = normalizeParsed(chunk[j]!, tx, mint);
      if (n) out.push(n);
    });
  }
  return out;
}
