/**
 * A simulated launch through the REAL orchestrator (@quantagent/core launch()) with the
 * REAL workers (@quantagent/workers createWorkers()) and Agent G's fake clients.
 *
 * The only substitution in the roster: the Artist is created with createArtist({ store })
 * because createWorkers() exposes no way to inject the Artist's object store (NOTE in
 * /docs/audit-log.md); every other worker comes straight from createWorkers().
 */
import { launch, stopLaunch, type LaunchHandle, type Worker } from "@quantagent/core";
import type { Autopilot, Budget, LaunchOptions, QuantagentEvent, WorkerName } from "@quantagent/core/types";
import { createArtist, createWorkers, type CreateWorkersOptions } from "@quantagent/workers";
import {
  fakeHosting,
  fakeImage,
  fakeLlm,
  fakeObjectStore,
  fakeQuantum,
  fakeSolana,
  fakeX,
  OWNER_WALLET,
  X_ACCOUNT_ID,
  sleep,
  type FakeHosting,
  type FakeHostingOptions,
  type FakeImage,
  type FakeLlm,
  type FakeLlmOptions,
  type FakeQuantum,
  type FakeQuantumOptions,
  type FakeSolana,
  type FakeSolanaOptions,
  type FakeX,
  type FakeXOptions,
} from "./fakes";

export interface Fakes {
  llm: FakeLlm;
  image: FakeImage;
  x: FakeX;
  solana: FakeSolana;
  hosting: FakeHosting;
  quantum: FakeQuantum;
  store: ReturnType<typeof fakeObjectStore>;
}

export interface SimOptions {
  prompt?: string;
  autopilot?: Partial<Autopilot>;
  budgets?: Partial<Record<WorkerName, Partial<Budget>>>;
  devBuySol?: number;
  env?: { NODE_ENV?: string };
  xAccountId?: string;
  llm?: FakeLlmOptions;
  x?: FakeXOptions;
  solana?: FakeSolanaOptions;
  hostingFail?: Error;
  hosting?: FakeHostingOptions;
  imageFail?: (prompt: string, n: number) => string | undefined;
  quantum?: FakeQuantumOptions | null;
  workerOptions?: CreateWorkersOptions;
  /** Replace or wrap workers after the roster is built (e.g. kill one). */
  patchWorkers?: (workers: Worker[], fakes: Fakes) => Worker[];
  clock?: () => number;
}

export interface Sim {
  handle: LaunchHandle;
  fakes: Fakes;
  /** Every event of the launch, in order, as it was delivered to an independent subscriber. */
  events: QuantagentEvent[];
  /** performance.now() at delivery of each event, by event id. */
  deliveredAt: Map<string, number>;
  log(): Promise<QuantagentEvent[]>;
  ofType<T extends QuantagentEvent["type"]>(type: T): Extract<QuantagentEvent, { type: T }>[];
  /** Resolves with the next event of a type (or one already seen), rejects on timeout. */
  waitFor<T extends QuantagentEvent["type"]>(
    type: T,
    opts?: { predicate?: (e: Extract<QuantagentEvent, { type: T }>) => boolean; timeoutMs?: number },
  ): Promise<Extract<QuantagentEvent, { type: T }>>;
  /** `settled` or a timeout marker, so a hung launch is observable instead of fatal. */
  settledOrTimeout(ms: number): Promise<"settled" | "timeout">;
  stop(): Promise<void>;
}

export function makeFakes(opts: SimOptions = {}): Fakes {
  return {
    llm: fakeLlm(opts.llm),
    image: fakeImage(opts.imageFail ? { fail: opts.imageFail } : {}),
    x: fakeX({ accountId: opts.xAccountId ?? X_ACCOUNT_ID, ...(opts.x ?? {}) }),
    solana: fakeSolana(opts.solana),
    hosting: fakeHosting({ ...(opts.hosting ?? {}), ...(opts.hostingFail ? { fail: opts.hostingFail } : {}) }),
    quantum: fakeQuantum(opts.quantum ?? {}),
    store: fakeObjectStore(),
  };
}

/** createWorkers() with the Artist given an injectable store and a small, fast image set. */
export function roster(fakes: Fakes, workerOptions: CreateWorkersOptions = {}): Worker[] {
  return createWorkers(workerOptions).map((w) =>
    w.name === "Artist" ? createArtist({ store: fakes.store, logoCandidates: 2, characterCount: 6, concurrency: 3 }) : w,
  );
}

export async function simulate(opts: SimOptions = {}): Promise<Sim> {
  const fakes = makeFakes(opts);
  let workers = roster(fakes, opts.workerOptions);
  if (opts.patchWorkers) workers = opts.patchWorkers(workers, fakes);

  const launchOptions: LaunchOptions = {
    autopilot: opts.autopilot ?? {},
    devBuySol: opts.devBuySol ?? 0.1,
    cluster: "devnet",
    ...(opts.budgets ? { budgets: opts.budgets } : {}),
  };
  const events: QuantagentEvent[] = [];
  const deliveredAt = new Map<string, number>();

  const handle = await launch(
    opts.prompt ?? "a coin about quantum fridge cats",
    { xAccountId: opts.xAccountId ?? X_ACCOUNT_ID, ownerWallet: OWNER_WALLET },
    launchOptions,
    {
      workers,
      clients: {
        llm: fakes.llm,
        image: fakes.image,
        x: fakes.x,
        solana: fakes.solana,
        hosting: fakes.hosting,
        quantum: opts.quantum === null ? undefined : fakes.quantum,
      },
      env: opts.env ?? { NODE_ENV: "test" },
      ...(opts.clock ? { clock: opts.clock } : {}),
    },
  );
  // Subscribe after launch() returned: the history is replayed from the log below.
  const unsub = handle.bus.subscribe(
    (e) => {
      events.push(e);
      deliveredAt.set(e.id, performance.now());
    },
    { launchId: handle.id },
  );
  for (const e of await handle.bus.log(handle.id)) {
    if (!events.some((x) => x.id === e.id)) {
      events.push(e);
      deliveredAt.set(e.id, performance.now());
    }
  }
  events.sort((a, b) => a.seq - b.seq);

  const ofType = <T extends QuantagentEvent["type"]>(type: T) => events.filter((e) => e.type === type) as Extract<QuantagentEvent, { type: T }>[];

  return {
    handle,
    fakes,
    events,
    deliveredAt,
    log: () => handle.bus.log(handle.id),
    ofType,
    waitFor(type, o = {}) {
      const seen = ofType(type).find((e) => !o.predicate || o.predicate(e));
      if (seen) return Promise.resolve(seen);
      return handle.bus.waitFor(handle.id, type, { ...o, timeoutMs: o.timeoutMs ?? 15_000 });
    },
    settledOrTimeout: (ms) => Promise.race([handle.settled.then(() => "settled" as const), sleep(ms).then(() => "timeout" as const)]),
    stop: async () => {
      unsub();
      await stopLaunch(handle.id);
    },
  };
}

/** Wrap a worker from the roster so its start()/on() can be instrumented without replacing it. */
export function wrapWorker(
  w: Worker,
  patch: Partial<Pick<Worker, "start" | "on" | "stop">> & { before?: (hook: "start" | "on", event?: QuantagentEvent) => void },
): Worker {
  return {
    name: w.name,
    start: (ctx) => {
      patch.before?.("start");
      return patch.start ? patch.start(ctx) : w.start(ctx);
    },
    on: (event, ctx) => {
      patch.before?.("on", event);
      return patch.on ? patch.on(event, ctx) : w.on(event, ctx);
    },
    stop: () => (patch.stop ? patch.stop() : w.stop()),
  };
}
