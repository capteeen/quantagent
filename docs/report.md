# Integrator report

Build of quantagent per SPEC.md, delivered on `main` of capteeen/quantagent.
Seven packages, every suite green: core 37, x 75, solana 49, workers 117, ui 122,
web 21 + phone smoke, verify 139 (560 tests). The adversarial pass (docs/audit-log.md)
found six defects over two rounds; all six are fixed and re-verified.

## What works end to end (in process, with fake providers)

Running `launch()` with the eight real workers and in-test fake clients:

- All eight workers start within 100 ms of each other and run concurrently; a dead
  worker never takes another down, and the launch settles as `partial` with the
  dead one named.
- Multi-candidate outputs (five identities, four logos) collapse through one
  quantum draw each, with the proof bundle recorded on the event and shown in the
  WorkerSheet. If the QRNG is unreachable or unconfigured, candidates are shown and
  the user picks; the UI says why. No pseudorandom path exists.
- Nothing posts, reaches out or trades without a tap or an enabled autopilot flag:
  the gate lives inside the scoped X and Solana clients, so a worker cannot bypass it.
- The CA handshake: on `Launcher.deployed`, the Builder republishes, the Voice's
  pre-drafted CA post finalizes, and the Shield registers the canonical CA, all well
  inside 5 s. Every rendered surface (site HTML, posts, shield report, launch state)
  contains no contract address other than the deployed one.
- Budgets fail only the worker that exceeded them. Every action carries a one-line
  reason and its external ids (tx signature, post id, image url, deploy id).
- `rebuild(log)` reproduces the live Launch state exactly, and the chamber store
  reproduces the same visual state from the same log; an empty stream moves nothing.
- The web app: X OAuth connect, wallet connect, the one screen, SSE with resume,
  approval cards, user pick, autopilot toggles, launch/coin/me/status/how pages,
  the chamber mounted live, footer on every screen.

## Cluster: mainnet by default

By your decision on 2026-10-09 everything targets Solana mainnet-beta by default, with no
flag: the RPC, agent wallets, the pump.fun deploy and dev buy, Trader buys, Shield scans,
anomaly detection, milestones, explorer links and the browser wallet adapter. Devnet is
only used when asked for explicitly (`SOLANA_CLUSTER=devnet`), for testing wallets and
watchers without real SOL; pump.fun has no devnet, so a deploy there fails with a clear
`NotImplemented`.

Every spend safeguard is unchanged: the per-launch agent wallet has a hard SOL budget
enforced before signing, every Trader buy beyond the dev buy needs your tap unless you
enable trades autopilot for that coin, posts and outreach are gated the same way, and the
agent wallet holds only what you fund it with.

The QSD protocol (qsd-market) is out of scope by your instruction. The chain package
keeps a declared boundary (`loadQsd()`) that reports itself unlinked; the Launcher
skips that stage with a logged reason and the chamber renders the launcher handoff
only when those events exist.

## What Agent G left open

No blocking findings. Notes that remain:

- Frame time and heap growth of the chamber could not be measured here: the build
  machine has no GPU (software GL renders about one frame every 22 s). The harness
  (`pnpm --filter @quantagent/ui frametime`) asserts the 55 fps median and heap
  budget on any machine with a GPU.
- Real X, image provider, hosting, Helius, ANU QRNG and PumpPortal calls are
  implemented against their current documented request shapes but were not
  exercised live (no keys in the build environment). pump.fun's search/coin
  endpoints and the Pinata response shape are the least certain; see the solana
  README.
- The chamber's spec camera leaves six of eight anchors outside a 390 px frame; the
  app uses `framing="fit"`. Either keep that or move one spec number.
- `uploadMedia` and `updateProfile` on the X client are metered but not gated
  (they do not publish text). Launch registry is in-process; a restart forgets
  in-flight launches unless `DATABASE_URL` is set for the event store.

## Where to host it

A launch lives in one long-lived Node process for minutes to hours. Run the web app with
`next start` on a long-lived host (Railway, Render, Fly.io or a VM) with managed Postgres
and Redis for real launches. On Vercel the pages, wallet connect and the
status/how/coin/me pages work, X connect works but can need a retry (its PKCE verifier
is held in memory), and creating a launch returns a 501 `NotImplemented` naming the
long-lived host it needs (see apps/web/README.md, "Deploy").

## Exact environment variables for a mainnet launch

Copy `apps/web/.env.example` (every variable, grouped by package, with comments)
and set at least these:

```
# cluster (mainnet-beta is the default; these two lines are optional)
SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...   # a paid RPC; the public one rate-limits
AGENT_WALLET_KEY=<64 hex chars>          # AES-256-GCM key for agent wallets
LAUNCH_DEV_BUY_SOL=0.1
TRADER_BUDGET_SOL=0.1

# pump.fun via PumpPortal
PINATA_JWT=...                           # token metadata upload
PUMPPORTAL_PRIORITY_FEE_SOL=0.0005

# quantum draw
ANU_QRNG_API_KEY=...

# language model
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
LLM_MODEL=claude-sonnet-4-5

# images + storage
IMAGE_PROVIDER=openai                    # or fal | replicate
OPENAI_API_KEY=...
S3_ENDPOINT=... S3_BUCKET=... S3_ACCESS_KEY=... S3_SECRET_KEY=... S3_PUBLIC_URL=...

# site hosting
HOSTING_PROVIDER=cloudflare              # or vercel
CF_API_TOKEN=... CF_ACCOUNT_ID=... CF_PAGES_PROJECT=...
SITE_DOMAIN=quantagent.site

# X (the project's own account, OAuth 2.0 user context)
X_CLIENT_ID=... X_CLIENT_SECRET=... X_REDIRECT_URI=https://<host>/api/x/oauth/callback
X_TOKEN_KEY=<64 hex chars>
X_MONTHLY_CALL_BUDGET=1500

# persistence + post-launch runtime
DATABASE_URL=postgres://...
REDIS_URL=redis://...
SESSION_SECRET=<random>

# shield + milestones (optional but recommended)
HELIUS_API_KEY=... HELIUS_WEBHOOK_URL=https://<host>/api/helius/webhook HELIUS_WEBHOOK_SECRET=...
```

## Per-launch cost (estimates, before post-launch activity)

| Resource | Per launch | Notes |
| --- | --- | --- |
| LLM calls | 3–6 | Ideator 1–3 rounds, Recruiter ranking + drafts, Voice replies later |
| Image generations | 12–18 | 4 logo candidates, 1 named logo, 1 banner, 6–12 characters |
| QRNG draws | 2 | one per collapse (identity, logo) |
| X API calls | ~12–20 | thread (3 posts, 2 media uploads), CA post, avatar + banner, shield and recruiter searches |
| Hosting publishes | 6–10 | t=0, named, logo, images (coalesced), deployed, thread embed |
| Solana RPC | tens | confirmations, balance reconcile, holder counts |
| SOL | ~0.13 at launch, up to ~0.23 | see the SOL breakdown below |

### SOL for a first mainnet launch (defaults)

| Item | SOL | When |
| --- | --- | --- |
| pump.fun create (mint rent, bonding-curve accounts, network fee) | ~0.02–0.03 | at launch |
| Priority fee | 0.0005 per transaction | every transaction |
| Dev buy (`LAUNCH_DEV_BUY_SOL`) | 0.1 | at launch, folded into the create transaction |
| PumpPortal fee 0.5% + pump.fun curve fee ~1% on the dev buy | ~0.0015 | at launch |
| **Spent at launch** | **~0.13** | |
| Trader budget (`TRADER_BUDGET_SOL`) | up to 0.1 | later, only on approved support buys (or trades autopilot) |
| **Agent wallet funding the app asks for** | **0.2305** | 0.0305 launch + 0.1 dev buy + 0.1 Trader budget |

The dev buy buys the coin, so most of that 0.1 SOL sits in the agent wallet as tokens,
not as a fee. Unspent Trader budget stays in the agent wallet.

Hosting on Cloudflare Pages or Vercel fits their free tiers at this volume. The X
Free tier allows posting but not search or mentions; the Basic tier is needed for
the Shield, Recruiter and mention replies, and the monthly call budget pauses
posting at 100%.
