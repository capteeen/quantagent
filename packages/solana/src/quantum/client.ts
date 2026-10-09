/**
 * QuantumClient: one verifiable draw over n candidates.
 *
 *   entropyHex    = hex of the provider's bytes (32 bytes requested)
 *   drawHash      = sha256(candidateIds.join(",") + ":" + entropyHex) as hex
 *   selectedIndex = BigInt("0x" + first 8 bytes of entropy) mod n
 *   attestation   = JSON { requestUrl, requestedAt, receivedAt, rawResponse }
 *
 * Anyone holding the proof can recompute drawHash and selectedIndex.
 * If the provider is unreachable the draw THROWS. There is no fallback.
 */

import { createHash } from "node:crypto";
import type { QuantumClient } from "@quantagent/core/types/clients";
import type { QuantumProof } from "@quantagent/core/types";
import { envOf, type Env, type FetchLike } from "../env";
import { anuProviderFromEnv } from "./anu";
import { assertProviderAllowed, type QrngProvider } from "./provider";

export const DRAW_ENTROPY_BYTES = 32;
const INDEX_BYTES = 8;

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function drawHashOf(candidateIds: readonly string[], entropyHex: string): string {
  return createHash("sha256").update(`${candidateIds.join(",")}:${entropyHex}`).digest("hex");
}

/** Index from the first 8 bytes of entropy (big-endian) modulo n. */
export function selectedIndexOf(entropyHex: string, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new Error(`need at least one candidate, got ${n}`);
  const head = entropyHex.slice(0, INDEX_BYTES * 2);
  if (head.length !== INDEX_BYTES * 2) throw new Error(`entropy too short: ${entropyHex.length / 2} bytes`);
  return Number(BigInt(`0x${head}`) % BigInt(n));
}

/** Recompute the proof's derived fields; true when they match. */
export function verifyProof(proof: QuantumProof, candidateIds: readonly string[]): boolean {
  if (!/^[0-9a-f]+$/i.test(proof.entropyHex) || proof.entropyHex.length < INDEX_BYTES * 2) return false;
  return (
    proof.drawHash === drawHashOf(candidateIds, proof.entropyHex) &&
    proof.selectedIndex === selectedIndexOf(proof.entropyHex, candidateIds.length)
  );
}

export interface QuantumClientOptions {
  /** Explicit provider instance. Default: ANU from ANU_QRNG_API_KEY, resolved lazily at draw time. */
  provider?: QrngProvider;
  env?: Env;
  fetch?: FetchLike;
}

export function createQuantumClient(opts: QuantumClientOptions = {}): QuantumClient {
  const env = envOf(opts.env);
  if (opts.provider) assertProviderAllowed(opts.provider.name, env);
  let provider = opts.provider;

  return {
    async draw(input) {
      const ids = input.candidateIds;
      if (!Array.isArray(ids) || ids.length === 0) throw new Error("draw needs at least one candidate id");
      if (new Set(ids).size !== ids.length) throw new Error("candidate ids must be unique");
      if (!provider) provider = anuProviderFromEnv(env, opts.fetch);
      assertProviderAllowed(provider.name, env);

      const r = await provider.fetchEntropy({ bytes: DRAW_ENTROPY_BYTES, context: input.context });
      if (r.entropy.length < INDEX_BYTES) throw new Error(`provider returned ${r.entropy.length} bytes, need ${INDEX_BYTES}`);
      const entropyHex = toHex(r.entropy);
      const proof: QuantumProof = {
        provider: provider.name,
        entropyHex,
        attestation: JSON.stringify({
          requestUrl: r.requestUrl,
          requestedAt: r.requestedAt,
          receivedAt: r.receivedAt,
          rawResponse: r.rawResponse,
        }),
        drawHash: drawHashOf(ids, entropyHex),
        requestedAt: r.requestedAt,
        receivedAt: r.receivedAt,
        selectedIndex: selectedIndexOf(entropyHex, ids.length),
      };
      return proof;
    },
  };
}
