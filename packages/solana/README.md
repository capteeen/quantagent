# @quantagent/solana

The chain layer for quantagent (SPEC §7). Implements `SolanaClient` and
`QuantumClient` from `@quantagent/core/types/clients`.

```ts
import { createSolanaClient, createQuantumClient, PgKeyStore } from "@quantagent/solana";

const solana = await createSolanaClient({
  launchId,                      // one agent wallet per launch
  budgetSol: 0.5,                // hard cap on SOL the wallet may spend
  keyStore: new PgKeyStore(pool),// Postgres table agent_wallets (MemoryKeyStore for tests)
  cluster: "mainnet-beta",       // the default; pass "devnet" (or SOLANA_CLUSTER=devnet) to test without real SOL
  hub,                           // shared WebhookHub when Helius webhooks are used
});

const quantum = createQuantumClient();          // ANU QRNG; throws, never falls back
const proof = await quantum.draw({ candidateIds, context: "Ideator:name" });
```

## Public API

| Export | What it does |
| --- | --- |
| `createSolanaClient(opts)` → `SolanaClientHandle` | `SolanaClient` plus `wallet`, `rpc`, `hub`, `webhookHandler` |
| `createQuantumClient(opts?)` → `QuantumClient` | one verifiable draw per call, ANU QRNG by default |
| `resolveCluster`, `rpcUrlFor`, `createConnection`, `UnknownCluster`, `DEFAULT_CLUSTER` | cluster selection + RPC selection |
| `wallet/` `AgentWallet`, `KeyStore`, `MemoryKeyStore`, `PgKeyStore`, `encryptSecretKey`, `decryptSecretKey` | per-launch keypair, AES-256-GCM at rest, SOL budget on every signature |
| `pumpfun/` `PumpFunLauncher`, `createBody`, `buyBody`, `sellBody`, `collectCreatorFeeBody`, `requestTradeLocal`, `PinataUploader`, `PumpFunIpfsUploader` | PumpPortal local-transaction API |
| `discovery/` `CopycatFinder`, `phashImage`, `phashFromGray`, `hammingHex`, `searchCoins`, `recentCoins`, `getCoin` | pump.fun name/ticker/logo copycat search |
| `anomalies/` `AnomalyDetector`, `WebhookHub`, `createHeliusWebhookHandler`, `createWebhook`, `watchAnomalies`, `watchMilestones`, `heliusHolderCounter`, `rpcHolderCounter` | Helius webhooks, RPC polling fallback, milestones |
| `qsd/` `loadQsd`, `qsdLaunch`, `registerWithQsd` | declared boundary to qsd-market (`NotImplemented` until linked) |

### SolanaClient methods

- `qsdLaunch`, `registerWithQsd` — dynamically import `@qsd/crypto`, `@qsd/quantum`, `@qsd/protocol`. qsd-market is **not linked in this workspace**, so both throw `NotImplemented("QSD protocol", "qsd-market is not linked in this workspace")`. The Launcher treats this stage as optional. Ambient types live in `src/qsd/qsd.d.ts` and are unverified against the real packages.
- `deployPumpFun` — uploads logo + metadata, POSTs `action: "create"` to PumpPortal with the dev buy folded into the same transaction, signs with the fresh mint keypair and the agent wallet, sends and confirms. `devBuySignature === txSignature` because PumpPortal's create transaction carries the initial buy.
- `buy` / `sell` — `action: "buy"` (amount in SOL) / `action: "sell"` (amount `"<percent>%"`), `slippage = slippageBps / 100`, `priorityFee` from env. Every signature goes through the wallet budget check.
- `claimCreatorFees` — `action: "collectCreatorFee"` (documented at pumpportal.fun/creator-fee; pump.fun claims all creator fees for the wallet at once). Returned `sol` is the wallet's balance change after confirmation.
- `isNameTaken`, `findNameMatches` — pump.fun `/coins/search` for the name and the ticker; exact match after normalisation, name copycats by bigram Dice ≥ 0.8.
- `findLogoMatches({ phash, threshold })` — pHash of the `image_uri` of the newest `COPYCAT_RECENT_COINS` coins, hamming distance on hex. `threshold` > 1 is a max hamming distance (0–64); ≤ 1 is a minimum similarity. `score = 1 − distance/64`.
- `watchAnomalies` — Helius enhanced webhook when `HELIUS_API_KEY` + `HELIUS_WEBHOOK_URL` + `HELIUS_WEBHOOK_SECRET` are set (mount `handle.webhookHandler` on that URL), otherwise RPC polling every `ANOMALY_POLL_MS`. Flags `bundled-launch` (≥ `BUNDLE_MIN_BUYS` distinct wallets received the coin in the create slot) and `dev-wallet-anomaly` (creator moved coins within `DEV_SELL_WINDOW_MIN`).
- `watchMilestones` — polls market cap (`usd_market_cap` from pump.fun `/coins/{mint}`) and holders (Helius DAS `getTokenAccounts` with a key, else `getProgramAccounts` on the token program) every `MILESTONE_POLL_MS`; each threshold fires once, ascending.
- `balanceSol` — agent wallet balance.

### QuantumClient (`src/quantum`)

Provider interface `QrngProvider { name; fetchEntropy({ bytes }) }` with one real provider, **ANU Quantum Numbers**:

- `GET https://api.quantumnumbers.anu.edu.au/?length=32&type=uint8`, header `x-api-key: $ANU_QRNG_API_KEY`
- response `{ success: true, type, length, data: number[] }`; anything else throws `QrngUnreachable`
- `entropyHex` = the 32 bytes as hex; `drawHash = sha256(candidateIds.join(",") + ":" + entropyHex)`; `selectedIndex = BigInt(first 8 bytes) mod n`; `attestation` = JSON `{ requestUrl, requestedAt, receivedAt, rawResponse }`
- missing key → `NotImplemented("quantum draw", "ANU_QRNG_API_KEY not set", ["ANU_QRNG_API_KEY"])`
- unreachable / rate-limited → throws; the orchestrator shows candidates and the user picks
- **no fallback**: a test scans `src/quantum` for `Math.random`, `randomInt`, `randomBytes`, `randomUUID`, `getRandomValues`; providers named pseudo/mock/fake/prng/seeded are refused at registration in every `NODE_ENV`.
- `verifyProof(proof, candidateIds)` recomputes the derived fields.

ANU's free tier is small (their site lists per-month request quotas; not verified here) — one draw per collapse, so keep a paid key for production.

## Environment

| Var | Used by | Meaning |
| --- | --- | --- |
| `AGENT_WALLET_KEY` | wallet | **required**; 32 bytes as 64 hex chars; AES-256-GCM key for secret keys at rest |
| `SOLANA_CLUSTER` | cluster | `mainnet-beta` (default) or `devnet`; anything else throws `UnknownCluster` |
| `SOLANA_RPC_URL` | cluster | RPC endpoint; default `https://api.mainnet-beta.solana.com` (mainnet) / `https://api.devnet.solana.com` (devnet); use a paid RPC such as Helius in production |
| `HELIUS_API_KEY` | cluster, anomalies, milestones | optional; selects Helius RPC when `SOLANA_RPC_URL` is unset, enables DAS holder counts and webhooks |
| `HELIUS_WEBHOOK_URL` | anomalies | public URL Helius posts to (the app mounts `webhookHandler` there) |
| `HELIUS_WEBHOOK_SECRET` | anomalies | sent as `authHeader`; the handler compares `Authorization` in constant time |
| `HELIUS_WEBHOOK_API` | anomalies | override of `https://api.helius.xyz/v0/webhooks` |
| `ANU_QRNG_API_KEY` | quantum | ANU Quantum Numbers API key |
| `ANU_QRNG_API_URL` | quantum | override of `https://api.quantumnumbers.anu.edu.au/` |
| `PUMPPORTAL_URL` | pumpfun | override of `https://pumpportal.fun/api/trade-local` (a devnet-capable endpoint is the only devnet path, see below) |
| `PUMPPORTAL_PRIORITY_FEE_SOL` | pumpfun | priority fee per tx, default `0.0005` |
| `PUMPPORTAL_POOL` | pumpfun | `pool` for buy/sell, default `pump` |
| `PINATA_JWT`, `PINATA_GATEWAY` | pumpfun | metadata/image host for token creation (what PumpPortal's current examples use) |
| `PUMPFUN_IPFS_URL` | pumpfun | opt into the legacy `https://pump.fun/api/ipfs` multipart upload |
| `PUMPFUN_API_URL`, `PUMPFUN_API_JWT` | discovery, milestones | frontend API base (default `https://frontend-api-v3.pump.fun`) and optional bearer |
| `COPYCAT_RECENT_COINS` | discovery | coins hashed per logo search, default `200` |
| `ANOMALY_POLL_MS` | anomalies | polling interval without Helius webhooks, default `15000` |
| `BUNDLE_MIN_BUYS`, `BUNDLE_SLOT_WINDOW`, `DEV_SELL_WINDOW_MIN` | anomalies | defaults `3`, `0`, `30` |
| `MILESTONE_MCAP_USD` | milestones | default `10000,50000,100000,1000000` |
| `MILESTONE_HOLDERS` | milestones | default `100,500,1000` |
| `MILESTONE_POLL_MS` | milestones | default `30000` |
| `NODE_ENV` | quantum | `production` is named in the refusal message for pseudo providers (they are refused everywhere) |

## Endpoints

| Endpoint | Used for | Verified |
| --- | --- | --- |
| `POST https://pumpportal.fun/api/trade-local` | create / buy / sell / collectCreatorFee | fields and semantics read from pumpportal.fun docs on 2026-10-09 |
| `https://uploads.pinata.cloud/v3/files` | logo + metadata JSON for creation | PumpPortal's creation page says to use Pinata; exact v3 response (`data.cid`) from memory, `IpfsHash` also accepted |
| `https://pump.fun/api/ipfs` | legacy metadata upload | PumpPortal docs call it unsupported; kept as opt-in |
| `GET https://frontend-api-v3.pump.fun/coins?…sort=created_timestamp` | recent coins for logo search | live response field list verified |
| `GET …/coins/search?searchTerm=` | name/ticker search | params from third-party references; both `[]` and `{ data }` shapes handled |
| `GET …/coins/{mint}` | creator, bonding curve, `usd_market_cap` | third-party reference |
| `GET https://api.quantumnumbers.anu.edu.au/?length&type` | quantum entropy | URL, params, `x-api-key`, `success/data/message` from ANU's published examples |
| `POST/DELETE https://api.helius.xyz/v0/webhooks` | anomaly webhooks | body field list and `webhookType` enum from the Helius API reference |
| Helius RPC `getTokenAccounts` | holder counts | request/response fields from the Helius DAS reference |

## Cluster

Mainnet-beta is the default, with no flag: pump.fun only exists there. Devnet is used only when asked for explicitly (`cluster: "devnet"` or `SOLANA_CLUSTER=devnet`); an unknown cluster name throws `UnknownCluster`. A wallet created on one cluster refuses to open on the other. Real SOL is protected by the per-launch SOL budget (`AgentWallet.signAndSend` refuses before signing), the approval gates on every trade beyond the dev buy, and per-coin autopilot opt-ins.

## Devnet caveats (only when devnet is requested)

- **PumpPortal is mainnet-only.** Its FAQ: *"We currently don't provide APIs for devnet or testnet."* pump.fun publishes one program address (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) with no devnet deployment we could verify. So on devnet `deployPumpFun` / `buy` / `sell` / `claimCreatorFees` throw `NotImplemented("pump.fun …", …, ["PUMPPORTAL_URL=…", "or the default cluster mainnet-beta (unset SOLANA_CLUSTER)"])`.
- The devnet path, when you want one: run a devnet fork of the pump program plus a transaction builder with the same `trade-local` contract and point `PUMPPORTAL_URL` at it. Everything else (wallet, budget, balances, discovery against pump.fun's public API, anomaly polling via RPC, milestone polling) works on devnet as-is.
- Helius webhooks use `webhookType: "enhancedDevnet"` on devnet.
- The polling anomaly path derives token flows from `preTokenBalances`/`postTokenBalances`; the Helius path uses `tokenTransfers` from enhanced transactions.

## Per-launch SOL cost estimate (mainnet)

| Item | SOL |
| --- | --- |
| pump.fun create (mint rent, bonding-curve accounts, network fee) | ~0.02–0.03 (reserved as `CREATE_OVERHEAD_SOL = 0.03`) |
| Dev buy | `devBuySol` + 0.5% PumpPortal local fee + pump.fun bonding-curve fee (~1%) |
| Each later buy | `sol` × 1.005 + priority fee + ~0.0001 network fee |
| Each sell / fee claim | priority fee + ~0.0001 network fee |
| Priority fee (default) | 0.0005 per tx |

A launch with a 0.1 SOL dev buy and two 0.05 SOL buys costs roughly 0.24 SOL plus pump.fun's own fees. The wallet reserves a conservative estimate before signing and reconciles to the real balance change after confirmation, so `wallet.spentSol` reflects what actually left.

## Agent wallet security

- Keypair generated with `Keypair.generate()` on the server, never shown to the user.
- Secret key encrypted with AES-256-GCM, launch id as AAD, random 96-bit nonce per blob.
- `AgentWallet.signAndSend` is the only signing path; it reserves the estimated cost atomically in the KeyStore (single guarded `UPDATE` in Postgres) and throws `BudgetExceeded(worker, "sol", limit, used)` before signing when the cap would be exceeded.

## Scripts

```
pnpm --filter @quantagent/solana test
pnpm --filter @quantagent/solana typecheck
pnpm --filter @quantagent/solana build
```
