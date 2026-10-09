/**
 * AES-256-GCM encryption for tokens at rest.
 * Key: X_TOKEN_KEY, 32 bytes as 64 hex chars. Missing or malformed → NotImplemented.
 *
 * Ciphertext format: "v1.<iv b64url>.<tag b64url>.<ciphertext b64url>"
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { NotImplemented } from "@quantagent/core/types";

export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION = "v1";

function toB64url(buf: Buffer): string {
  return buf.toString("base64url");
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function parseTokenKey(keyHex: string | undefined): Buffer {
  if (!keyHex || !keyHex.trim()) {
    throw new NotImplemented("x.tokenEncryption", "tokens must be encrypted at rest and no key is configured", [
      "X_TOKEN_KEY",
    ]);
  }
  const trimmed = keyHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new NotImplemented(
      "x.tokenEncryption",
      "X_TOKEN_KEY must be exactly 32 bytes encoded as 64 hex characters (openssl rand -hex 32)",
      ["X_TOKEN_KEY"],
    );
  }
  return Buffer.from(trimmed, "hex");
}

/** Builds a cipher from a hex key. Defaults to process.env.X_TOKEN_KEY. */
export function createTokenCipher(keyHex: string | undefined = process.env["X_TOKEN_KEY"]): TokenCipher {
  const key = parseTokenKey(keyHex);
  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGO, key, iv);
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, toB64url(iv), toB64url(tag), toB64url(ct)].join(".");
    },
    decrypt(ciphertext: string): string {
      const parts = ciphertext.split(".");
      if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new Error("x.tokenEncryption: unrecognised ciphertext format");
      }
      const iv = fromB64url(parts[1] ?? "");
      const tag = fromB64url(parts[2] ?? "");
      const ct = fromB64url(parts[3] ?? "");
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      // Throws on tamper (auth tag mismatch). Never returns garbage silently.
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    },
  };
}
