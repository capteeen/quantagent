/**
 * Worker runtime contract shared by every worker in @quantagent/workers.
 *
 * Agent A (core) owns the real runtime (packages/core/src/runtime/worker.ts) and
 * exports its types from "@quantagent/core". This module re-exports them so every
 * worker folder imports one place and the shape can never drift from the runtime:
 *
 * - `Worker`         { name; start(ctx); on(event, ctx); stop() }
 * - `WorkerContext`  { launchId, worker, prompt, connections, options, clients,
 *                      budget, used, signal, emit, progress, spend,
 *                      requireApproval, collapse, waitFor }
 * - `WorkerClients`  every client is `T | null` (null = integrator did not wire it)
 * - `CtxEmitInput`   what ctx.emit takes: the event minus id/launchId/at/seq/worker
 *                    (the runtime fills `worker` on Worker.* events)
 *
 * Lifecycle rule (from the runtime): `WorkerRun.run()` emits Worker.started before
 * start(ctx), Worker.done when start() resolves and Worker.failed when it throws.
 * Workers therefore THROW on failure (the runtime writes the one-line reason from the
 * error, including NotImplemented's env var list) and may emit their own Worker.done
 * carrying typed outputs; the state reducer merges outputs of repeated Worker.done.
 */

export type {
  ApprovalInput,
  ApprovalOutcome,
  ClientsInput,
  CtxEmitInput,
  PendingApproval,
  PostLaunchWorker,
  ResolvedLaunchOptions,
  StartResult,
  Worker,
  WorkerClients,
  WorkerContext,
} from "@quantagent/core";
