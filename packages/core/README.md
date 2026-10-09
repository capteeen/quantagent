# @quantagent/core

Orchestrator, worker runtime, typed event bus and launch state for quantagent.
Everything a worker does is an event on the bus; everything the UI shows is a
reduction of that log. There is no mock, fallback or seeded path in this package.

```
pnpm --filter @quantagent/core test       # vitest
pnpm --filter @quantagent/core typecheck  # tsc --noEmit
```

## Imports

| Specifier | What |
| --- | --- |
| `@quantagent/core` | runtime API below |
| `@quantagent/core/types` | shared types, events and errors (`WorkerName`, `Launch`, `QuantagentEvent`, `NotImplemented`, `BudgetExceeded`, `ApprovalDenied`, `ApprovalRequired`, ...) |
| `@quantagent/core/types/clients` | client interfaces workers receive: `LlmClient`, `ImageClient`, `XClient`, `SolanaClient`, `HostingClient`, `QuantumClient` |

## Orchestrator

```ts
import { launch } from "@quantagent/core";

const handle = await launch(prompt, { xAccountId, ownerWallet }, options, {
  workers,        // all eight Worker implementations (one per WorkerName)
  clients,        // { llm, image, x, solana, hosting, quantum } — missing ones are null in ctx
  bus,            // optional: a shared EventBus (createBusFromEnv); default in-memory
  env, clock, launchId, // optional
});
```

`launch()` emits `Launch.started`, then issues all eight `start(ctx)` calls in one
synchronous loop over isolated `WorkerRun`s and gathers them with
`Promise.allSettled`. It resolves as soon as every `start()` has been invoked.

`LaunchHandle`:

| Member | Meaning |
| --- | --- |
| `id`, `bus`, `gate`, `runs` | launch id, its `EventBus`, its `ApprovalGate`, per-worker `WorkerRun`s |
| `getState(): Launch` | live state: the reduction of every event so far |
| `getStartTimings()` | `{ byWorker, firstMs, lastMs, spreadMs }` from a monotonic clock; `spreadMs` is the distance between the first and last `start()` |
| `settled: Promise<Launch>` | resolves after every `start()` settled and the final `Launch.live` / `Launch.partial` / `Launch.failed` was emitted; never rejects |
| `userPick(worker, candidateId)` | after `Orchestrator.collapseUnavailable`, the user's choice; emits `Orchestrator.userPicked` |
| `resolveApproval(id, "approve" \| "edit" \| "skip", editedDraft?)` | the user's tap on an ApprovalCard |
| `pendingApprovals()` | `ApprovalRequest[]` waiting for a tap |
| `setAutopilot(patch)` | per-coin, per-action opt-in; logged as `Launch.autopilotChanged` |
| `events(opts?)` | async iterator: history then live |
| `stop()` | aborts every worker context, rejects pending approvals, calls each `stop()` |

Registry accessors for the same process: `getLaunch`, `listLaunches`,
`getLaunchState`, `getStartTimings`, `userPick`, `resolveApproval`, `stopLaunch`.

### Launch status

- `Launch.live` when `Builder.published` arrives after `Launcher.deployed` (or, at
  settle time, when both a `coinCa` and a `siteUrl` exist and nothing failed).
- `Launch.partial` when the coin is live but one or more workers failed (status `"partial"`).
- `Launch.failed` when no coin was deployed.

### Collapse step (quantum draw)

When a worker calls `ctx.collapse(candidates, reason)` it emits `Worker.candidates`.
The orchestrator requests **one** `QuantumClient.draw({ candidateIds, context })`,
validates the proof (`assertProofUsable`), and emits
`Orchestrator.collapsed { worker, chosen, proof, candidates }`. If the draw throws,
no client was given, or (in production) the proof names a pseudorandom provider,
it emits `Orchestrator.collapseUnavailable { worker, candidates, reason }` and waits
for `userPick()`. `ctx.collapse` resolves with `{ chosen, proof | null }` either way.

There is no pseudorandom path: `Math.random` is absent from the package (tested),
and `registerQuantumProvider(name, client)` throws `ForbiddenQuantumProvider` when
`NODE_ENV=production` and the name matches `/^(pseudo|prng|mock|fake|math(\.|-)?random|random)/i`.

## Worker runtime

```ts
import type { Worker, WorkerContext } from "@quantagent/core";

const Voice: Worker = {
  name: "Voice",
  async start(ctx) { /* from the prompt alone */ return { outputs: "..." }; },
  async on(event, ctx) { /* dependencies are subscriptions */ },
  async stop() {},
};
```

- `start(ctx)` runs immediately; its resolved object (if any) is recorded as
  `Worker.done.outputs`. `on(event, ctx)` receives every event of the launch,
  including the worker's own. A throw or rejection in either fails **that worker
  only** (`Worker.failed`) and aborts its `ctx.signal`.
- `ctx`: `launchId`, `worker`, `prompt`, `connections`, `options` (`autopilot`,
  `cluster`, `devBuySol`), `clients`, `budget`, `used`, `signal`, and:
  - `emit(event)` / `progress(step, reason, detail?)` — `worker` is filled in for `Worker.*` events.
  - `spend(dimension, amount)` — charges `tokens | apiCalls | sol | deploys`; emits
    `Worker.spent`; throws `BudgetExceeded` (after `Worker.budgetExceeded` and
    `Worker.failed`) when a cap would be passed. The launch continues.
  - `requireApproval({ actionClass, title, draft, reason })` — emits
    `Worker.awaitingApproval` and blocks until the user taps; resolves instantly
    (`via: "autopilot"`) when `autopilot[actionClass]` is on. `"skip"` throws
    `ApprovalDenied`. The resolved approval is a one-shot grant consumed by the next
    gated client call.
  - `collapse(candidates, reason)` — see above.
  - `waitFor(type, { predicate?, timeoutMs? })` — the next matching event on this launch.
- `ctx.clients` are the integrator's clients wrapped by `scopeClients`: every call
  charges `apiCalls`; LLM completions charge `tokens`; `solana.buy` and the dev buy
  charge `sol`; `hosting.publish` charges `deploys`. **Gated methods** —
  `x.post`, `x.thread` (class `posts`, or `recruiting` for the Recruiter) and
  `solana.buy`, `solana.sell` (class `trades`) — throw `ApprovalRequired` before
  reaching the provider unless autopilot is on for that class or the worker holds
  an unconsumed approval. A worker cannot post, reach out or trade by discipline alone.

Budgets: `DEFAULT_BUDGETS` per worker, overridden by `LaunchOptions.budgets`; the
Launcher's `sol` budget is `devBuySol`. Only the Trader has a non-zero default `sol`.

## Event bus

`EventBus` (`new EventBus({ store?, stream?, onError?, now? })` or `createBusFromEnv()`):

- `emit(launchId, input)` assigns `id`, `at`, `seq` (monotonic per launch), persists
  through the `EventStore`, delivers to in-process subscribers synchronously, then
  fans out through the `StreamAdapter`.
- `subscribe(handler, { launchId?, types?, worker? })` → unsubscribe.
- `waitFor(launchId, type, { predicate?, timeoutMs?, signal? })`.
- `log(launchId, afterSeq?)`, `replay(launchId, handler)`, `resume(launchId)`.
- `events(launchId, { afterSeq?, signal? })` async iterator: history then live.
- `toSSE(launchId, { afterSeq?, signal? })` async iterator of `text/event-stream`
  frames (`id: <seq>`, `event: <type>`, `data: <json>`); pass the client's
  `Last-Event-ID` as `afterSeq` to resume. `sseFrame(event)` formats one.
- `flush()`, `close()`.

Adapters: `MemoryEventStore` / `MemoryStream` (default), `PostgresEventStore(url)`
(table `launch_events`), `RedisStream(url)` (pub/sub, channel
`quantagent:events[:launchId]`). `createStoreFromEnv`, `createStreamFromEnv`,
`createBusFromEnv` pick by env; nothing is faked when a URL is missing.

## State

`reduce(state, event)` is a pure reducer; `rebuild(events, launchId?)` reconstructs a
`Launch` from its log alone and equals the live state exactly (tested with
`toStrictEqual`, including after a JSON round trip). Also exported: `emptyLaunch`,
`initialWorkerState`, `failedWorkers`, `DEFAULT_BUDGETS`, `DEFAULT_AUTOPILOT`, `ZERO_BUDGET`.

## Post-launch runtime

`startPostLaunch({ launchId, bus, workers, prompt, connections, options, clients, ... })`
fans every launch event out through a BullMQ queue to the long-lived workers
(`POST_LAUNCH_WORKERS`: Voice, Trader, Shield, Recruiter, Builder, Artist; Ideator
on demand) and schedules `tick()` jobs. Same bus, budgets and gate as the launch
phase. It throws `NotImplemented("post-launch runtime", "REDIS_URL not set", ["REDIS_URL"])`
when no Redis URL is available; there is no in-process substitute.

## Environment

| Variable | Read by | Effect |
| --- | --- | --- |
| `DATABASE_URL` | `createStoreFromEnv`, `createBusFromEnv`, `storeKindFromEnv` | Postgres event store (`launch_events`). Unset: in-memory store. |
| `REDIS_URL` | `createStreamFromEnv`, `createBusFromEnv`, `streamKindFromEnv`, `startPostLaunch` | Redis pub/sub stream and BullMQ post-launch queue. Unset: in-process stream; post-launch throws `NotImplemented`. |
| `NODE_ENV` | `registerQuantumProvider`, `assertProofUsable`, `launch({ env })` | `production` forbids pseudorandom quantum providers. |

## Tests (`test/`)

`parallel` (eight starts within 100 ms, no pipeline), `isolation` (sync throw, async
rejection, throwing `on()`, distinct contexts; launch `partial`), `replay`
(`rebuild(log)` strictly equals live state; reducer purity; user pick), `gate`
(blocks until tap, instant with autopilot, edit, skip → `ApprovalDenied`, posting
without approval → `ApprovalRequired`, one grant per call), `budget` (scoped-client
cap fails only that worker; every dimension; no default SOL), `handshake` (Builder,
Voice, Shield and three external subscribers receive `Launcher.deployed` within
50 ms; `Launch.live` ordering), `quantum` (forbidden providers, refused proofs, no
`Math.random`, collapse with proof, unreachable QRNG → user pick), `bus` (seq, filters,
SSE frames, resume, env adapters, post-launch `NotImplemented`).
