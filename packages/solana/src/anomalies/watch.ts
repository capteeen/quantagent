/**
 * watchAnomalies: Helius webhook when HELIUS_API_KEY + HELIUS_WEBHOOK_URL +
 * HELIUS_WEBHOOK_SECRET are set (the app mounts createHeliusWebhookHandler
 * and shares the WebhookHub), otherwise RPC polling every ANOMALY_POLL_MS.
 */

import { PublicKey } from "@solana/web3.js";
import type { BundleFlag } from "@quantagent/core/types";
import type { Cluster, Rpc } from "../cluster";
import { envNumber, envOf, type Env, type FetchLike } from "../env";
import { getCoin, pumpFunApiConfigFromEnv, type PumpFunApiConfig } from "../discovery/pumpfunApi";
import { AnomalyDetector, DEFAULT_BUNDLE_SLOT_WINDOW, DEFAULT_DEV_SELL_WINDOW_MS, DEFAULT_MIN_BUNDLE_BUYS } from "./detector";
import { createWebhook, deleteWebhook, heliusWebhookConfigFromEnv, type HeliusWebhookConfig, type WebhookHub } from "./helius";
import { fetchNormalized, findCreateSignature } from "./poll";

export interface WatchAnomaliesOptions {
  rpc: Rpc;
  cluster: Cluster;
  env?: Env;
  fetch?: FetchLike;
  api?: PumpFunApiConfig;
  hub?: WebhookHub;
  /** Explicit Helius config; null forces polling. Default: from env. */
  helius?: HeliusWebhookConfig | null;
  /** Extra wallets whose activity belongs to the coin (agent wallet). */
  wallets?: string[];
  pollMs?: number;
  onError?: (err: Error) => void;
  /** Interval factory (tests). */
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}

export const DEFAULT_ANOMALY_POLL_MS = 15_000;

export async function watchAnomalies(
  input: { coinCa: string; onFlag: (flag: BundleFlag) => void },
  opts: WatchAnomaliesOptions,
): Promise<() => void> {
  const env = envOf(opts.env);
  const api = opts.api ?? pumpFunApiConfigFromEnv(env, opts.fetch);
  const onError = opts.onError ?? (() => {});
  const mintPk = new PublicKey(input.coinCa); // validates the address

  let coin = null;
  try {
    coin = await getCoin(input.coinCa, api);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }

  const detector = new AnomalyDetector({
    coinCa: input.coinCa,
    creator: coin?.creator ?? null,
    bondingCurve: coin?.bonding_curve ?? null,
    createSlot: null,
    createdAtMs: coin?.created_timestamp ?? null,
    minBundleBuys: envNumber(env, "BUNDLE_MIN_BUYS", DEFAULT_MIN_BUNDLE_BUYS),
    bundleSlotWindow: envNumber(env, "BUNDLE_SLOT_WINDOW", DEFAULT_BUNDLE_SLOT_WINDOW),
    devSellWindowMs: envNumber(env, "DEV_SELL_WINDOW_MIN", DEFAULT_DEV_SELL_WINDOW_MS / 60_000) * 60_000,
  });

  // Establish the create slot from chain history (needed for bundle detection on both paths).
  let newestSeen: string | undefined;
  try {
    const create = await findCreateSignature(opts.rpc, input.coinCa);
    if (create) {
      const txs = await fetchNormalized(opts.rpc, input.coinCa, [create.signature]);
      const createTx = txs[0];
      if (createTx) {
        createTx.type = "CREATE";
        detector.ingest([createTx]).forEach(input.onFlag);
      } else {
        detector.cfg.createSlot = create.slot;
        if (create.blockTime !== null) detector.cfg.createdAtMs = create.blockTime * 1000;
      }
    }
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }

  const emit = (txs: Parameters<AnomalyDetector["ingest"]>[0]) => {
    for (const f of detector.ingest(txs)) input.onFlag(f);
  };

  const helius = opts.helius === undefined ? heliusWebhookConfigFromEnv(env, opts.fetch) : opts.helius;
  if (helius && opts.hub) {
    const addresses = Array.from(new Set([input.coinCa, ...(detector.creator ? [detector.creator] : []), ...(opts.wallets ?? [])]));
    const { webhookID } = await createWebhook({ addresses, cluster: opts.cluster }, helius);
    const unsub = opts.hub.subscribe(input.coinCa, emit, addresses);
    return () => {
      unsub();
      void deleteWebhook(webhookID, helius).catch((err: unknown) => onError(err instanceof Error ? err : new Error(String(err))));
    };
  }

  // Polling fallback.
  const pollMs = opts.pollMs ?? envNumber(env, "ANOMALY_POLL_MS", DEFAULT_ANOMALY_POLL_MS);
  const setI = opts.setInterval ?? globalThis.setInterval;
  const clearI = opts.clearInterval ?? globalThis.clearInterval;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const sigOpts: { limit: number; until?: string } = { limit: 1000 };
      if (newestSeen) sigOpts.until = newestSeen;
      const sigs = await opts.rpc.getSignaturesForAddress(mintPk, sigOpts, "confirmed");
      if (sigs.length > 0) {
        newestSeen = sigs[0]!.signature;
        const txs = await fetchNormalized(opts.rpc, input.coinCa, sigs.filter((s) => !s.err).map((s) => s.signature));
        emit(txs);
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      busy = false;
    }
  };
  await tick();
  const handle = setI(() => void tick(), pollMs);
  return () => clearI(handle);
}
