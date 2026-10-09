import {
  ApprovalDenied,
  ApprovalRequired,
  BudgetExceeded,
  type ActionClass,
  type Budget,
  type Candidate,
  type Connections,
  type EventType,
  type QuantagentEvent,
  type QuantumProof,
  type WorkerName,
} from "../../types/index";
import type { EventBus } from "../bus/bus";
import type { ApprovalGate } from "./approvals";
import { BudgetMeter } from "./budget";
import { scopeClients } from "./scopedClients";
import type { ApprovalInput, ApprovalOutcome, ClientsInput, CtxEmitInput, ResolvedLaunchOptions, StartResult, Worker, WorkerContext } from "./worker";

export interface WorkerRunInput {
  bus: EventBus;
  gate: ApprovalGate;
  launchId: string;
  worker: Worker;
  prompt: string;
  connections: Connections;
  options: ResolvedLaunchOptions;
  clients: ClientsInput;
  budget: Budget;
  /** Parent signal: aborting it stops this worker too. */
  signal?: AbortSignal;
  /** performance.now()-style clock for start timings. */
  clock?: () => number;
}

export type WorkerRunStatus = "pending" | "running" | "done" | "failed" | "stopped";

/**
 * One worker's isolated runtime: its context, its budget meter, its subscription
 * to the bus and its lifecycle. Nothing thrown inside ever leaves `run()`.
 */
export class WorkerRun {
  readonly name: WorkerName;
  readonly ctx: WorkerContext;
  readonly meter: BudgetMeter;
  status: WorkerRunStatus = "pending";
  /** performance.now() when start() was invoked (undefined until then). */
  startedAtMs: number | undefined;
  failReason: string | undefined;
  private readonly abort = new AbortController();
  private readonly bus: EventBus;
  private readonly worker: Worker;
  private readonly launchId: string;
  private unsubscribe: (() => void) | null = null;
  private readonly clock: () => number;
  private readonly inFlight = new Set<Promise<void>>();
  /** Approvals resolved (tap or autopilot) and not yet consumed by a gated client call. */
  private readonly grants = new Map<string, ActionClass>();

  constructor(input: WorkerRunInput) {
    this.bus = input.bus;
    this.worker = input.worker;
    this.name = input.worker.name;
    this.launchId = input.launchId;
    this.clock = input.clock ?? (() => performance.now());
    this.meter = new BudgetMeter(this.name, input.budget);
    if (input.signal) {
      if (input.signal.aborted) this.abort.abort(input.signal.reason);
      else input.signal.addEventListener("abort", () => this.abort.abort(input.signal?.reason), { once: true });
    }

    const bus = this.bus;
    const launchId = this.launchId;
    const name = this.name;
    const gate = input.gate;
    const signal = this.abort.signal;

    const emit = <E extends CtxEmitInput>(e: E): QuantagentEvent => {
      const withWorker = e.type.startsWith("Worker.") ? { ...e, worker: name } : e;
      return bus.emit(launchId, withWorker as never);
    };

    const spend = (dimension: keyof Budget, amount: number): void => {
      try {
        const { used, limit } = this.meter.charge(dimension, amount);
        emit({
          type: "Worker.spent",
          reason: `${name} used ${amount} ${dimension}`,
          payload: { dimension, amount, used, limit },
        });
      } catch (err) {
        if (err instanceof BudgetExceeded && this.status !== "failed") {
          emit({
            type: "Worker.budgetExceeded",
            reason: `${name} would exceed its ${dimension} budget`,
            payload: { dimension, limit: err.limit, used: err.used },
          });
          this.fail(err.message);
        }
        throw err;
      }
    };

    // The gate as seen by scoped clients: autopilot for the class, or one unconsumed grant.
    const guard = (actionClass: ActionClass, method: string): void => {
      if (gate.isAutopilot(launchId, actionClass)) return;
      for (const [id, cls] of this.grants) {
        if (cls !== actionClass) continue;
        this.grants.delete(id);
        return;
      }
      throw new ApprovalRequired(name, actionClass, method);
    };

    const requireApproval = async (action: ApprovalInput): Promise<ApprovalOutcome> => {
      const outcome = await gate.request({ launchId, worker: name, ...action }, signal);
      this.grants.set(outcome.approvalId, outcome.actionClass);
      return outcome;
    };

    const ctx: WorkerContext = {
      launchId,
      worker: name,
      prompt: input.prompt,
      connections: input.connections,
      options: input.options,
      clients: scopeClients(input.clients, spend, guard, name === "Recruiter" ? "recruiting" : "posts"),
      budget: this.meter.budget,
      used: this.meter.used,
      signal,
      emit,
      progress: (step, reason, detail) =>
        emit({ type: "Worker.progress", reason, payload: detail ? { step, detail } : { step } }),
      spend,
      requireApproval,
      collapse: <T>(candidates: Candidate<T>[], reason: string) => this.collapse(candidates, reason),
      waitFor: <T extends EventType>(
        type: T,
        opts: { predicate?: (e: Extract<QuantagentEvent, { type: T }>) => boolean; timeoutMs?: number } = {},
      ) => bus.waitFor(launchId, type, { ...opts, signal }),
    };
    this.ctx = ctx;
  }

  private collapse<T>(candidates: Candidate<T>[], reason: string): Promise<{ chosen: Candidate<T>; proof: QuantumProof | null }> {
    if (candidates.length === 0) return Promise.reject(new Error(`${this.name}.collapse: no candidates`));
    const ids = new Set(candidates.map((c) => c.id));
    if (ids.size !== candidates.length) return Promise.reject(new Error(`${this.name}.collapse: duplicate candidate ids`));
    const sameSet = (list: Candidate[]) => list.length === ids.size && list.every((c) => ids.has(c.id));
    const waitCollapsed = this.bus.waitFor(this.launchId, "Orchestrator.collapsed", {
      predicate: (e) => e.payload.worker === this.name && sameSet(e.payload.candidates),
      signal: this.abort.signal,
    });
    const waitPicked = this.bus.waitFor(this.launchId, "Orchestrator.userPicked", {
      predicate: (e) => e.payload.worker === this.name && ids.has(e.payload.chosen.id),
      signal: this.abort.signal,
    });
    // Avoid an unhandled rejection from whichever promise loses the race.
    waitCollapsed.catch(() => undefined);
    waitPicked.catch(() => undefined);
    const outcome = Promise.race([
      waitCollapsed.then((e) => ({ chosen: e.payload.chosen as Candidate<T>, proof: e.payload.proof as QuantumProof | null })),
      waitPicked.then((e) => ({ chosen: e.payload.chosen as Candidate<T>, proof: null })),
    ]);
    this.ctx.emit({ type: "Worker.candidates", reason, payload: { candidates } });
    return outcome;
  }

  /** Subscribe this worker's on() to every event of the launch. Handler errors fail the worker. */
  listen(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe((event) => void this.deliver(event), { launchId: this.launchId });
  }

  /**
   * Hands one event to worker.on(event, ctx) with every throw or rejection contained
   * (a throw fails this worker only). Resolves when the handler has settled.
   */
  deliver(event: QuantagentEvent): Promise<void> {
    return this.contain(() => this.worker.on(event, this.ctx), `on(${event.type})`);
  }

  /** Runs a PostLaunchWorker's tick(ctx), contained the same way as on(). */
  tick(): Promise<void> {
    const w = this.worker as Worker & { tick?: (ctx: WorkerContext) => Promise<void> | void };
    if (!w.tick) return Promise.resolve();
    return this.contain(() => w.tick!(this.ctx), "tick()");
  }

  /** Marks the run active without emitting Worker.started (post-launch phase). */
  activate(): void {
    if (this.status === "pending") this.status = "running";
  }

  private contain(fn: () => Promise<void> | void, where: string): Promise<void> {
    if (this.status === "failed" || this.status === "stopped") return Promise.resolve();
    let result: Promise<void> | void;
    try {
      result = fn();
    } catch (err) {
      this.failFrom(err, where);
      return Promise.resolve();
    }
    if (!result || typeof (result as Promise<void>).then !== "function") return Promise.resolve();
    const p: Promise<void> = (result as Promise<void>)
      .catch((err) => this.failFrom(err, where))
      .finally(() => {
        this.inFlight.delete(p);
      });
    this.inFlight.add(p);
    return p;
  }

  /**
   * Runs start(ctx) with every throw contained. Resolves (never rejects) with the
   * final status. Emits Worker.started / Worker.done / Worker.failed.
   */
  async run(): Promise<WorkerRunStatus> {
    if (this.status !== "pending") return this.status;
    this.status = "running";
    this.startedAtMs = this.clock();
    this.ctx.emit({ type: "Worker.started", reason: `${this.name} started from the prompt`, payload: {} });
    try {
      const result: StartResult = await this.worker.start(this.ctx);
      if (this.status === "running") {
        this.status = "done";
        const outputs = result && typeof result === "object" ? result : {};
        this.ctx.emit({ type: "Worker.done", reason: `${this.name} finished`, payload: { outputs } });
      }
    } catch (err) {
      this.failFrom(err, "start()");
    }
    return this.status;
  }

  /** Marks the worker failed and emits Worker.failed. Idempotent. */
  fail(reason: string): void {
    if (this.status === "failed" || this.status === "stopped") return;
    this.status = "failed";
    this.failReason = reason;
    this.ctx.emit({ type: "Worker.failed", reason, payload: { reason } });
    this.abort.abort(new Error(`${this.name} failed: ${reason}`));
  }

  private failFrom(err: unknown, where: string): void {
    if (err instanceof BudgetExceeded) {
      this.fail(err.message); // already emitted budgetExceeded in spend()
      return;
    }
    if (err instanceof ApprovalDenied) {
      this.fail(`${where}: approval ${err.approvalId} was skipped by the user`);
      return;
    }
    if (err instanceof ApprovalRequired) {
      this.fail(`${where}: ${err.message}`);
      return;
    }
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    this.fail(`${where} threw: ${msg}`);
  }

  /** Stops listening and calls worker.stop(); a throw in stop() is contained. */
  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.status === "running" || this.status === "pending") this.status = "stopped";
    this.abort.abort(new Error(`${this.name} stopped`));
    try {
      await this.worker.stop();
    } catch {
      // contained
    }
  }

  /** Resolves when all in-flight on() handlers have settled. */
  async settleHandlers(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }
}
