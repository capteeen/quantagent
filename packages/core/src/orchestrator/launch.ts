import { nanoid } from "nanoid";
import {
  WORKER_NAMES,
  type ApprovalDecision,
  type ApprovalRequest,
  type Autopilot,
  type Budget,
  type Candidate,
  type Connections,
  type Launch,
  type LaunchOptions,
  type QuantagentEvent,
  type WorkerName,
} from "../../types/index";
import { EventBus } from "../bus/bus";
import type { EventStore, StreamAdapter } from "../bus/store";
import { ApprovalGate } from "../runtime/approvals";
import { WorkerRun } from "../runtime/context";
import type { ClientsInput, ResolvedLaunchOptions, Worker } from "../runtime/worker";
import { DEFAULT_AUTOPILOT, DEFAULT_BUDGETS, emptyLaunch, failedWorkers, reduce } from "../state/index";
import { assertProofUsable } from "./quantum";

export interface LaunchDeps {
  /** All eight workers, one per WorkerName. */
  workers: Worker[];
  /** Clients handed (budget-scoped) to every worker. Missing ones are null in ctx. */
  clients: ClientsInput;
  /** Event store; ignored when `bus` is given. Default: in-memory. */
  store?: EventStore;
  /** Stream adapter; ignored when `bus` is given. Default: in-process. */
  stream?: StreamAdapter;
  /** A shared bus (e.g. from createBusFromEnv). Takes precedence over store/stream. */
  bus?: EventBus;
  /** Monotonic clock for start timings. Default performance.now. */
  clock?: () => number;
  env?: { NODE_ENV?: string | undefined };
  /** Override the generated launch id (tests, resumes). */
  launchId?: string;
}

export interface StartTimings {
  byWorker: Record<WorkerName, number>;
  firstMs: number;
  lastMs: number;
  /** lastMs - firstMs: how far apart the first and last start() calls were. */
  spreadMs: number;
}

export interface LaunchHandle {
  readonly id: string;
  readonly bus: EventBus;
  readonly gate: ApprovalGate;
  readonly runs: ReadonlyMap<WorkerName, WorkerRun>;
  /** Live state: the reduction of every event emitted so far. */
  getState(): Launch;
  getStartTimings(): StartTimings;
  /** When the QRNG was unreachable for a candidate set, the user's pick. */
  userPick(worker: WorkerName, candidateId: string): QuantagentEvent;
  resolveApproval(approvalId: string, decision: ApprovalDecision, editedDraft?: Record<string, unknown>): boolean;
  pendingApprovals(): ApprovalRequest[];
  setAutopilot(patch: Partial<Autopilot>, reason?: string): Autopilot;
  /** Async iterator over this launch's events (history, then live). */
  events(opts?: { afterSeq?: number; signal?: AbortSignal }): AsyncGenerator<QuantagentEvent, void, undefined>;
  /** Resolves when every worker's start() has settled and the final launch status is emitted. Never rejects. */
  readonly settled: Promise<Launch>;
  stop(): Promise<void>;
}

const registry = new Map<string, LaunchHandle>();

function resolveOptions(options: LaunchOptions): ResolvedLaunchOptions {
  return {
    autopilot: { ...DEFAULT_AUTOPILOT, ...(options.autopilot ?? {}) },
    cluster: options.cluster ?? "devnet",
    devBuySol: options.devBuySol ?? 0,
  };
}

function resolveBudgets(options: LaunchOptions, resolved: ResolvedLaunchOptions): Record<WorkerName, Budget> {
  const out = {} as Record<WorkerName, Budget>;
  for (const w of WORKER_NAMES) {
    const base = { ...DEFAULT_BUDGETS[w] };
    if (w === "Launcher") base.sol = resolved.devBuySol;
    out[w] = { ...base, ...(options.budgets?.[w] ?? {}) };
  }
  return out;
}

function assertRoster(workers: Worker[]): Map<WorkerName, Worker> {
  const byName = new Map<WorkerName, Worker>();
  for (const w of workers) {
    if (!WORKER_NAMES.includes(w.name)) throw new Error(`unknown worker name: ${String(w.name)}`);
    if (byName.has(w.name)) throw new Error(`duplicate worker: ${w.name}`);
    byName.set(w.name, w);
  }
  const missing = WORKER_NAMES.filter((n) => !byName.has(n));
  if (missing.length) throw new Error(`launch needs all eight workers; missing: ${missing.join(", ")}`);
  return byName;
}

/**
 * Creates a Launch and starts all eight workers concurrently over isolated contexts.
 * Workers communicate only through the bus. Returns as soon as every start() has
 * been invoked; await `handle.settled` for the end of the launch phase.
 */
export async function launch(
  prompt: string,
  connections: Connections,
  options: LaunchOptions,
  deps: LaunchDeps,
): Promise<LaunchHandle> {
  if (!prompt || !prompt.trim()) throw new Error("launch needs a prompt");
  if (!connections?.ownerWallet) throw new Error("launch needs connections.ownerWallet");
  if (!connections?.xAccountId) throw new Error("launch needs connections.xAccountId");
  const byName = assertRoster(deps.workers);

  const id = deps.launchId ?? nanoid(12);
  if (registry.has(id)) throw new Error(`launch ${id} already exists`);
  const bus = deps.bus ?? new EventBus({ ...(deps.store ? { store: deps.store } : {}), ...(deps.stream ? { stream: deps.stream } : {}) });
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? (() => performance.now());
  const resolved = resolveOptions(options);
  const budgets = resolveBudgets(options, resolved);
  const agentWallet = deps.clients.solana?.agentWallet ?? "";

  let state: Launch = emptyLaunch(id);
  const abort = new AbortController();
  const unsubs: (() => void)[] = [];
  const pendingPicks = new Map<WorkerName, Candidate[]>();
  let stopped = false;

  // Live state is the reduction of every event on this launch, in order.
  unsubs.push(
    bus.subscribe(
      (e) => {
        state = reduce(state, e);
      },
      { launchId: id },
    ),
  );

  const gate = new ApprovalGate({ bus, getAutopilot: () => state.autopilot });

  const emit = (input: Parameters<EventBus["emit"]>[1]) => bus.emit(id, input);

  const runs = new Map<WorkerName, WorkerRun>();
  for (const name of WORKER_NAMES) {
    runs.set(
      name,
      new WorkerRun({
        bus,
        gate,
        launchId: id,
        worker: byName.get(name)!,
        prompt,
        connections,
        options: resolved,
        clients: deps.clients,
        budget: budgets[name],
        signal: abort.signal,
        clock,
      }),
    );
  }

  // Collapse step: one quantum draw per candidate set; never a pseudorandom fallback.
  unsubs.push(
    bus.subscribe(
      (e) => {
        if (e.type !== "Worker.candidates") return;
        const { worker } = e;
        const candidates = e.payload.candidates;
        const quantum = deps.clients.quantum;
        const unavailable = (reason: string) => {
          pendingPicks.set(worker, candidates);
          emit({
            type: "Orchestrator.collapseUnavailable",
            reason: `quantum draw unavailable for ${worker}: ${reason}`,
            payload: { worker, candidates, reason },
          });
        };
        if (candidates.length === 0) {
          unavailable("worker yielded no candidates");
          return;
        }
        if (!quantum) {
          unavailable("no QuantumClient was provided to launch()");
          return;
        }
        void (async () => {
          try {
            const proof = await quantum.draw({ candidateIds: candidates.map((c) => c.id), context: `${id}:${worker}:${e.seq}` });
            assertProofUsable(proof, candidates.length, env);
            const chosen = candidates[proof.selectedIndex]!;
            pendingPicks.delete(worker);
            emit({
              type: "Orchestrator.collapsed",
              reason: `${proof.provider} draw selected ${chosen.label ?? chosen.id} for ${worker}`,
              payload: { worker, chosen, proof, candidates },
            });
          } catch (err) {
            unavailable(err instanceof Error ? err.message : String(err));
          }
        })();
      },
      { launchId: id, types: ["Worker.candidates"] },
    ),
  );

  // Launch.live when the site is (re)published after the coin exists; Launch.partial on a late failure.
  unsubs.push(
    bus.subscribe(
      (e) => {
        if (e.type === "Builder.published" && state.coinCa && state.status === "running") {
          emit({
            type: "Launch.live",
            reason: "coin deployed and site published with the contract address",
            payload: { coinCa: state.coinCa, siteUrl: e.payload.url },
          });
        } else if (e.type === "Worker.failed" && state.status === "live") {
          emit({
            type: "Launch.partial",
            reason: `${e.worker} failed after launch: ${e.payload.reason}`,
            payload: { failed: failedWorkers(state) },
          });
        }
      },
      { launchId: id, types: ["Builder.published", "Worker.failed"] },
    ),
  );

  // Dependencies are subscriptions: every worker listens before anything starts.
  for (const run of runs.values()) run.listen();

  emit({
    type: "Launch.started",
    reason: "user tapped launch",
    payload: {
      prompt,
      workers: [...WORKER_NAMES],
      ownerWallet: connections.ownerWallet,
      xAccountId: connections.xAccountId,
      agentWallet,
      autopilot: resolved.autopilot,
      cluster: resolved.cluster,
      budgets,
    },
  });

  // All eight start() calls are issued in one synchronous loop; nothing awaits in between.
  const starts: Promise<unknown>[] = [];
  for (const run of runs.values()) {
    try {
      starts.push(run.run());
    } catch (err) {
      // run() never throws, but a worker cannot be allowed to break the loop regardless.
      run.fail(`start() threw synchronously: ${err instanceof Error ? err.message : String(err)}`);
      starts.push(Promise.resolve());
    }
  }

  const settled: Promise<Launch> = Promise.allSettled(starts).then(async () => {
    await Promise.all([...runs.values()].map((r) => r.settleHandlers()));
    if (!stopped) finalize();
    await bus.flush();
    return state;
  });

  function finalize(): void {
    const failed = failedWorkers(state);
    if (state.status === "live") {
      if (failed.length) emit({ type: "Launch.partial", reason: `live with failures: ${failed.join(", ")}`, payload: { failed } });
      return;
    }
    if (state.status !== "running") return;
    if (state.coinCa) {
      if (failed.length === 0 && state.siteUrl) {
        emit({
          type: "Launch.live",
          reason: "coin deployed and site published",
          payload: { coinCa: state.coinCa, siteUrl: state.siteUrl },
        });
      } else {
        emit({
          type: "Launch.partial",
          reason: failed.length ? `coin deployed but ${failed.join(", ")} failed` : "coin deployed but no site was published",
          payload: { failed },
        });
      }
      return;
    }
    const launcher = state.workers.Launcher;
    emit({
      type: "Launch.failed",
      reason: launcher.failReason ? `Launcher failed: ${launcher.failReason}` : "Launcher did not deploy a coin",
      payload: { reason: launcher.failReason ?? "no coin deployed" },
    });
  }

  const handle: LaunchHandle = {
    id,
    bus,
    gate,
    runs,
    getState: () => state,
    getStartTimings: () => {
      const byWorker = {} as Record<WorkerName, number>;
      for (const [name, run] of runs) {
        if (run.startedAtMs === undefined) throw new Error(`${name} has not started`);
        byWorker[name] = run.startedAtMs;
      }
      const values = Object.values(byWorker);
      const firstMs = Math.min(...values);
      const lastMs = Math.max(...values);
      return { byWorker, firstMs, lastMs, spreadMs: lastMs - firstMs };
    },
    userPick: (worker, candidateId) => {
      const candidates = pendingPicks.get(worker);
      if (!candidates) throw new Error(`${worker} has no candidate set awaiting a user pick on launch ${id}`);
      const chosen = candidates.find((c) => c.id === candidateId);
      if (!chosen) throw new Error(`candidate ${candidateId} is not in ${worker}'s pending set`);
      pendingPicks.delete(worker);
      return emit({
        type: "Orchestrator.userPicked",
        reason: `QRNG unreachable; user picked ${chosen.label ?? chosen.id} for ${worker}`,
        payload: { worker, chosen },
      });
    },
    resolveApproval: (approvalId, decision, editedDraft) => gate.resolve(approvalId, decision, editedDraft),
    pendingApprovals: () => gate.pending(id),
    setAutopilot: (patch, reason = "user toggled autopilot") => {
      const autopilot = { ...state.autopilot, ...patch };
      emit({ type: "Launch.autopilotChanged", reason, payload: { autopilot } });
      return autopilot;
    },
    events: (opts) => bus.events(id, opts),
    settled,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      abort.abort(new Error("launch stopped"));
      gate.cancelAll(id);
      await Promise.all([...runs.values()].map((r) => r.stop()));
      for (const u of unsubs) u();
      await bus.flush();
    },
  };
  registry.set(id, handle);
  return handle;
}

/* ───────────── registry-level accessors (same process) ───────────── */

export function getLaunch(launchId: string): LaunchHandle | undefined {
  return registry.get(launchId);
}

export function listLaunches(): LaunchHandle[] {
  return [...registry.values()];
}

function must(launchId: string): LaunchHandle {
  const h = registry.get(launchId);
  if (!h) throw new Error(`unknown launch: ${launchId}`);
  return h;
}

export function getStartTimings(launchId: string): StartTimings {
  return must(launchId).getStartTimings();
}

export function userPick(launchId: string, worker: WorkerName, candidateId: string): QuantagentEvent {
  return must(launchId).userPick(worker, candidateId);
}

export function resolveApproval(
  launchId: string,
  approvalId: string,
  decision: ApprovalDecision,
  editedDraft?: Record<string, unknown>,
): boolean {
  return must(launchId).resolveApproval(approvalId, decision, editedDraft);
}

export function getLaunchState(launchId: string): Launch {
  return must(launchId).getState();
}

/** Stops a launch and drops it from the registry. */
export async function stopLaunch(launchId: string): Promise<void> {
  const h = registry.get(launchId);
  if (!h) return;
  await h.stop();
  registry.delete(launchId);
}
