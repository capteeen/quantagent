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

## What is devnet-only, and the one thing that is not devnet at all

Everything runs on devnet by default: agent wallets, budgets, the quantum draw,
copycat scans, milestones, anomaly detection, site publishing, X posting.

The exception is the pump.fun deploy itself. pump.fun has no devnet and PumpPortal's
FAQ states mainnet only. On devnet `deployPumpFun` therefore throws a clear
`NotImplemented` naming the two ways out:

1. `PUMPPORTAL_URL` pointed at a devnet-capable endpoint that speaks the same
   trade-local contract (for example a fork of pump.fun's program on devnet), or
2. `QUANTAGENT_MAINNET=true` with cluster `mainnet-beta`, which is a real launch
   with real SOL.

The Launcher surfaces this as a worker failure with the reason; the Builder then
publishes an honest "launch failed" block instead of a CA. So the spec's "real
devnet coin" is not possible as written; a first real launch is a mainnet launch.

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

## Exact environment variables for a mainnet launch

Copy `apps/web/.env.example` (every variable, grouped by package, with comments)
and set at least these:

```
# cluster
QUANTAGENT_MAINNET=true
SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
AGENT_WALLET_KEY=<64 hex chars>          # AES-256-GCM key for agent wallets
LAUNCH_DEV_BUY_SOL=0.1
TRADER_BUDGET_SOL=0.2

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
| SOL | ~0.24 | 0.1 dev buy + two 0.05 support buys + create overhead (~0.03) + 0.5% PumpPortal fee + priority fees; pump.fun's ~1% curve fee on top |

Hosting on Cloudflare Pages or Vercel fits their free tiers at this volume. The X
Free tier allows posting but not search or mentions; the Basic tier is needed for
the Shield, Recruiter and mention replies, and the monthly call budget pauses
posting at 100%.
