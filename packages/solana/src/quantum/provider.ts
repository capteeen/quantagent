/**
 * Pluggable QRNG provider boundary. A provider returns raw quantum entropy
 * plus everything needed to attest where it came from. There is deliberately
 * no local-entropy provider in this package: a provider whose name suggests
 * pseudo-randomness is refused at registration, and the draw never falls back.
 */

import { isProduction, type Env } from "../env";

export interface EntropyResult {
  /** Raw bytes from the provider. */
  entropy: Uint8Array;
  requestUrl: string;
  requestedAt: string;
  receivedAt: string;
  /** Provider response verbatim (JSON-serialisable) for the attestation. */
  rawResponse: unknown;
}

export interface QrngProvider {
  /** Short provider id, e.g. "anu". Goes into QuantumProof.provider. */
  readonly name: string;
  /** Fetch `bytes` bytes of quantum entropy. Throws QrngUnreachable on failure. */
  fetchEntropy(input: { bytes: number; context: string }): Promise<EntropyResult>;
}

export class QrngUnreachable extends Error {
  override readonly name = "QrngUnreachable";
  constructor(
    readonly provider: string,
    because: string,
    options?: { cause?: unknown },
  ) {
    super(`QRNG provider "${provider}" unreachable: ${because}`, options);
  }
}

/** Provider names that would mean a non-quantum source. Refused everywhere. */
export const FORBIDDEN_PROVIDER_NAME = /(pseudo|mock|fake|prng|math\.?random|dummy|stub|seeded?)/i;

/**
 * Refuse any provider that advertises itself as non-quantum. Throws in every
 * environment; the production check is spelled out so the guarantee holds
 * even if someone loosens the non-production rule later.
 */
export function assertProviderAllowed(name: string, env: Env): void {
  if (!name || name.trim() === "") throw new Error("QRNG provider needs a name");
  if (FORBIDDEN_PROVIDER_NAME.test(name)) {
    const where = isProduction(env) ? "production" : env.NODE_ENV ?? "development";
    throw new Error(
      `QRNG provider "${name}" is refused (${where}): quantagent never selects candidates with pseudo-random entropy`,
    );
  }
}
