# Security: threat model and what the code actually enforces

Written by Agent G (verify) from reading the code and running `/tests` against it; updated at the
close-out after the integrator's and the fix agent's commits (`f2b7c43`, `11719ed`). Every claim
below names the file that enforces it. Claims that the tests could not confirm, or that the code
contradicts, are marked **OPEN** and cross-referenced to `docs/audit-log.md`. As of this revision
there is no open BLOCKING item; one NOTE (F6) is open.

Assets at stake, in order: the user's X account reputation (nothing posted without consent), the
user's SOL (nothing spent beyond the budget they saw), the agent wallet's secret key, the X OAuth
tokens, and the integrity of the contract address (CA) on every surface.

## 1. Keys at rest

| Secret | Where | How |
| --- | --- | --- |
| X OAuth tokens | `x_tokens` table (Postgres) or the memory store | AES-256-GCM, key `X_TOKEN_KEY` (64 hex), random 12-byte IV per record (`packages/x/src/oauth/crypto.ts:15,48`); only ciphertext is stored (`packages/x/src/oauth/tokenStore.ts:58,113`). |
| Agent wallet secret key | `agent_wallets` table or `MemoryKeyStore` | AES-256-GCM, key `AGENT_WALLET_KEY`, the launch id bound as AAD so a ciphertext cannot be re-filed under another launch (`packages/solana/src/wallet/crypto.ts:30-31,46-47`). The public key is the only thing that ever leaves the server (`Launch.started.payload.agentWallet`). |
| Session cookie (web) | browser, `HttpOnly; SameSite=Lax; Secure` in production | Holds only the X account id, HMAC-SHA256 with `SESSION_SECRET` (fallback `X_TOKEN_KEY`), `timingSafeEqual` on verify (`apps/web/src/server/session.ts`). Tampering with the id or the mac yields no session (`tests/13-web.test.ts`). |

Missing keys are a hard stop, not a silent fallback: `createSolanaClient` without
`AGENT_WALLET_KEY` and `createTokenStoreFromEnv` without `X_TOKEN_KEY` throw `NotImplemented`
naming the variable (`tests/12-limitations.test.ts`).

Signing happens in exactly one place: `AgentWallet.signAndSend`
(`packages/solana/src/wallet/agentWallet.ts:130`). The keypair never reaches a worker; workers
see the `SolanaClient` interface, and core wraps even that (see §2, §3).

## 2. The human gate

Reputation and money move only through methods that core wraps with a guard
(`packages/core/src/runtime/scopedClients.ts:71-121`): `x.post`, `x.thread` (class `posts`, or
`recruiting` when the caller is the Recruiter) and `solana.buy`, `solana.sell` (class `trades`).
With the class's autopilot off and no unconsumed approval, the call throws `ApprovalRequired`
before the provider sees anything; the worker that ignores the gate dies with `Worker.failed`
"called x.post without approval" and the launch continues as `partial`
(`tests/03-gates.test.ts`). An approval is one-shot: a second call after a single grant is
refused again (`packages/core/src/runtime/approvals.ts:25`). Autopilot is per class: turning on
`posts` does not unlock `trades` or `recruiting`.

The real Voice and Recruiter honour the gate rather than hitting it: they emit
`Voice.awaitingApproval` / `Recruiter.awaitingApproval` and post only after `resolveApproval`
or `setAutopilot` (`tests/03-gates.test.ts` "real Voice+Recruiter with gates off").

What is **not** gated, by design and worth knowing:

- The dev buy inside `deployPumpFun` (the Launcher) is covered by the budget the user accepted
  on the launch screen, not by an approval. It is bounded by the Launcher's SOL budget (§3).
- `x.uploadMedia` and `x.updateProfile` (avatar/banner by the Artist) are metered but not
  gated (`scopedClients.ts:88,93`). **NOTE N2** in the audit log: a profile change is reputation
  too; the Artist only does it after `Launch.live` and only with the approved logo, but the
  gate does not enforce that. Unchanged at close-out.
- **NOTE N1**: the gated methods throw `ApprovalRequired` synchronously from a Promise-returning
  method (`scopedClients.ts:79,84,113,119`), so a caller using `.catch()` without `await`
  crashes instead of rejecting. Every worker in this repo `await`s, so it is harmless today.
  Unchanged at close-out.

## 3. Budgets

Every worker has `{tokens, apiCalls, sol, deploys}`; the defaults are in core
(`DEFAULT_BUDGETS`) and the launch screen's numbers are the only place SOL budgets are set
(`Trader.sol` from `TRADER_BUDGET_SOL`, the Launcher's from the dev buy). Enforcement is in the
scoped clients (`BudgetMeter`, `packages/core/src/runtime/budget.ts:9`): the meter is charged
before the provider is called, so an over-budget deploy/buy never reaches the network
(`tests/09-budgets.test.ts`: `fakes.hosting.publishes` / `fakes.solana.deploys` stay empty).
Exceeding any dimension emits `Worker.budgetExceeded` then `Worker.failed`; the launch survives
as `partial`.

On chain, the agent wallet re-checks independently: `signAndSend` reserves against the
keystore before signing (`agentWallet.ts:107,131`) and the Postgres keystore does the check and
the increment in a single guarded `UPDATE ... WHERE spent + delta <= budget`
(`packages/solana/src/wallet/keystore.ts:116`), so two concurrent signers cannot both pass.

**FIXED (was OPEN BLOCKING, audit-log F1)**: when the *Launcher* exceeds its SOL budget the
worker fails before the deploy and the launch now settles with `Launch.failed` carrying the
reason (`tests/09-budgets.test.ts:90`); see §9 for the mechanism.

## 4. CA integrity

- The only CA source is `Launcher.deployed.payload.coinCa`: the mint keypair's public key
  (`packages/solana/src/pumpfun/launcher.ts:124`), and the Launcher worker refuses to announce
  anything that is not a base58 address (`packages/workers/src/launcher/launcher.ts:105-107`).
- The Shield registers it as canonical synchronously on the same tick
  (`packages/workers/src/shield/shield.ts:87`); every later address the Shield sees is compared
  against it, never the other way round.
- The Voice refuses to post any text that contains a base58 address other than the deployed
  CA (`packages/workers/src/voice/voice.ts:382-386`, `addressesIn`), and the Builder escapes every
  string that enters the template (`packages/workers/src/builder/template.ts:50`).
- When no coin will ever come, the page says so: the Builder replaces "CA: pending launch" with
  "launch failed: <reason>" and "Anything claiming to be this coin's CA is not ours"
  (`template.ts:170-171`), so a dead launch never leaves a page that looks like it is still about
  to announce an address (`tests/02-isolation.test.ts:131`).
- `tests/06-ca-handshake.test.ts` greps every rendered surface (site HTML, every X post and
  thread, Shield reports, the rebuilt Launch JSON, the whole event log) for any base58 string of
  32–44 chars that is not the CA, the agent wallet, the owner wallet or the deploy signature.
  Zero hits. Builder.published-with-CA, Voice.posted(kind "ca") and Shield.canonicalRegistered
  all land under one second after the deploy in simulation.

**FIXED (was OPEN BLOCKING, audit-log F3)**: the link next to the CA is now the named page. The
Voice keeps the latest `Builder.published` url (`voice.ts:124-127,194-201`), holds the thread until
the Builder has republished (or failed to) after `Ideator.named`, and re-points the CA post to the
latest url at deploy time (`voice.ts:374-381`, `drafts.ts:81`). A single failed named republish
self-heals at the next trigger (`tests/06-ca-handshake.test.ts:187-218`).

**OPEN (NOTE, audit-log F6)**: if the host refuses the `<ticker>` slug on *every* attempt (slug
collision, or an outage that starts after t0), the Builder never falls back to the slug it already
has (`builder.ts:144` moves `this.slug` before the host accepted it), so the CA never reaches any
page; the Voice links the only page that exists, frozen at "CA: pending launch", and core still
emits `Launch.live` with that url (`packages/core/src/orchestrator/launch.ts:280-286`). The CA in
the post itself is correct, and the Builder's events are honest (`Builder.patchFailed`). Evidence:
`tests/06-ca-handshake.test.ts:250,261` (kept failing).

## 5. No account provisioning

- `X_SCOPES` is exactly `tweet.read tweet.write users.read offline.access media.write`
  (`packages/x/src/oauth/oauth.ts:18`); no `account`/`signup` endpoint exists in
  `packages/x/src` and no package or app source contains a signup / createAccount /
  provisioning path (`tests/05-x-account.test.ts`, grep over every package + `apps/web`).
- A client for an account whose tokens are not in the store throws `XAccountNotConnected`
  before any HTTP call (`tests/05-x-account.test.ts`).
- The web app takes the account id from the signed session cookie only (`apps/web/src/server/handlers.ts:38`)
  and builds the launch's XClient from `runtime.client(thatSameId)`
  (`apps/web/src/server/service.ts:202-208`); a never-connected id yields no client and an
  error naming it (`tests/13-web.test.ts`).
- Every worker's `ctx.clients.x.accountId` equals `state.xAccountId` in simulation.

**FIXED (was OPEN BLOCKING, audit-log F4)**: core's `launch()` now refuses an XClient whose
`accountId` differs from `connections.xAccountId` before any worker is constructed
(`packages/core/src/orchestrator/launch.ts:115-119`; `tests/05-x-account.test.ts:86`). A mis-wired
caller can no longer post from account B while the state, the log and the UI say A.

## 6. Mainnet flag

`resolveCluster` returns `mainnet-beta` only when the caller asked for it explicitly **and**
`QUANTAGENT_MAINNET=true` (`packages/solana/src/cluster.ts:16-32`); either alone throws
`MainnetRefused`. The default everywhere is devnet (`apps/web/src/server/service.ts:97`). An
agent wallet created on one cluster refuses to sign on another. On devnet the pump.fun path is
honestly `NotImplemented` naming `PUMPPORTAL_URL` / `QUANTAGENT_MAINNET`
(`tests/12-limitations.test.ts`), so a devnet launch cannot accidentally move real SOL and
cannot pretend to have deployed; and since F1 that honest failure now reaches the user as
`Launch.failed` instead of a launch that never ends (`tests/12-limitations.test.ts:137`).

## 7. Webhook authentication

The Helius webhook handler compares the `Authorization` header to `HELIUS_WEBHOOK_SECRET` with
`timingSafeEqual` on equal-length buffers and answers 401 otherwise
(`packages/solana/src/anomalies/helius.ts:165-175`); a non-JSON or non-array body is 400; when
the webhook is not configured the web route answers 501 with the `NotImplemented` text rather
than accepting anything (`apps/web/src/server/service.ts:493`, `tests/13-web.test.ts`). Only
parsed, error-free enhanced transactions reach the hub.

## 8. Quantum randomness

Core's only draw source is the injected `QuantumClient` (`packages/core/src/orchestrator/launch.ts:197`,
`quantum.draw(`); there is no `Math.random` and no `node:crypto` randomness anywhere in
`packages/core/src`. When the QRNG is unreachable, absent, or answers with a pseudo provider in
production, the orchestrator emits `Orchestrator.collapseUnavailable` and waits for `userPick`;
it never draws locally (`tests/04-quantum.test.ts`). Randomness elsewhere is confined to IVs,
nonces, PKCE verifiers, retry jitter, ids and a visual-only mulberry32 in the chamber; the full
file:line list is in the audit log.

**FIXED (was NOTE, audit-log F5)**: the name deny-lists agree. Core's `FORBIDDEN_PROVIDER_PATTERN`
(`packages/core/src/orchestrator/quantum.ts:9`) is unanchored and covers
`pseudo|prng|mock|fake|math.random|random|dummy|stub|seeded?`, a superset of solana's
`FORBIDDEN_PROVIDER_NAME` (`packages/solana/src/quantum/provider.ts:39`); `local-prng`,
`seeded-mock`, `qrng-fallback-fake` and `stub` are refused by both in production
(`tests/04-quantum.test.ts:75`). The structural guarantee (no local draw path exists) remains what
actually protects the user; the name check is the seat belt.

## 9. Liveness is a security property here

A launch that never settles leaves approvals, a funded agent wallet and watchers alive with no
`Launch.failed` to tell the user. The three deadlocks from the first pass are closed:

- **Builder vs. dead Launcher (F1)**: every worker that waits for the coin goes through
  `waitForDeployed()` (`packages/workers/src/shared.ts:161-188`), which races `Launcher.deployed`
  against `Worker.failed(Launcher)` and `Launch.failed`, and probes what the worker's own `on()`
  already saw so a Launcher that died first is never missed (`:166-169`). The Builder publishes an
  honest "launch failed" page and finishes (`builder.ts:101-109`); the Voice, Trader and Shield fail
  with "Launcher failed: <reason>". Re-verified with the Launcher dying while a Builder publish was
  on the wire (`tests/02-isolation.test.ts:131`).
- **Launcher vs. dead Ideator/Artist (F2)**: `waitForInputs` ends with the producer's failure
  reason (`launcher.ts:161-167,185-210`).
- **Artist vs. dead Ideator (F2)**: `await this.named` rejects on `Worker.failed(Ideator)`,
  `Launch.failed` or abort; the Artist finishes with its quantum-drawn prompt-only logo and
  `outputs.incomplete` (`artist.ts:312-316,361-375`). Re-verified with the Ideator dying while the
  Artist's quantum draw was still open (`tests/02-isolation.test.ts:174`).

In every case core's `finalize()` runs once all eight `start()`s have settled and emits
`Launch.failed` with the Launcher's reason (`launch.ts:297-302`). `stop()` on the handle still
tears everything down for the operator; the user now gets the failure event as well.
