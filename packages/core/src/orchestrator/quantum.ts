import type { QuantumProof } from "../../types/index";
import type { QuantumClient } from "../../types/clients";

/**
 * Provider names that denote non-quantum randomness. Registering one of these,
 * or accepting a proof from one, is refused in production. There is no fallback
 * path in this package: if the draw fails, the user picks and the UI says why.
 */
export const FORBIDDEN_PROVIDER_PATTERN = /(pseudo|prng|mock|fake|math(\.|-)?random|random|dummy|stub|seeded?)/i;

export function isProduction(env: { NODE_ENV?: string | undefined } = process.env): boolean {
  return env.NODE_ENV === "production";
}

export class ForbiddenQuantumProvider extends Error {
  override readonly name = "ForbiddenQuantumProvider";
  constructor(public readonly provider: string) {
    super(`quantum provider "${provider}" is pseudorandom and cannot be used in production`);
  }
}

const providers = new Map<string, QuantumClient>();

/**
 * Register a named QuantumClient. In production, any provider whose name marks it
 * as pseudorandom throws ForbiddenQuantumProvider and is never registered.
 */
export function registerQuantumProvider(
  name: string,
  client: QuantumClient,
  env: { NODE_ENV?: string | undefined } = process.env,
): void {
  if (!name) throw new Error("quantum provider needs a name");
  if (isProduction(env) && FORBIDDEN_PROVIDER_PATTERN.test(name)) throw new ForbiddenQuantumProvider(name);
  providers.set(name, client);
}

export function getQuantumProvider(name: string): QuantumClient | undefined {
  return providers.get(name);
}

export function listQuantumProviders(): string[] {
  return [...providers.keys()];
}

export function unregisterQuantumProvider(name: string): boolean {
  return providers.delete(name);
}

/**
 * Validates a proof returned by a draw. Throws when the index is out of range or,
 * in production, when the provider is a forbidden (pseudorandom) one.
 */
export function assertProofUsable(
  proof: QuantumProof,
  candidateCount: number,
  env: { NODE_ENV?: string | undefined } = process.env,
): void {
  if (isProduction(env) && FORBIDDEN_PROVIDER_PATTERN.test(proof.provider)) throw new ForbiddenQuantumProvider(proof.provider);
  if (!Number.isInteger(proof.selectedIndex) || proof.selectedIndex < 0 || proof.selectedIndex >= candidateCount) {
    throw new Error(`quantum proof selectedIndex ${proof.selectedIndex} out of range for ${candidateCount} candidates`);
  }
  if (!proof.entropyHex || !proof.attestation || !proof.drawHash) {
    throw new Error("quantum proof is missing entropyHex, attestation or drawHash");
  }
}
