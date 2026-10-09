/**
 * OAuth 2.0 PKCE helpers (RFC 7636, S256).
 */
import { createHash, randomBytes } from "node:crypto";

export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface Pkce {
  /** 43–128 char high-entropy string. Keep server-side, keyed by `state`. */
  verifier: string;
  /** base64url(sha256(verifier)). Sent in the authorize URL. */
  challenge: string;
  method: "S256";
}

export function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
}

export function createPkce(): Pkce {
  // 64 random bytes → 86 base64url chars, inside the 43–128 range.
  const verifier = base64url(randomBytes(64));
  return { verifier, challenge: challengeFor(verifier), method: "S256" };
}

export function randomState(): string {
  return base64url(randomBytes(24));
}

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
export function isValidVerifier(verifier: string): boolean {
  return VERIFIER_RE.test(verifier);
}
