/**
 * The session cookie holds the connected X account id and nothing else, signed
 * with HMAC-SHA256 so a browser cannot claim another user's connected account.
 * Secret: SESSION_SECRET, falling back to X_TOKEN_KEY (both server-only).
 */
import type { Env } from "./types";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NotImplemented } from "@quantagent/core/types";

export const SESSION_COOKIE = "qa_session";
export const OAUTH_STATE_COOKIE = "qa_x_state";
const MAX_AGE_S = 60 * 60 * 24 * 90;

export function sessionSecret(env: Env = process.env): string | null {
  const s = env["SESSION_SECRET"]?.trim() || env["X_TOKEN_KEY"]?.trim();
  return s ? s : null;
}

function requireSecret(env: Env): string {
  const s = sessionSecret(env);
  if (!s) {
    throw new NotImplemented("session cookie", "signing the session cookie needs a server secret", ["SESSION_SECRET (or X_TOKEN_KEY)"]);
  }
  return s;
}

function mac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function signSession(accountId: string, env: Env = process.env): string {
  if (!/^[0-9A-Za-z_-]+$/.test(accountId)) throw new Error("account id must be url-safe");
  return `${accountId}.${mac(accountId, requireSecret(env))}`;
}

export function verifySession(value: string | undefined | null, env: Env = process.env): string | null {
  if (!value) return null;
  const secret = sessionSecret(env);
  if (!secret) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const accountId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(accountId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return accountId;
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** The connected X account id from a Cookie header, or null. */
export function readSession(cookieHeader: string | null | undefined, env: Env = process.env): string | null {
  return verifySession(parseCookies(cookieHeader)[SESSION_COOKIE], env);
}

function cookie(name: string, value: string, maxAgeS: number, env: Env): string {
  const secure = env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${secure}`;
}

export function sessionSetCookie(accountId: string, env: Env = process.env): string {
  return cookie(SESSION_COOKIE, signSession(accountId, env), MAX_AGE_S, env);
}

export function sessionClearCookie(env: Env = process.env): string {
  return cookie(SESSION_COOKIE, "", 0, env);
}

export function oauthStateSetCookie(state: string, env: Env = process.env): string {
  return cookie(OAUTH_STATE_COOKIE, state, 600, env);
}

export function oauthStateClearCookie(env: Env = process.env): string {
  return cookie(OAUTH_STATE_COOKIE, "", 0, env);
}
