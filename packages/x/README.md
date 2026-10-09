# @quantagent/x

The X client on the user's **own** connected account. Implements `XClient` from
`@quantagent/core/types/clients` over X API v2.

**The Voice posts only from accounts the user connected.** This package can ask
an existing account holder for consent (OAuth 2.0 PKCE) and nothing else: there
is no code path that creates, provisions or bulk-connects accounts, and
`test/noProvisioning.test.ts` greps the package to keep it that way.

Nothing here is faked. Every method either performs the real X API call or
throws a typed error (`XApiError`, `XBudgetPaused`, `XDeadLettered`,
`XThreadFailed`, `XAccountNotConnected`, `NotImplemented`). Empty results are
returned empty.

## Install / run

```sh
pnpm --filter @quantagent/x test
pnpm --filter @quantagent/x typecheck
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `X_CLIENT_ID` | yes | OAuth 2.0 client id of your app (developer portal). |
| `X_CLIENT_SECRET` | no | Only for a *confidential* app; adds HTTP Basic to the token endpoint. Public PKCE apps omit it. |
| `X_REDIRECT_URI` | yes | Callback URL, byte-identical to the one in the developer portal. |
| `X_TOKEN_KEY` | yes | 32-byte hex key (`openssl rand -hex 32`) for AES-256-GCM encryption of tokens at rest. Missing → `NotImplemented`. |
| `DATABASE_URL` | one of | Postgres; tokens live in table `x_tokens` (ciphertext only; the DDL is `X_TOKENS_DDL`). |
| `X_TOKEN_STORE=memory` | one of | Dev/test only: in-memory token store (still encrypted; lost on restart). |
| `X_MONTHLY_CALL_BUDGET` | no | Monthly ceiling on X API HTTP calls. Default `1500`. |
| `REDIS_URL` | no | Durable dead-letter queue (hash `x:dlq`) and budget counter (`x:budget:<YYYY-MM>`). Without it both are in-memory and vanish on restart. |
| `X_TREND_QUERY` | no | Recent-search query for the search-based trends fallback. Default `(solana OR memecoin OR pumpfun OR "pump.fun") -is:retweet lang:en`. |
| `X_OAUTH1_CONSUMER_KEY`, `X_OAUTH1_CONSUMER_SECRET`, `X_OAUTH1_ACCESS_TOKEN`, `X_OAUTH1_ACCESS_TOKEN_SECRET` | no | OAuth 1.0a user credentials for the two v1.1 profile endpoints (see caveat below). Must belong to the connected account; the client refuses them otherwise. |

## Developer portal setup

1. In the X developer portal, create a Project and an App (Free tier is enough to post).
2. Under *User authentication settings*: enable **OAuth 2.0**, type *Web App*
   (or *Native/Public* for a PKCE-only client without a secret), permissions
   **Read and write**, and add your callback as `X_REDIRECT_URI`. Copy the
   Client ID (and Client Secret if you chose a confidential app).
3. Set `X_CLIENT_ID`, `X_CLIENT_SECRET` (optional), `X_REDIRECT_URI`.
4. Generate `X_TOKEN_KEY` with `openssl rand -hex 32` and point `DATABASE_URL` at Postgres.
5. Optional: only if you need avatar/banner updates and X rejects the OAuth 2.0
   token on the v1.1 endpoints, generate OAuth 1.0a *Access Token and Secret*
   for the **same** account in the portal (*Keys and tokens*) and set `X_OAUTH1_*`.

The requested scopes are exactly `tweet.read tweet.write users.read offline.access media.write`.

## Connect flow (OAuth 2.0 PKCE)

```ts
import { createXRuntime } from "@quantagent/x";

const x = await createXRuntime();                 // reads env, throws NotImplemented listing what is missing
const { url, state } = x.oauth.start();           // send the browser to url; verifier stays server-side
// ...on the callback:
const tokens = await x.oauth.complete({ code, state });  // exchanges with code_verifier, calls /2/users/me
tokens.accountId                                  // the X user id that consented → Launch.xAccountId
```

Tokens are encrypted before they touch any store (`v1.<iv>.<tag>.<ct>`), refresh
tokens rotate on every refresh, and refreshes are coalesced per account. The
client refreshes automatically when a token is within 60 s of expiry or X
answers 401.

## Client

```ts
const client = x.client(launch.xAccountId);       // XApiClient implements XClient, scoped to that one account

await client.post({ text, mediaIds?, replyTo? });            // POST /2/tweets
await client.thread({ posts: [{ text, mediaIds? }, ...] });  // sequential, each reply chained to the previous id
await client.uploadMedia({ url, alt? });                     // v2 chunked: initialize → append×n → finalize → STATUS → alt text
await client.mentions({ sinceId? });                         // GET /2/users/:id/mentions (max 100)
await client.search({ query, max? });                        // GET /2/tweets/search/recent (10..100)
await client.trends();                                       // see "Trends" below
await client.users({ ids });                                 // GET /2/users?ids= (batched by 100)
await client.updateProfile({ avatarUrl?, bannerUrl? });      // v1.1 update_profile_image / update_profile_banner
await client.budget();                                       // { used, limit, resetsAt, paused }
await x.status();                                            // budget + rate-limit snapshot + dead letters + connected accounts
```

Every `XPost.url` is `https://x.com/<handle>/status/<id>` when the author's
handle is known, otherwise the handle-less `https://x.com/i/web/status/<id>`.

### Rate limiting

One global token bucket (default 300 per 15 min) and one per account (100 per
15 min). Every response's `x-rate-limit-limit / -remaining / -reset` headers
are recorded per (account, route); when X says `remaining: 0` nothing is sent on
that route until `reset`. A 429 waits for `retry-after` or the reset timestamp,
otherwise exponential backoff (1 s base, 60 s cap, 20 % jitter); 5xx and network
errors back off the same way. Four attempts per request by default. A wait over
16 minutes throws `XRateLimitWait` instead of hanging.

### Dead-letter queue

A write (`post`, `thread`, `uploadMedia`, `updateProfile`) that still fails
after all retries is stored with its exact input and error and the call throws
`XDeadLettered { dlqId }`. A thread that breaks part-way throws `XThreadFailed`
carrying the posts that *did* go out, the failed index, and a dead letter that
holds the remaining posts plus the reply anchor, so a retry continues the same
thread. `x.dlq.list()` is the visible failure log; `x.dlq.retry(id)` replays and
returns `{ ok, entry, result | error }`. Terminal failures (400/401/403/404,
budget paused, not connected, `NotImplemented`) are thrown directly, not queued.

### Monthly call budget

Every HTTP call to X counts (retries included). At 100 % of
`X_MONTHLY_CALL_BUDGET` all calls are refused with `XBudgetPaused` and
`budget().paused` is `true`, so the Voice pauses and the UI can say why. The
counter resets on the first of the next month (UTC).

### Trends

`trends()` first calls `GET /2/users/personalized_trends`. If the tier refuses
it (402/403/404) it falls back to a hashtag/cashtag tally over
`GET /2/tweets/search/recent` for `X_TREND_QUERY`, and every returned row
carries `source: "search"` (vs `"personalized_trends"`) so nobody mistakes the
tally for X's list.

### Profile updates: the access caveat

`update_profile_image` and `update_profile_banner` only exist on API v1.1, and X
documents them for OAuth 1.0a user context. Some apps get through with the
OAuth 2.0 bearer; many get 401/403. The client tries the bearer first and, if X
refuses, throws `NotImplemented("x.updateProfile", ..., X_OAUTH1_*)`. With the
`X_OAUTH1_*` variables set, the requests are signed with OAuth 1.0a (HMAC-SHA1).
The 1.0a token's user id prefix must match the connected account; otherwise the
client refuses, because this package never touches any account but the one the
user connected.

## Tier limitations (X API, as of 2026)

- **Free**: `POST /2/tweets`, `DELETE`, `GET /2/users/me`, media upload. No
  search, no mentions timeline, no user lookups by id in volume. Posting works;
  `mentions`, `search`, `trends` and bulk `users` come back as `XApiError` 402/403.
- **Basic**: adds recent search, mentions, users lookup, at low monthly caps.
  Keep `X_MONTHLY_CALL_BUDGET` under the tier's cap.
- **Pro and up**: personalized trends and higher windows.
- Chunked media upload applies to every tier; images up to 5 MB, GIF 15 MB,
  video 512 MB; video/GIF go through async processing (STATUS polling).

## Package layout

- `src/oauth/` — PKCE, authorize URL, code exchange, refresh, `XOAuth`, encrypted `TokenStore` (memory, Postgres)
- `src/client/` — `XApiClient`, `XHttp` transport, media upload, OAuth 1.0a signing, `XRuntime`
- `src/ratelimit/` — `TokenBucket`, `RateLimiter`, backoff/header parsing, dead-letter queue (memory, Redis)
- `src/budget/` — `MonthlyBudget` (memory, Redis counter)
- `src/errors.ts` — typed failures
