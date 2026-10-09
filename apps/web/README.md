# @quantagent/web

The phone-first Next.js app: THE SCREEN at `/`, deep-linked launches, coin pages, `/me`, `/status`, `/how`, and the single in-process orchestrator behind `/api/*`. Everything the user sees is reduced from the launch's event log; nothing is invented, and every missing capability shows its `NotImplemented` message with the exact env var names.

## Scripts

| script | what |
| --- | --- |
| `pnpm --filter @quantagent/web dev` | `next dev` |
| `pnpm --filter @quantagent/web build` | `next build` |
| `pnpm --filter @quantagent/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @quantagent/web test` | vitest (server service, routes, SSE resume, LLM adapters, session cookie, "the CA is never wrong" over the rendered screens) then the Playwright smoke test at 390×844 (`scripts/e2e.mjs`; prints a reason and exits 0 when Chromium cannot run) |
| `pnpm --filter @quantagent/web test:unit` / `test:e2e` | either half alone |

## Routes

| route | handler |
| --- | --- |
| `/` | THE SCREEN: chamber, X + wallet ConnectCards (chips once connected), PromptBox, LaunchButton, cost line; after the tap: ThreadStrip, ApprovalCards, WorkerSheet, CoinCard sliding in on the chamber's `onLive` |
| `/launch/[id]` | the same screen deep-linked, with the full LogRow log |
| `/coin/[ca]` | chamber in coin mode, CoinCard, Voice feed, Trader log, Shield report, Recruiter outreach, site status + patch log, AutopilotToggle, budgets, decay status, full log |
| `/me` | connected X account, launches, agent wallets, pending approvals |
| `/status` | every provider's health, store kinds, X API status, hosting, queue, cost line |
| `/how` | the repo's `/docs/*.md` rendered verbatim at request time |
| `POST /api/launch` | `{ prompt, ownerWallet, options? }` → `201 { id, clients }`; the X account comes from the session cookie only |
| `GET /api/launch/[id]` | `{ meta, state, pendingApprovals, seq, events }` (state is `rebuild(log)`) |
| `GET /api/launch/[id]/events` | SSE from `bus.toSSE`; resumes from `Last-Event-ID` or `?after=` |
| `POST /api/launch/[id]/approve` | `{ approvalId, decision: approve\|edit\|skip, draft? }` |
| `POST /api/launch/[id]/pick` | `{ worker, candidateId }` when the QRNG was unavailable |
| `POST /api/launch/[id]/autopilot` | `{ posts?, trades?, recruiting? }` |
| `GET /api/me`, `GET /api/status` | the reports behind `/me` and `/status` |
| `GET\|POST /api/x/oauth/start`, `GET /api/x/oauth/callback`, `POST /api/x/disconnect` | X OAuth via `@quantagent/x`; the session cookie (`qa_session`, HMAC-signed) holds only the connected account id |
| `POST /api/helius/webhook` | forwarded to the solana package's webhook handler |

## Environment

Every variable this package reads (`process.env`). `apps/web/.env.example` lists the whole system's, grouped by package.

| variable | read by | meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `src/server/llm.ts` | `anthropic` \| `openai`; unset → `NotImplemented` |
| `ANTHROPIC_API_KEY` | llm | Anthropic Messages API key |
| `ANTHROPIC_BASE_URL` | llm | optional, default `https://api.anthropic.com` |
| `OPENAI_API_KEY` | llm | OpenAI-compatible chat key |
| `OPENAI_BASE_URL` | llm | optional, default `https://api.openai.com/v1` |
| `LLM_API_KEY` | llm | optional generic key when the provider-specific one is unset |
| `LLM_MODEL` | llm | optional, default `claude-sonnet-4-5` / `gpt-4o-mini` |
| `SESSION_SECRET` | `src/server/session.ts` | HMAC key for `qa_session`; falls back to `X_TOKEN_KEY`; missing → `NotImplemented` |
| `X_TOKEN_KEY` | session (fallback) | see `@quantagent/x` |
| `SOLANA_CLUSTER` | `src/server/service.ts` | `devnet` (default) \| `mainnet-beta` (needs `QUANTAGENT_MAINNET=true`) |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `src/lib/wallet.tsx` | cluster the browser wallet adapter requests |
| `LAUNCH_DEV_BUY_SOL` | `src/server/cost.ts` | optional dev buy, default `DEFAULT_DEV_BUY_SOL` (0.1) |
| `TRADER_BUDGET_SOL` | cost | optional Trader budget, default `DEFAULT_BUDGETS.Trader.sol` |
| `PUMPPORTAL_PRIORITY_FEE_SOL` | cost | shown in the cost line, default 0.0005 |
| `DATABASE_URL` | `src/server/clients.ts` | Postgres for the agent wallet key store (`PgKeyStore`); unset → in-memory keys (lost on restart, said so on `/status`) |
| `HELIUS_API_KEY`, `SOLANA_RPC_URL`, `PUMPPORTAL_URL`, `AGENT_WALLET_KEY` | status | only inspected for the `/status` solana health line; read for real by `@quantagent/solana` |
| `NODE_ENV` | session, status | `production` marks cookies `Secure` |
| `PLAYWRIGHT_BROWSERS_PATH`, `PW_CHROMIUM_PATH`, `SKIP_E2E`, `E2E_PORT` | `scripts/e2e.mjs`, `playwright.config.ts` | test-only |

The orchestrator also hands `process.env` to `@quantagent/core` (`DATABASE_URL`, `REDIS_URL`), `@quantagent/workers` (image + hosting providers), `@quantagent/x` and `@quantagent/solana`; their READMEs list those.

## Shape

- `src/server/` — `OrchestratorService` (launch registry, `launch()` + `createWorkers()` from core/workers, per-launch X and Solana clients, post-launch runtime via `startPostLaunch` when `REDIS_URL` is set), `clients.ts` (every shared client built once from env; failures become `Unavailable` with `needs`), `llm.ts` (Anthropic Messages + OpenAI-compatible adapters implementing core's `LlmClient`, JSON schema enforced by validation), `handlers.ts` (route handlers), `session.ts`, `docs.ts`, `cost.ts`.
- `src/lib/` — fetch-based SSE client with `Last-Event-ID` resume, the Zustand launch store (incremental `reduce` from `@quantagent/core-state`), wallet context (Solana Mobile Wallet Adapter first, standard wallets as fallback).
- `src/components/` — the screens, built only from `@quantagent/ui` kit and chamber components.
- Launches live in this process: a restart drops running launches (their logs stay in the event store when `DATABASE_URL` is set, and `/launch/[id]` says the launch is unknown otherwise).
