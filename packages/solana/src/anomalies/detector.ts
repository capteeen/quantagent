/**
 * Pure anomaly detectors (no I/O):
 *   bundled-launch     ≥ minBundleBuys distinct wallets received the coin in the
 *                      create slot (± bundleSlotWindow). Classic sniper bundle.
 *   dev-wallet-anomaly the creator moved coins out (sell or transfer) within
 *                      devSellWindowMs of creation.
 */

import type { BundleFlag } from "@quantagent/core/types";
import type { NormalizedTx } from "./types";

export interface DetectorConfig {
  coinCa: string;
  creator: string | null;
  /** Bonding curve / pool wallet so its receipts are not counted as buys. */
  bondingCurve?: string | null;
  createSlot: number | null;
  /** Unix ms. */
  createdAtMs: number | null;
  minBundleBuys: number;
  bundleSlotWindow: number;
  devSellWindowMs: number;
}

export const DEFAULT_MIN_BUNDLE_BUYS = 3;
export const DEFAULT_BUNDLE_SLOT_WINDOW = 0;
export const DEFAULT_DEV_SELL_WINDOW_MS = 30 * 60 * 1000;

export class AnomalyDetector {
  readonly cfg: DetectorConfig;
  private readonly seen = new Set<string>();
  private readonly createWindowBuyers = new Map<string, Set<string>>();
  private bundledFlagged = false;
  private readonly devFlagged = new Set<string>();

  constructor(cfg: DetectorConfig) {
    this.cfg = { ...cfg };
  }

  get creator(): string | null {
    return this.cfg.creator;
  }

  get createSlot(): number | null {
    return this.cfg.createSlot;
  }

  private learnCreate(tx: NormalizedTx): void {
    const isCreate = tx.type === "CREATE" || (this.cfg.createSlot === null && tx.tokenTransfers.some((t) => t.mint === this.cfg.coinCa && t.from === ""));
    if (!isCreate) return;
    if (this.cfg.createSlot === null || tx.slot < this.cfg.createSlot) {
      this.cfg.createSlot = tx.slot;
      if (tx.blockTime !== null) this.cfg.createdAtMs = tx.blockTime * 1000;
      if (!this.cfg.creator) this.cfg.creator = tx.feePayer;
    }
  }

  ingest(txs: readonly NormalizedTx[]): BundleFlag[] {
    const flags: BundleFlag[] = [];
    const ordered = [...txs].sort((a, b) => a.slot - b.slot);
    for (const tx of ordered) {
      if (this.seen.has(tx.signature)) continue;
      this.seen.add(tx.signature);
      this.learnCreate(tx);
      const creator = this.cfg.creator;
      const curve = this.cfg.bondingCurve ?? null;
      const seenAt = tx.blockTime !== null ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString();

      for (const t of tx.tokenTransfers) {
        if (t.mint !== this.cfg.coinCa || !(t.amount > 0)) continue;

        // bundled launch: buyers in the create window
        if (this.cfg.createSlot !== null && tx.slot >= this.cfg.createSlot && tx.slot <= this.cfg.createSlot + this.cfg.bundleSlotWindow) {
          const buyer = t.to;
          if (buyer && buyer !== creator && buyer !== curve) {
            const sigs = this.createWindowBuyers.get(buyer) ?? new Set<string>();
            sigs.add(tx.signature);
            this.createWindowBuyers.set(buyer, sigs);
          }
        }

        // dev wallet anomaly: creator moving coins out early
        if (creator && t.from === creator && !this.devFlagged.has(tx.signature)) {
          const createdAt = this.cfg.createdAtMs;
          const at = tx.blockTime !== null ? tx.blockTime * 1000 : Date.now();
          if (createdAt === null || at - createdAt <= this.cfg.devSellWindowMs) {
            this.devFlagged.add(tx.signature);
            const mins = createdAt === null ? "an unknown number of" : (Math.max(0, at - createdAt) / 60_000).toFixed(1);
            flags.push({
              kind: "dev-wallet-anomaly",
              evidence: `creator ${creator} moved ${t.amount} ${this.cfg.coinCa.slice(0, 6)}… to ${t.to || "unknown"} ${mins} min after launch`,
              txSignatures: [tx.signature],
              seenAt,
            });
          }
        }
      }

      if (!this.bundledFlagged && this.createWindowBuyers.size >= this.cfg.minBundleBuys) {
        this.bundledFlagged = true;
        const sigs = Array.from(new Set([...this.createWindowBuyers.values()].flatMap((s) => [...s])));
        flags.push({
          kind: "bundled-launch",
          evidence: `${this.createWindowBuyers.size} distinct wallets bought in the create slot ${this.cfg.createSlot}${this.cfg.bundleSlotWindow ? ` (+${this.cfg.bundleSlotWindow})` : ""}: ${[...this.createWindowBuyers.keys()].slice(0, 8).join(", ")}`,
          txSignatures: sigs,
          seenAt,
        });
      }
    }
    return flags;
  }
}
