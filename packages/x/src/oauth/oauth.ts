/**
 * OAuth 2.0 Authorization Code flow with PKCE against the user's OWN X account.
 *
 * This module only ever asks an existing account holder for consent. It has no
 * way to create accounts and never will: the Voice posts solely from accounts
 * the user connected here.
 *
 * Endpoints (X API v2):
 *   authorize  GET  https://x.com/i/oauth2/authorize
 *   token      POST https://api.x.com/2/oauth2/token   (code exchange + refresh)
 *   whoami     GET  https://api.x.com/2/users/me        (to learn the account id)
 */
import { NotImplemented } from "@quantagent/core/types";
import { XApiError } from "../errors";
import { createPkce, isValidVerifier, randomState } from "./pkce";
import type { StoredTokens, TokenStore } from "./tokenStore";

export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"] as const;
export type XScope = (typeof X_SCOPES)[number];

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_ME_URL = "https://api.x.com/2/users/me";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OAuthConfig {
  clientId: string;
  /** Only for "confidential" apps. Public (PKCE-only) apps leave it unset. */
  clientSecret?: string;
  redirectUri: string;
  scopes?: readonly string[];
  authorizeUrl?: string;
  tokenUrl?: string;
  meUrl?: string;
}

/** Reads X_CLIENT_ID, X_CLIENT_SECRET (optional), X_REDIRECT_URI. Missing required → NotImplemented. */
export function oauthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthConfig {
  const clientId = env["X_CLIENT_ID"]?.trim();
  const redirectUri = env["X_REDIRECT_URI"]?.trim();
  const missing: string[] = [];
  if (!clientId) missing.push("X_CLIENT_ID");
  if (!redirectUri) missing.push("X_REDIRECT_URI");
  if (missing.length) {
    throw new NotImplemented(
      "x.oauth",
      "connecting an X account needs an OAuth 2.0 app from the X developer portal",
      missing,
    );
  }
  const cfg: OAuthConfig = { clientId: clientId as string, redirectUri: redirectUri as string, scopes: X_SCOPES };
  const secret = env["X_CLIENT_SECRET"]?.trim();
  if (secret) cfg.clientSecret = secret;
  return cfg;
}

export interface AuthorizeRequest {
  /** Send the browser here. */
  url: string;
  /** Opaque CSRF token; echoed back on the redirect. */
  state: string;
  /** PKCE verifier. Keep server-side, keyed by state. Never put it in the URL. */
  verifier: string;
}

export function buildAuthorizeUrl(config: OAuthConfig, input: { state: string; challenge: string }): string {
  const u = new URL(config.authorizeUrl ?? X_AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", config.clientId);
  u.searchParams.set("redirect_uri", config.redirectUri);
  u.searchParams.set("scope", (config.scopes ?? X_SCOPES).join(" "));
  u.searchParams.set("state", input.state);
  u.searchParams.set("code_challenge", input.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/** Stateless: fresh PKCE pair + state + authorize URL. */
export function startAuthorization(config: OAuthConfig): AuthorizeRequest {
  const pkce = createPkce();
  const state = randomState();
  return { url: buildAuthorizeUrl(config, { state, challenge: pkce.challenge }), state, verifier: pkce.verifier };
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  /** Seconds from issue. */
  expiresIn: number;
  scopes: string[];
  tokenType: string;
}

function authHeaders(config: OAuthConfig): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (config.clientSecret) {
    h["authorization"] = "Basic " + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  }
  return h;
}

async function tokenRequest(config: OAuthConfig, fetchImpl: FetchLike, form: Record<string, string>): Promise<TokenResponse> {
  const url = config.tokenUrl ?? X_TOKEN_URL;
  const body = new URLSearchParams(form).toString();
  const res = await fetchImpl(url, { method: "POST", headers: authHeaders(config), body });
  const json = await parseJson(res);
  if (!res.ok) throw new XApiError(res.status, "oauth2/token", json, headersToMap(res.headers));
  const j = json as Record<string, unknown>;
  if (typeof j["access_token"] !== "string") {
    throw new XApiError(res.status, "oauth2/token", json, headersToMap(res.headers));
  }
  const out: TokenResponse = {
    accessToken: j["access_token"],
    expiresIn: typeof j["expires_in"] === "number" ? j["expires_in"] : 7200,
    scopes: typeof j["scope"] === "string" ? j["scope"].split(" ").filter(Boolean) : [],
    tokenType: typeof j["token_type"] === "string" ? j["token_type"] : "bearer",
  };
  if (typeof j["refresh_token"] === "string") out.refreshToken = j["refresh_token"];
  return out;
}

/** Exchanges the redirect `code` for tokens using the PKCE verifier. */
export async function exchangeCode(
  config: OAuthConfig,
  input: { code: string; verifier: string },
  fetchImpl: FetchLike = fetch,
): Promise<TokenResponse> {
  if (!isValidVerifier(input.verifier)) throw new Error("x.oauth: invalid PKCE verifier");
  return tokenRequest(config, fetchImpl, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: config.redirectUri,
    code_verifier: input.verifier,
    client_id: config.clientId,
  });
}

/** Uses a refresh token (offline.access) to mint a new access token. X rotates refresh tokens. */
export async function refreshTokens(
  config: OAuthConfig,
  input: { refreshToken: string },
  fetchImpl: FetchLike = fetch,
): Promise<TokenResponse> {
  return tokenRequest(config, fetchImpl, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: config.clientId,
  });
}

export interface Whoami {
  id: string;
  username: string;
  name: string;
  followers?: number;
}

/** GET /2/users/me with the fresh access token, to learn which account consented. */
export async function whoami(config: OAuthConfig, accessToken: string, fetchImpl: FetchLike = fetch): Promise<Whoami> {
  const u = new URL(config.meUrl ?? X_ME_URL);
  u.searchParams.set("user.fields", "public_metrics,username,name");
  const res = await fetchImpl(u.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
  const json = await parseJson(res);
  if (!res.ok) throw new XApiError(res.status, "users/me", json, headersToMap(res.headers));
  const data = (json as { data?: Record<string, unknown> }).data ?? {};
  if (typeof data["id"] !== "string") throw new XApiError(res.status, "users/me", json);
  const out: Whoami = {
    id: data["id"],
    username: String(data["username"] ?? ""),
    name: String(data["name"] ?? ""),
  };
  const pm = data["public_metrics"] as Record<string, unknown> | undefined;
  if (pm && typeof pm["followers_count"] === "number") out.followers = pm["followers_count"];
  return out;
}

export function tokensToStored(
  tr: TokenResponse,
  who: { id: string; username?: string },
  now: () => number = Date.now,
): StoredTokens {
  const issued = now();
  const stored: StoredTokens = {
    accountId: who.id,
    accessToken: tr.accessToken,
    expiresAt: new Date(issued + tr.expiresIn * 1000).toISOString(),
    scopes: tr.scopes,
    updatedAt: new Date(issued).toISOString(),
  };
  if (tr.refreshToken !== undefined) stored.refreshToken = tr.refreshToken;
  if (who.username) stored.handle = who.username;
  return stored;
}

/* ───────────────────────── stateful connector ───────────────────────── */

export interface XOAuthOptions {
  config: OAuthConfig;
  store: TokenStore;
  fetch?: FetchLike;
  now?: () => number;
  /** How long a started authorization stays valid. Default 10 minutes. */
  pendingTtlMs?: number;
}

interface Pending {
  verifier: string;
  createdAt: number;
}

/**
 * Keeps PKCE verifiers for in-flight authorizations (keyed by state) and
 * writes the resulting tokens, encrypted, to the TokenStore.
 */
export class XOAuth {
  private readonly pending = new Map<string, Pending>();
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly ttl: number;

  constructor(private readonly opts: XOAuthOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.ttl = opts.pendingTtlMs ?? 10 * 60 * 1000;
  }

  /** Step 1: produce the authorize URL. Returns state so the caller can match the callback. */
  start(): { url: string; state: string } {
    this.sweep();
    const req = startAuthorization(this.opts.config);
    this.pending.set(req.state, { verifier: req.verifier, createdAt: this.now() });
    return { url: req.url, state: req.state };
  }

  /** Step 2: handle the redirect. Exchanges the code, identifies the account, stores tokens. */
  async complete(input: { code: string; state: string }): Promise<StoredTokens> {
    this.sweep();
    const p = this.pending.get(input.state);
    if (!p) throw new Error("x.oauth: unknown or expired state; start the authorization again");
    this.pending.delete(input.state);
    const tr = await exchangeCode(this.opts.config, { code: input.code, verifier: p.verifier }, this.fetchImpl);
    const who = await whoami(this.opts.config, tr.accessToken, this.fetchImpl);
    const stored = tokensToStored(tr, who, this.now);
    await this.opts.store.put(stored);
    return stored;
  }

  /** Refreshes a stored token set. Throws XAccountNotConnected-style error if nothing is stored. */
  async refresh(accountId: string): Promise<StoredTokens> {
    const current = await this.opts.store.get(accountId);
    if (!current) throw new Error(`x.oauth: account ${accountId} is not connected`);
    if (!current.refreshToken) {
      throw new NotImplemented(
        "x.oauth.refresh",
        `account ${accountId} was connected without offline.access; the user must reconnect it`,
        [],
      );
    }
    const tr = await refreshTokens(this.opts.config, { refreshToken: current.refreshToken }, this.fetchImpl);
    const who: { id: string; username?: string } = { id: accountId };
    if (current.handle !== undefined) who.username = current.handle;
    const stored = tokensToStored(tr, who, this.now);
    // X rotates refresh tokens; if the response omitted one, keep the previous.
    if (stored.refreshToken === undefined) stored.refreshToken = current.refreshToken;
    await this.opts.store.put(stored);
    return stored;
  }

  /** Forgets the connected account's tokens locally. (Revocation at X is the user's call.) */
  async disconnect(accountId: string): Promise<void> {
    await this.opts.store.delete(accountId);
  }

  pendingCount(): number {
    this.sweep();
    return this.pending.size;
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttl;
    for (const [state, p] of this.pending) if (p.createdAt < cutoff) this.pending.delete(state);
  }
}

/* ───────────────────────── small helpers ───────────────────────── */

export async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function headersToMap(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}
