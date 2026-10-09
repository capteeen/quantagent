/**
 * AES-256-GCM encryption of agent wallet secret keys at rest.
 * Key: AGENT_WALLET_KEY, 32 bytes as 64 hex characters.
 * Blob format: "v1:" + base64(iv 12B) + ":" + base64(authTag 16B) + ":" + base64(ciphertext)
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { NotImplemented } from "@quantagent/core/types";
import { envOf, type Env } from "../env";

export const WALLET_KEY_ENV = "AGENT_WALLET_KEY";
const BLOB_VERSION = "v1";
const IV_BYTES = 12;

export function loadWalletKey(env?: Env): Buffer {
  const raw = envOf(env)[WALLET_KEY_ENV];
  if (!raw || raw.trim() === "") {
    throw new NotImplemented("agent wallet", `${WALLET_KEY_ENV} not set`, [WALLET_KEY_ENV]);
  }
  const hex = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${WALLET_KEY_ENV} must be 32 bytes as 64 hex characters (got ${hex.length} chars)`);
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecretKey(secretKey: Uint8Array, key: Buffer, aad?: string): string {
  if (key.length !== 32) throw new Error("wallet key must be 32 bytes");
  const iv = randomBytes(IV_BYTES); // nonce only; never used for selection
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [BLOB_VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecretKey(blob: string, key: Buffer, aad?: string): Uint8Array {
  if (key.length !== 32) throw new Error("wallet key must be 32 bytes");
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== BLOB_VERSION) {
    throw new Error("unrecognised encrypted wallet blob");
  }
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const ct = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(pt);
}
