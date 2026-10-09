/**
 * OAuth 1.0a request signing (HMAC-SHA1), used ONLY for the two v1.1 profile
 * endpoints (update_profile_image / update_profile_banner), which X still
 * gates behind OAuth 1.0a user context on most tiers.
 *
 * The 1.0a credentials come from the developer portal for the app owner's own
 * account (X_OAUTH1_*). They must belong to the same account the user
 * connected; the client verifies that before use. This is not a second way to
 * connect accounts, only a signing method for one legacy endpoint pair.
 */
import { createHmac, randomBytes } from "node:crypto";

export interface OAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export const OAUTH1_ENV_VARS = [
  "X_OAUTH1_CONSUMER_KEY",
  "X_OAUTH1_CONSUMER_SECRET",
  "X_OAUTH1_ACCESS_TOKEN",
  "X_OAUTH1_ACCESS_TOKEN_SECRET",
] as const;

/** Returns null when not configured (profile updates then use the bearer token and report the caveat). */
export function oauth1FromEnv(env: NodeJS.ProcessEnv = process.env): OAuth1Credentials | null {
  const [ck, cs, at, as] = OAUTH1_ENV_VARS.map((k) => env[k]?.trim());
  if (!ck || !cs || !at || !as) return null;
  return { consumerKey: ck, consumerSecret: cs, accessToken: at, accessTokenSecret: as };
}

/** RFC 3986 percent-encoding as OAuth 1.0a requires. */
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export interface OAuth1SignInput {
  method: string;
  /** URL without query string. */
  url: string;
  /** Query + form-encoded body params (all participate in the signature). */
  params?: Record<string, string>;
  nonce?: string;
  timestamp?: number;
}

export function oauth1Header(creds: OAuth1Credentials, input: OAuth1SignInput): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: input.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const all: [string, string][] = [];
  for (const [k, v] of Object.entries({ ...(input.params ?? {}), ...oauthParams })) all.push([rfc3986(k), rfc3986(v)]);
  all.sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
  const paramString = all.map(([k, v]) => `${k}=${v}`).join("&");
  const base = [input.method.toUpperCase(), rfc3986(input.url), rfc3986(paramString)].join("&");
  const key = `${rfc3986(creds.consumerSecret)}&${rfc3986(creds.accessTokenSecret)}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");
  const headerParams = { ...oauthParams, oauth_signature: signature };
  return (
    "OAuth " +
    Object.entries(headerParams)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`)
      .join(", ")
  );
}

/** The user id an OAuth 1.0a access token belongs to is its prefix: "<userId>-<rest>". */
export function oauth1AccountId(creds: OAuth1Credentials): string | undefined {
  const m = /^(\d+)-/.exec(creds.accessToken);
  return m?.[1];
}
