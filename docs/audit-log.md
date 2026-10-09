# Audit log: SPEC §9 (Agent G, verify)

## Verdict (close-out, 2026-10-09)

**Open BLOCKING findings: none.** F1–F5 from the first pass are fixed in the tree and re-verified
here with the original evidence tests (now passing) plus one new adversarial timing per liveness fix
(`tests/02-isolation.test.ts:131,174`, `tests/06-ca-handshake.test.ts:187`). The full suite is
`cd tests && npx vitest run` → **12 files, 139 tests, 139 passed**. The one new finding of the
close-out, **F6 (NOTE)**, was fixed by the integrator in the same pass (Builder falls back to the
last slug the host served; core requires a `Builder.published` after `coinCa` before `Launch.live`)
and its evidence tests now pass. Every package suite is green (core 37, x 75, solana 49, workers
117, ui 122, web 21) and `apps/web` typechecks clean.

What cannot be verified in this container, honestly:

- **A real pump.fun deploy / dev buy / trade** — devnet is `NotImplemented` by design; only the
  error path ran with the real `createSolanaClient`. Mainnet needs `QUANTAGENT_MAINNET=true`, a
  funded `AGENT_WALLET_KEY` and `PUMPPORTAL_URL`.
- **Real ANU QRNG, real X API, real Helius webhooks, real Cloudflare/Vercel hosting** — all fakes or
  canned HTTP; the ANU proof derivation, the X rate limiter and the webhook auth were checked
  against recorded responses only.
- **Frame time and heap on a mid-range phone** — the container renders through SwiftShader; the
  harness skips its assertion (6 frames across the whole launch) and its heap figures are not
  meaningful here (N4/N5).
- **The chamber's rendered 3D output** (strand/link counts on screen) — only the store was checked.
- **Postgres-backed stores** (`x_tokens`, `agent_wallets`, the event store) — memory stores only;
  the guarded `UPDATE` in `keystore.ts:116` was read, not executed.
- **`apps/web` screens end-to-end** — the server layer is tested (`tests/13-web.test.ts`); the React
  screens and Next routes are typechecked and built, not driven.

Run: `cd tests && npx vitest run` (vitest 2.1.9, Node 22). Nothing outside `/tests` and
`/docs/{security,audit-log}.md` was modified by this agent. Nothing was committed.

Harness: `tests/helpers/launch.ts` runs the real `launch()` from `@quantagent/core` with the real
`createWorkers()` roster from `@quantagent/workers` (the Artist is constructed through
`createArtist({store})` because `createWorkers()` cannot inject its object store, N3) and black-box
fakes for every client (`tests/helpers/fakes.ts`; this pass added `hold`/`delayMs`/`failFor` on the
hosting fake and a `gate` on the LLM and quantum fakes so a failure can be timed against another
worker's step). Tests import only package index files.

## Pass/fail by §9 check

| # | Check | What ran | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1 | 8 Worker.started within 100ms; no start waits on another | `tests/01-parallel.test.ts`: `getStartTimings()`, wrapped `start()` entry times and `Worker.started.at` all within 100ms; `finishedBefore` is 0 for every worker; a 400ms-slow Ideator delays nobody | PASS (2/2) | spread measured three ways < 100ms |
| 2 | Kill a worker mid-launch: others finish, `Launch.partial` lists exactly the dead one | `tests/02-isolation.test.ts` (a) hosting throws in Builder, (b) Shield `on()` throws, (c) Recruiter `start()` throws synchronously | PASS (3/3) | — |
| 2' | Adversarial: a dead worker others depend on must still end in `Launch.failed` | (d) Ideator dies, (e) Artist dies, (f) Launcher dies; **new this pass**: (g) Launcher dies while the Builder's `<ticker>` republish is held on the wire, (h) Ideator dies after `Worker.candidates(Artist)` and before `Orchestrator.collapsed` (quantum draw held open) | **PASS (5/5)** — F1/F2 FIXED | `02-isolation.test.ts:87,119,102,131,174` |
| 3 | Post/reach out/trade impossible with approvals + autopilot off; provider sees 0 calls; per-class autopilot | `tests/03-gates.test.ts`: gate-breaking Voice/Recruiter/Trader fail "without approval"; direct `ctx.clients.x.post/thread`, `solana.buy/sell` reject `ApprovalRequired`; `posts` unlocks only posts; one-shot grant; skip → `ApprovalDenied`; real Voice+Recruiter wait on `awaitingApproval` | PASS (7/7) | N1 (sync throw) |
| 4 | Pseudorandom provider impossible in production (core + solana); source scan | `tests/04-quantum.test.ts`: 12 pseudo names × `registerQuantumProvider` / `assertProofUsable`; production launch with provider `prng-local` → `collapseUnavailable` + `userPick`, never `collapsed`; `anu` accepted with proof; unreachable / absent QRNG → no fallback; solana × 11 names in prod and dev; ANU answer → `verifyProof`; **core and solana deny-lists now agree on `local-prng` / `seeded-mock` / `qrng-fallback-fake` / `stub`**; source scan of every `packages/*/src` for `Math.random|randomInt|randomBytes|getRandomValues|randomUUID|crypto.random` | **PASS (47/47)** — F5 FIXED | `04-quantum.test.ts:75`; hit list below |
| 5 | No X account creation anywhere; the Voice's client is scoped to `launch.xAccountId` | `tests/05-x-account.test.ts`: grep every package + `apps/web` + tests; X endpoints; `X_SCOPES` exact; `XAccountNotConnected` with 0 fetches; every worker's `ctx.clients.x.accountId === state.xAccountId`; **`launch()` now refuses an XClient whose `accountId` differs from `connections.xAccountId`** | **PASS (7/7)** — F4 FIXED | `05-x-account.test.ts:86` |
| 6 | CA handshake timing; zero-tolerance grep of every rendered surface | `tests/06-ca-handshake.test.ts`: Builder.published with CA, Voice.posted kind `ca`, Shield.canonicalRegistered each < 1s after deploy; grep of hosting HTML, every X post/thread, Voice payloads, Shield reports, rebuilt Launch JSON and the whole log → 0 foreign addresses; **the thread and the CA post link the `<ticker>` page, never the t0 slug**; **new this pass**: the named republish 502s once (self-heals: 2/2 pass), the host refuses the ticker slug forever (4/4 after the F6 fix) | PASS 19/19 — F3 FIXED; F6 FIXED | `06-ca-handshake.test.ts:139` (F3), `:187-218` (transient), `:221-272` (permanent; fails at `:257`, `:268`) |
| 7 | Chamber store: empty stream unchanged; recorded fixture deterministic; 8 strands; 67×16 links; pulses == Worker.progress | `tests/07-chamber.test.ts` against `@quantagent/ui` and `packages/ui/src/fixtures/launch.recorded.json` (1239 events) | PASS (7/7) | 3 fresh stores → identical snapshots; 67×16=1072 links |
| 8 | Frame-time test + heap across a launch | `pnpm --filter @quantagent/ui frametime` run 3 (this pass, 11:0x): renderer SwiftShader, **0 page errors** (the run-1 "must be rendered inside <Chamber />" error is gone, N4), 6 frames, median 5174ms, assertion **SKIPPED** by the script; heap 14.5MB → 22.9MB after first launch (+8.4MB incl. lazy chunks) → 26.4MB after second (+3.4MB, **+15.0% across a launch**); the script says the figures "mean nothing here" | **NOT VERIFIABLE here** (no GPU); heap growth stays **N5** | scratchpad `frametime3.txt` |
| 9 | Exceed every budget dimension one at a time → `Worker.budgetExceeded`, launch survives partial | `tests/09-budgets.test.ts`: tokens (Recruiter), apiCalls (Shield), deploys (Builder), sol (Trader) — each: one `budgetExceeded`, `Worker.failed`, provider never called, launch `partial`; **Launcher over its SOL budget: refused before the deploy and the launch now reports `Launch.failed`**; default SOL 0 for everyone but Trader/Launcher; `Worker.spent` matches state | **PASS (7/7)** — F1 FIXED | `09-budgets.test.ts:90` |
| 10 | Replay: `rebuild(log)` toStrictEqual live state; chamber replay twice identical | `tests/10-replay.test.ts`: QSD "run" (67×16 chain steps on the log), autopilot flipped after; `rebuild` strict-equal, JSON round trip, dense `seq`, reducer purity, cursor resume, QSD stage counts; two chamber stores identical | PASS (7/7) | — |
| 11 | Audit: Artist rules, Voice dedup, Recruiter cap, Builder triggers, X limiter | `tests/11-audit.test.ts`: `ContentRuleViolation` with 0 image calls; post-launch disallowed brief → `Artist.generationFailed`; every prompt passes `checkContent`; identical milestones → one post; `RECRUITER_HOURLY_CAP=2` → 2 posts + `Recruiter.capped`; every `Builder.published.trigger` names a preceding event; `createXRuntime` limiter: `x-rate-limit-reset`, `retry-after`, per-route buckets, `X_MONTHLY_CALL_BUDGET`, 403 | PASS (15/15) | — |
| 12 | Honest limitations surfaced as events/errors, never swallowed | `tests/12-limitations.test.ts`: real `createSolanaClient` on devnet → `NotImplemented` naming `PUMPPORTAL_URL` / `QUANTAGENT_MAINNET`; `resolveCluster` matrix; mainnet refused; missing `AGENT_WALLET_KEY`; QSD `NotImplemented`; `qsd-skipped` step; **real client inside a real launch: Launcher fails with the exact text, Voice fails "Launcher failed", no CA posted, and `Launch.failed` is emitted** | **PASS (8/8)** — F1 FIXED | `12-limitations.test.ts:122,137` |
| + | apps/web server layer | `tests/13-web.test.ts`: signed session cookie, `clusterFromEnv`, launch XClient scoped to the session id via the real X runtime, never-connected id → no client, Helius webhook 401/400/200/501 | PASS (5/5) | — |

Package suites, run unchanged this pass (`pnpm -r --filter "./packages/*" test`): core 37/37, x 75/75,
solana 49/49, workers 117/117, ui 122/122. `pnpm --filter @quantagent/web typecheck`: exit 0.

## Findings

### F1 — FIXED: a Launcher failure no longer deadlocks the launch
Fix: `packages/workers/src/shared.ts:161-188` `waitForDeployed()` races `Launcher.deployed` against
`Worker.failed(Launcher)` and `Launch.failed` and throws `LauncherFailed`; the `already` /
`alreadyFailed` probes (`:166-169`) cover a Launcher that died before the caller reached its wait
(`launcherFailureOf`, `:138`, is recorded from every `on()`: `voice.ts:184`, `trader.ts:115`,
`shield.ts:73`). The Builder subscribes before its t0 publish (`builder.ts:77`), catches
`LauncherFailed` (`:101-109`), replaces "CA: pending launch" with "launch failed: <reason>"
(`template.ts:170`), publishes with trigger `Launcher.failed` through the same coalescing queue and
returns `outputs.launchFailed`. Core's `finalize()` then emits `Launch.failed` with the Launcher's
reason (`packages/core/src/orchestrator/launch.ts:297-302`).
Now passing: `tests/02-isolation.test.ts:102` (deploy throws), `tests/09-budgets.test.ts:90`
(Launcher SOL budget), `tests/12-limitations.test.ts:122` (QSD error), `:137` (real devnet client);
package: `builder.test.ts:209`, `shield.test.ts:164`, `voice.test.ts:449`.
Re-verified adversarially: `tests/02-isolation.test.ts:131` (g) holds the Builder's first `<ticker>`
publish on the wire until `Worker.failed(Launcher)` has been emitted (proved by seq: failure lands
between the Builder's `publish` progress for `Ideator.named` and that publish's `Builder.published`);
the queued `Launcher.failed` publish runs after the in-flight one, every page the host receives from
then on says "launch failed" and never "CA: pending launch" or a pump.fun link, the Builder is
`done`, `Launch.failed` ×1, no CA was ever posted. Passes 3/3 solo and under full-suite load.

### F2 — FIXED: Ideator or Artist death no longer hangs the Launcher
Fix: `packages/workers/src/launcher/launcher.ts:161-167` `on()` turns `Worker.failed(Ideator)`
before the name, `Worker.failed(Artist)` before the logo, or `Launch.failed` into `inputGone()`;
`waitForInputs` (`:185-210`) rejects with that reason. `packages/workers/src/artist/artist.ts:312-316`
`nameGone()` rejects `this.named` on the same events (`:439-444`) and on abort (`:358`); `start()`
catches it (`:361-375`) and finishes with the quantum-drawn prompt-only logo and
`outputs.incomplete = <reason>`. The Voice fails outright when the Ideator dies before the name
(`voice.ts:225-234`).
Now passing: `tests/02-isolation.test.ts:87` (d), `:119` (e); package: `launcher.test.ts:123,135,147,157`,
`artist.test.ts:177-210`.
Re-verified adversarially: `tests/02-isolation.test.ts:174` (h) gates the LLM so the Ideator dies only
after `Worker.candidates(Artist)`, and gates the quantum draw so `Orchestrator.collapsed(Artist)` is
emitted only after `Worker.failed(Ideator)`: the Artist is inside `ctx.collapse()` when the name is
lost. Result: `candidates.seq < ideatorFailed.seq < collapsed.seq`, Artist `done` with
`incomplete` naming the Ideator, Launcher `failed` "Ideator failed before naming the coin", Builder
`done`, zero deploys, no `Artist.logoReady`, `Launch.failed` ×1.

### F3 — FIXED: the CA post and thread link the named page
Fix: `packages/workers/src/voice/voice.ts:124-127` keeps the LATEST `Builder.published` url and a
`siteNamed` flag set by a `Builder.published` or `Builder.patchFailed` whose trigger includes
`Ideator.named` (`:194-201`); the thread waits for `siteNamed` unless the deploy or a Builder failure
makes waiting pointless (`:272-275`); the CA post is finalized against the latest url at deploy time
(`:374-381`, `drafts.ts:81` `refreshSiteUrl`) and logs `ca.relinked` when it moved.
Now passing: `tests/06-ca-handshake.test.ts:139`; package: `voice.test.ts:391,399,432`.
Re-verified adversarially: `tests/06-ca-handshake.test.ts:187-218` — the first `<ticker>` publish
502s (`Builder.patchFailed` for `Ideator.named`), the next trigger republishes, the deploy follows:
every url the Voice posted was served by the host, the page behind the CA post carries the CA and
equals `state.siteUrl` (2/2 pass). The permanent-failure variant surfaced F6.

### F4 — FIXED: core binds the XClient to `connections.xAccountId`
Fix: `packages/core/src/orchestrator/launch.ts:115-119` throws
"the X client is scoped to account A but the launch connects B; the Voice posts only from the
connected account" before any worker is constructed. Now passing: `tests/05-x-account.test.ts:86`;
`apps/web` wiring unchanged (`service.ts`, `tests/13-web.test.ts`).

### F5 — FIXED: the pseudo-provider deny-lists agree
Fix: `packages/core/src/orchestrator/quantum.ts:9` is now unanchored and covers
`pseudo|prng|mock|fake|math.random|random|dummy|stub|seeded?`, a superset of solana's
`packages/solana/src/quantum/provider.ts:39`. `local-prng`, `seeded-mock`, `qrng-fallback-fake` and
`stub` are refused by both under `NODE_ENV=production`. Now passing: `tests/04-quantum.test.ts:75`.

### F6 — FIXED (found at close-out): a host that refused the `<ticker>` slug left the CA off every page while the launch reported live
Fix: `packages/workers/src/builder/builder.ts` tracks `servedSlug` (the slug the host last
accepted) and, when a publish to a new slug fails, re-publishes to `servedSlug` with trigger
`<trigger>:fallback` and progress step `publish.fallback`; `packages/core/src/state/index.ts`
records `siteCaPublishedAt` on the first `Builder.published` after `coinCa`, and
`packages/core/src/orchestrator/launch.ts` `finalize()` emits `Launch.live` only when it is set,
otherwise `Launch.partial` ("coin deployed but the site never published the CA"). Evidence now
passing: `tests/06-ca-handshake.test.ts:221-272` (4/4). Original description follows.
`packages/workers/src/builder/builder.ts:144` moves `this.slug` to the ticker on `Ideator.named`
before the host has accepted that slug, and nothing ever moves it back: every later publish,
including the one triggered by `Launcher.deployed` (`:209`), targets the refused slug and ends in
`Builder.patchFailed`. The only page that exists is the t0 `q-<launchId>` page, frozen at "name
undetermined / CA: pending launch". The Voice correctly links only that existing page (the fix for
F3 holds: `06-ca-handshake.test.ts:242` passes), but the page it sends people to never shows the CA.
Core then emits `Launch.live` from `finalize()` (`launch.ts:280-286`) because no worker failed and
`state.siteUrl` was set by the t0 publish (`state/index.ts:149`), so the user sees "live" with a
site that says "pending launch".
Evidence (kept failing): `tests/06-ca-handshake.test.ts:250` (assert `:257`: the linked page must
carry the CA) and `:261` (assert `:268`: `Launch.live.siteUrl` must be a served page carrying the
CA, or the status must be `partial`). Trigger: a slug collision on the hosting provider or an outage
that begins after t0. Severity: NOTE — the CA in the post is right, the Builder is honest in its
events (`patchFailed` ×≥2), and a single failed republish self-heals (`:187`). Fix shape: set
`this.slug` from the slug the host actually served (revert on failure) or fall back to the last
accepted slug for the `Launcher.deployed` publish; and have `finalize()` require a
`Builder.published` after `coinCa` before claiming `live` (otherwise `partial`: "coin deployed but
the site never received the CA").

### N1 — NOTE (unchanged): gated methods throw synchronously
`packages/core/src/runtime/scopedClients.ts:79,84` (`x.post`, `x.thread`) and `:113,119`
(`solana.buy`, `solana.sell`) call `guard()` before any `await`, so `ApprovalRequired` is thrown, not
rejected, from methods typed `Promise<…>`. All current callers `await`; a `.catch()`-only caller
would crash. `tests/03-gates.test.ts` funnels calls through a microtask so both shapes are caught.

### N2 — NOTE (unchanged): `x.uploadMedia` / `x.updateProfile` are metered but not gated
`scopedClients.ts:88,93`. The Artist changes the avatar/banner post-launch without an approval
class; SPEC lists posts/trades/recruiting only, so this is spec-conformant but worth a decision.

### N3 — NOTE (unchanged): `createWorkers()` cannot inject the Artist's object store
`packages/workers/src/index.ts:114-134`: `CreateWorkersOptions` has voice/trader/shield/recruiter
only; the Artist needs `S3_*` env. `/tests` builds the Artist through `createArtist({store})`.

### N4 — RESOLVED as far as this container can tell: frametime context error
Run 3 of `packages/ui/scripts/frametime.ts` (this pass): zero "Chamber scene components must be
rendered inside <Chamber />" errors (`packages/ui/src/chamber/scene/context.ts:126`), exit 0. Run 1
had 66 of them, run 2 none. The drei `<Html>` separate-root caveat stands as a design note only.

### N5 — NOTE (still open, needs hardware): heap grows ~15% across a second launch in the harness
Run 3: 22.9MB after the first launch → 26.4MB after the second (+3.4MB, +15.0%); run 2 was +15.8%.
SPEC §6.7 says "no heap growth across a launch". Measured on SwiftShader with 6 rendered frames; the
script itself says the heap figures mean nothing here. Needs a run on real hardware.

### N6 — RESOLVED except the documented QSD gap
`pnpm --filter @quantagent/web typecheck`: exit 0 (the 15 errors from the first pass are gone).
`tsc -p tests/tsconfig.json`: only `packages/solana/src/qsd/index.ts:20-22` (`@qsd/*` not linked,
the documented QSD limitation); the `apps/web/src/server/service.ts:384,416` errors are gone.

## Randomness scan (check 4), every hit, file:line (re-run this pass; unchanged set)

All non-selection. Comment-only lines are excluded from the failing assertion but listed here.

| File:line | What | Class |
| --- | --- | --- |
| `packages/solana/src/wallet/crypto.ts:29` | `randomBytes(12)` AES-GCM IV for the wallet secret | non-selection |
| `packages/x/src/oauth/crypto.ts:48` | `randomBytes(12)` AES-GCM IV for tokens | non-selection |
| `packages/x/src/oauth/pkce.ts:24,29` | PKCE verifier and CSRF `state` | non-selection (must be unpredictable) |
| `packages/x/src/ratelimit/backoff.ts:25` | retry jitter | non-selection |
| `packages/x/src/ratelimit/dlq.ts:57` | dead-letter id suffix | non-selection |
| `packages/x/src/client/oauth1.ts:52` | OAuth 1.0a nonce | non-selection |
| `packages/workers/src/testing/fakes.ts:181` | fake post id (test-only, not exported from the index) | non-selection |
| `packages/ui/src/chamber/perf/dispose.ts:23` | comment describing `seeded()` (mulberry32) for vapour placement — a deterministic visual PRNG, never a selection | non-selection (comment) |
| `apps/web/src/server/service.ts:105` | `randomBytes(9)` launch id | non-selection |
| `@solana/web3.js Keypair.generate()` via `packages/solana/src/wallet/agentWallet.ts:72`, `pumpfun/launcher.ts:104` | agent wallet and mint keypairs | non-selection |

`packages/core/src`: zero hits. Selection paths (`core/orchestrator`, `core/runtime`, `core/state`,
`solana/quantum`, `solana/qsd`, every worker directory, `ui/chamber`): zero hits.

## X account-creation grep (check 5)

Pattern `signup|sign_up|sign-up|signUp|createAccount|create_account|users/create|account/create|accounts/create|provisionAccount|bulkConnect`
over every `packages/*/src`, `apps/web/src`, and tests: zero hits. `register*` hits are all the
QSD registration, the quantum-provider registry, the Shield's canonical CA, or comments. X endpoints
referenced by `packages/x/src`: posting, media, users/me, mentions, search, trends — none creates an
account. `launch()` now additionally refuses a client for any account other than the connected one
(F4).
