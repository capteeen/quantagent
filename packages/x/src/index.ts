/**
 * @quantagent/x — the X client on the user's connected account.
 *
 * Public surface:
 *   oauth/     OAuth 2.0 PKCE connect flow, encrypted token stores
 *   client/    XApiClient (implements @quantagent/core XClient), XRuntime, media upload
 *   ratelimit/ token buckets, reset-header tracking, backoff, dead-letter queue
 *   budget/    monthly call budget with pause at 100%
 *   errors     typed failures (nothing is swallowed)
 */
export * from "./errors";
export * from "./oauth/index";
export * from "./client/index";
export * from "./ratelimit/index";
export * from "./budget/index";
export type { XClient, XPost, XAccountSummary } from "@quantagent/core/types/clients";
