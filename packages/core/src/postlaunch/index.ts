import { Queue, Worker as QueueWorker, type Job } from "bullmq";
import { Redis } from "ioredis";
import {
  NotImplemented,
  type Budget,
  type Connections,
  type EventType,
  type LaunchOptions,
  type QuantagentEvent,
  type WorkerName,
} from "../../types/index";
import type { EventBus } from "../bus/bus";
import { ApprovalGate } from "../runtime/approvals";
import { WorkerRun } from "../runtime/context";
import type { ClientsInput, PostLaunchWorker, ResolvedLaunchOptions } from "../runtime/worker";
import { DEFAULT_AUTOPILOT, DEFAULT_BUDGETS } from "../state/index";

/** Workers that keep running after Launch.live. Ideator runs on demand (events only). */
export const POST_LAUNCH_WORKERS: readonly WorkerName[] = ["Voice", "Trader", "Shield", "Recruiter", "Builder", "Artist"];
export const ON_DEMAND_WORKERS: readonly WorkerName[] = ["Ideator"];

export const DEFAULT_TICK_MS = 60_000;

export interface PostLaunchJob {
  launchId: string;
  worker: WorkerName;
  kind: "event" | "tick";
  event?: QuantagentEvent;
}

export interface PostLaunchOptions {
  launchId: string;
  bus: EventBus;
  /** The long-lived workers plus (optionally) Ideator for on-demand angles. */
  workers: (PostLaunchWorker & { subscribesTo?: readonly EventType[] })[];
  prompt: string;
  connections: Connections;
  options: LaunchOptions;
  clients: ClientsInput;
  /** Autopilot flags as of now; defaults to the launch options' flags. */
  getAutopilot?: () => ResolvedLaunchOptions["autopilot"];
  /** Post-launch budgets (fresh meters). Default: DEFAULT_BUDGETS overridden by options.budgets. */
  budgets?: Partial<Record<WorkerName, Partial<Budget>>>;
  /** Default: process.env.REDIS_URL. */
  redisUrl?: string | undefined;
  queuePrefix?: string;
  concurrency?: number;
}

export interface PostLaunchRuntime {
  readonly launchId: string;
  readonly queueName: string;
  readonly queue: Queue<PostLaunchJob>;
  readonly runs: ReadonlyMap<WorkerName, WorkerRun>;
  readonly gate: ApprovalGate;
  /** Resolves once the queue worker is connected and tick schedules exist. */
  readonly ready: Promise<void>;
  /** Enqueue a tick for one worker now (e.g. "post a milestone"). */
  trigger(worker: WorkerName): Promise<void>;
  /** Stops consuming, removes tick schedules, closes connections. */
  stop(): Promise<void>;
}

/**
 * Starts the post-launch runtime: every event of the launch is fanned out through a
 * BullMQ queue to the long-lived workers' on(), and each worker with a tick() gets a
 * repeatable job. Same bus, budgets and approval gate as the launch phase.
 *
 * Throws NotImplemented synchronously when REDIS_URL is not set: there is no
 * in-process substitute for a durable queue.
 */
export function startPostLaunch(opts: PostLaunchOptions): PostLaunchRuntime {
  const redisUrl = (opts.redisUrl ?? process.env.REDIS_URL)?.trim();
  if (!redisUrl) throw new NotImplemented("post-launch runtime", "REDIS_URL not set", ["REDIS_URL"]);
  return createRuntime(opts, redisUrl);
}

function createRuntime(opts: PostLaunchOptions, redisUrl: string): PostLaunchRuntime {
  const { launchId, bus } = opts;
  const queueName = `${opts.queuePrefix ?? "quantagent:postlaunch"}:${launchId}`;
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const queue = new Queue<PostLaunchJob>(queueName, { connection });

  const resolved: ResolvedLaunchOptions = {
    autopilot: { ...DEFAULT_AUTOPILOT, ...(opts.options.autopilot ?? {}) },
    cluster: opts.options.cluster ?? "mainnet-beta",
    devBuySol: opts.options.devBuySol ?? 0,
  };
  const gate = new ApprovalGate({ bus, getAutopilot: () => (opts.getAutopilot ? opts.getAutopilot() : resolved.autopilot) });
  const abort = new AbortController();

  const runs = new Map<WorkerName, WorkerRun>();
  const filters = new Map<WorkerName, readonly EventType[] | undefined>();
  for (const w of opts.workers) {
    if (!POST_LAUNCH_WORKERS.includes(w.name) && !ON_DEMAND_WORKERS.includes(w.name)) {
      throw new Error(`${w.name} is not a post-launch worker`);
    }
    if (runs.has(w.name)) throw new Error(`duplicate post-launch worker: ${w.name}`);
    const budget: Budget = { ...DEFAULT_BUDGETS[w.name], ...(opts.options.budgets?.[w.name] ?? {}), ...(opts.budgets?.[w.name] ?? {}) };
    const run = new WorkerRun({
      bus,
      gate,
      launchId,
      worker: w,
      prompt: opts.prompt,
      connections: opts.connections,
      options: resolved,
      clients: opts.clients,
      budget,
      signal: abort.signal,
    });
    run.activate();
    runs.set(w.name, run);
    filters.set(w.name, w.subscribesTo);
  }

  const processor = async (job: Job<PostLaunchJob>): Promise<void> => {
    const run = runs.get(job.data.worker);
    if (!run) return;
    if (job.data.kind === "tick") await run.tick();
    else if (job.data.event) await run.deliver(job.data.event);
  };

  const queueWorker = new QueueWorker<PostLaunchJob>(queueName, processor, {
    connection,
    concurrency: opts.concurrency ?? Math.max(1, runs.size),
  });

  // Fan-out: every launch event becomes one job per interested worker.
  const unsubscribe = bus.subscribe(
    (event) => {
      for (const [name] of runs) {
        const only = filters.get(name);
        if (only && !only.includes(event.type)) continue;
        void queue
          .add(name, { launchId, worker: name, kind: "event", event }, { removeOnComplete: 1000, removeOnFail: 1000 })
          .catch((err) => console.error(`[postlaunch] enqueue ${event.type} for ${name} failed`, err));
      }
    },
    { launchId },
  );

  const ready = (async () => {
    await queueWorker.waitUntilReady();
    for (const w of opts.workers) {
      if (!w.tick) continue;
      await queue.add(
        w.name,
        { launchId, worker: w.name, kind: "tick" },
        { repeat: { every: w.tickEveryMs ?? DEFAULT_TICK_MS }, jobId: `tick:${launchId}:${w.name}`, removeOnComplete: 100, removeOnFail: 100 },
      );
    }
  })();

  return {
    launchId,
    queueName,
    queue,
    runs,
    gate,
    ready,
    trigger: async (worker) => {
      if (!runs.has(worker)) throw new Error(`${worker} is not running post-launch for ${launchId}`);
      await queue.add(worker, { launchId, worker, kind: "tick" }, { removeOnComplete: 100, removeOnFail: 100 });
    },
    stop: async () => {
      unsubscribe();
      abort.abort(new Error("post-launch runtime stopped"));
      gate.cancelAll(launchId);
      const repeatables = await queue.getRepeatableJobs().catch(() => []);
      await Promise.all(repeatables.map((r) => queue.removeRepeatableByKey(r.key).catch(() => undefined)));
      await Promise.all([...runs.values()].map((r) => r.stop()));
      await queueWorker.close();
      await queue.close();
      await connection.quit().catch(() => undefined);
    },
  };
}
