# @quantagent/workers

The eight quantagent workers. This README covers the package contract and the four
launch-time workers owned by B1 (Ideator, Artist, Builder, Launcher); Voice, Trader,
Shield and Recruiter (B2) document themselves in their folders and are merged into
`src/index.ts` by the integrator.

```
pnpm --filter @quantagent/workers test
pnpm --filter @quantagent/workers typecheck
pnpm --filter @quantagent/workers build
```

## Runtime contract

Workers implement `Worker` from `@quantagent/core` (`packages/core/src/runtime/worker.ts`).
`src/context.ts` re-exports those types so every worker folder imports one place:

```ts
import type { Worker, WorkerContext, StartResult } from "../context";
```

- `start(ctx)` runs at t=0 from the prompt alone and may return a `Record` of outputs,
  which core records on `Worker.done`.
- `on(event, ctx)` receives every event of the launch; dependencies are subscriptions.
- Failure = throw. Core emits `Worker.failed` with the error's one-line text, including
  `NotImplemented`'s env-var list. Workers never emit `Worker.started/done/failed`
  themselves.
- `ctx.collapse(candidates, reason)` emits `Worker.candidates` and resolves on
  `Orchestrator.collapsed` (quantum draw) or `Orchestrator.userPicked`.
- `ctx.clients.*` are budget-scoped by core (`null` when the integrator did not wire one);
  `requireClient(ctx, key, capability)` throws `NotImplemented` naming the env vars.
- Gated calls (`x.post/thread`, `solana.buy/sell`) are enforced by core: one
  `ctx.requireApproval` per post/trade. None of B1's workers call a gated method; the dev
  buy inside `solana.deployPumpFun` is not gated.

Every emit carries a one-line human `reason`. Nothing is faked: a missing client, key or
repo is a `NotImplemented` failure; a failed generation / publish / deploy is logged as
exactly that.

## Public API (`src/index.ts`)

| Export | What |
| --- | --- |
| `createIdeator(opts?)`, `IdeatorWorker` | B1 Ideator |
| `createArtist(opts?)`, `ArtistWorker` | B2 Artist |
| `createBuilder(opts?)`, `BuilderWorker` | B3 Builder |
| `createLauncher()`, `LauncherWorker` | B4 Launcher |
| `createLaunchWorkers()` | fresh instances of the four, one set per launch |
| `imageClientFromEnv()`, `createOpenAiImageClient`, `createFalImageClient`, `createReplicateImageClient` | `ImageClient` adapters |
| `objectStoreFromEnv()`, `createS3Store` | S3-compatible object storage |
| `hostingClientFromEnv()`, `createCloudflareHosting`, `createVercelHosting` | `HostingClient` adapters |
| `render(siteState)`, `renderOgSvg()` | pure site template + OG image |
| `checkContent`, `assertContentOk`, `checkIdentityConstraints` | content / identity rules (in code) |
| `phashFromBytes`, `phashFromUrl`, `hammingDistance`, `phashSimilarity` | perceptual hash (DCT, 32×32 grayscale) |
| `findBase58Addresses`, `isBase58Address` | "the CA is never wrong" helpers |

The integrator wires clients into core's `ClientsInput`, e.g.
`{ llm, x, solana, quantum, image: imageClientFromEnv(), hosting: hostingClientFromEnv() }`.

## Workers

### Ideator (`src/ideator`)
Pulls live trends (`ctx.clients.x.trends()`), asks the injected `LlmClient` for
candidates (zod-validated), enforces in code: ticker ≤ 6 chars `[A-Z0-9]`, real-person
deny-list **plus** an LLM real-person check, protected-brand deny-list, and pump.fun
availability via `solana.isNameTaken`. Re-asks up to `maxRounds` (3) until 5 candidates
pass. `ctx.collapse` → `Ideator.named { identity }`. Post-launch: `Voice.needsAngle` →
`Ideator.angles` (3 angles from mentions + chart milestones).

### Artist (`src/artist`)
At t=0 renders N (default 4) logo candidates from the prompt in distinct style
directions → `Worker.candidates` → quantum draw. When `Ideator.named` arrives the drawn
style is re-rendered with the final name → `Artist.logoReady`; then the banner
(`Artist.bannerReady`, 1500×500) and 6–12 character images (`Artist.imageReady` each, in
parallel lanes). Content rules (`rules.ts`: no real people, no protected characters or
brands, nothing sexual or violent) run in code before **every** provider call; the
prompt itself is checked first. Every output goes through object storage and is
emitted as a public url with a pHash. A failed generation emits
`Artist.generationFailed` and is never replaced. Post-launch: `Voice.needsImage` /
`Builder.needsAsset` → one image.

Providers (`src/artist/providers`, selected by `IMAGE_PROVIDER`): `openai`
(gpt-image-1 REST), `fal` (`FAL_MODEL`, default `fal-ai/flux/dev`), `replicate`
(`REPLICATE_MODEL`, default `black-forest-labs/flux-schnell`). pHash uses `sharp`
(fallback `jimp`); if neither loads the asset is emitted without a hash and the reason is
logged. Banner output is cover-cropped to 1500×500 with sharp when the provider cannot
render that size.

### Builder (`src/builder`)
Publishes the static single-page template (`template.ts`: void `#06080A`, glass, JetBrains
Mono, inline CSS, no JS build) at t=0 with `CA: pending launch` and a live indicator,
under the slug `q-<launchId>`; on `Ideator.named` it moves to `<ticker>` and republishes.
Patches on `Artist.logoReady` (favicon/hero/OG), `Artist.bannerReady`,
`Artist.imageReady` (gallery), `Launcher.deployed` (CA block, `https://pump.fun/coin/<ca>`
buy button, dexscreener chart embed), `Voice.posted` (feed + announcement thread embed),
`Chain.milestone` (stat strip), `Shield.copycatFound` ("verify the real CA" banner).
Publishes are serialized and coalesced; each emits `Builder.published { url, deployId,
trigger }`, a failure emits `Builder.patchFailed { trigger, error }`. The OG image is an
SVG (`og.svg`, logo + ticker) published as an asset next to the page. `start()` returns
after the CA republish so `Worker.done` means "the real CA is on the site".
`createBuilder({ customDomain })` connects a user-owned domain through the provider's
domains API after the first publish.

Hosting (`src/builder/hosting`, selected by `HOSTING_PROVIDER`):
- `cloudflare` — Pages Direct Upload: upload-token → `check-missing` → `upload` →
  `upsert-hashes` → deployment from a manifest (blake3 file hashes, the flow `wrangler
  pages deploy` uses). One Pages project per slug (`<CF_PAGES_PROJECT>-<slug>`, created on
  demand); with `SITE_DOMAIN` the subdomain `<slug>.<SITE_DOMAIN>` is attached (the zone
  must be on Cloudflare).
- `vercel` — `POST /v13/deployments` with inline files, polled to `READY`; one project per
  slug; subdomain attached via `/v10/projects/{name}/domains` when `SITE_DOMAIN` is set.

Note: X unfurls PNG/JPEG OG images most reliably; the SVG OG is what the spec asked for and
can be rasterized by the integrator later.

### Launcher (`src/launcher`)
Waits for `Ideator.named` and `Artist.logoReady` (either order). Calls
`solana.qsdLaunch` inside `try`: when it throws `NotImplemented` (QSD is out of scope by
the user's decision) it emits `Worker.progress { step: "qsd-skipped", detail: { reason } }`
with reason `QSD protocol not linked; launching on pump.fun without the cryptographic
sequence` and continues; any other error fails the worker. When QSD runs, every stage
is emitted (`Launcher.qsdStage`, `chainStep`, `treeLevelFused`, `signChainStop`) and the
CA is registered with QSD afterwards. Then `solana.deployPumpFun` with the dev buy
(`options.devBuySol`, default 0.1) → `Launcher.deployed { coinCa, txSignature,
identityRoot }` (`identityRoot` is `""` when QSD was skipped) and `Launcher.devBuy`. A
malformed mint address is refused, never announced.

## Tests

`src/testing/fakes.ts` is a test-only harness that runs a worker through the **real**
core runtime (`EventBus` + `ApprovalGate` + `WorkerRun`) with in-test fake clients, so
tests exercise the same lifecycle, budget scoping and collapse protocol the orchestrator
uses. Provider and hosting adapters are tested against a recording `fetch` stub. Nothing in
the test suite touches a network.

## Environment

Read via `process.env`. A missing variable is a `NotImplemented` naming it.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `IMAGE_PROVIDER` | Artist | `openai` \| `fal` \| `replicate` |
| `OPENAI_API_KEY` | Artist (openai) | OpenAI key |
| `OPENAI_IMAGE_MODEL` | Artist (openai) | optional, default `gpt-image-1` |
| `OPENAI_BASE_URL` | Artist (openai) | optional, default `https://api.openai.com/v1` |
| `FAL_KEY` | Artist (fal) | fal.ai key |
| `FAL_MODEL` | Artist (fal) | optional, default `fal-ai/flux/dev` |
| `REPLICATE_API_TOKEN` | Artist (replicate) | Replicate token |
| `REPLICATE_MODEL` | Artist (replicate) | optional, default `black-forest-labs/flux-schnell` |
| `S3_ENDPOINT` | Artist storage | S3-compatible endpoint (R2 / MinIO / AWS) |
| `S3_BUCKET` | Artist storage | bucket name |
| `S3_ACCESS_KEY` | Artist storage | access key id |
| `S3_SECRET_KEY` | Artist storage | secret access key |
| `S3_PUBLIC_URL` | Artist storage | public base url the bucket is served from |
| `S3_REGION` | Artist storage | optional, default `auto` |
| `HOSTING_PROVIDER` | Builder | `cloudflare` \| `vercel` |
| `CF_API_TOKEN` | Builder (cloudflare) | API token with Pages:Edit |
| `CF_ACCOUNT_ID` | Builder (cloudflare) | account id |
| `CF_PAGES_PROJECT` | Builder (cloudflare) | project name prefix (`<prefix>-<slug>`) |
| `VERCEL_TOKEN` | Builder (vercel) | access token |
| `VERCEL_PROJECT` | Builder (vercel) | project name prefix (`<prefix>-<slug>`) |
| `VERCEL_TEAM_ID` | Builder (vercel) | optional team id |
| `SITE_DOMAIN` | Builder (both) | optional, e.g. `quantagent.site`; sites get `<slug>.<SITE_DOMAIN>` |

Clients the integrator wires from other packages (named in `CLIENT_NEEDS` when missing):
`LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` (LlmClient); `X_CLIENT_ID`, `X_CLIENT_SECRET`
(@quantagent/x); `SOLANA_RPC_URL`, `SOLANA_CLUSTER`, `AGENT_WALLET_SECRET_KEY`
(@quantagent/solana); `QSD_QUANTUM_ENDPOINT`, `QSD_QUANTUM_API_KEY` (QuantumClient).
