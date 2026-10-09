/**
 * TEST-ONLY harness and fake clients. Never exported from the package index and
 * never imported by src code outside *.test.ts.
 *
 * The harness runs a worker through the REAL core runtime (EventBus + ApprovalGate +
 * WorkerRun) with in-test fake clients, so tests exercise the same Worker.started /
 * Worker.done / Worker.failed lifecycle, budget scoping and collapse protocol the
 * orchestrator uses. Nothing here reaches a network.
 */

import {
  ApprovalGate,
  EventBus,
  WorkerRun,
  type Autopilot,
  type Budget,
  type Candidate,
  type ClientsInput,
  type Connections,
  type EmitInput,
  type EventType,
  type QuantagentEvent,
  type QuantumProof,
  type ResolvedLaunchOptions,
  type Worker,
  type WorkerName,
  type WorkerRunStatus,
} from "@quantagent/core";
import type {
  HostingClient,
  ImageClient,
  LlmClient,
  SolanaClient,
  XClient,
  XPost,
} from "@quantagent/core/types/clients";
import type { ImageAsset } from "@quantagent/core/types";

export const DEFAULT_BUDGET: Budget = { tokens: 200_000, apiCalls: 500, sol: 1, deploys: 50 };
export const CONNECTIONS: Connections = { xAccountId: "x-account-1", ownerWallet: "OwnerWallet1111111111111111111111111111111" };
export const LAUNCH_ID = "launch-test-0001";

export interface HarnessOptions {
  prompt?: string;
  launchId?: string;
  clients?: ClientsInput;
  budget?: Partial<Budget>;
  options?: Partial<ResolvedLaunchOptions>;
  autopilot?: Partial<Autopilot>;
}

export interface Harness {
  bus: EventBus;
  gate: ApprovalGate;
  run: WorkerRun;
  launchId: string;
  /** Every event on the bus for this launch, in seq order. */
  events: QuantagentEvent[];
  ofType<T extends EventType>(type: T): Extract<QuantagentEvent, { type: T }>[];
  /** Emit an event as another worker / the orchestrator would. */
  emit(input: EmitInput): QuantagentEvent;
  /** listen() + run(): resolves with the worker's final status. */
  start(): Promise<WorkerRunStatus>;
  /** Resolves when all in-flight on() handlers have settled. */
  settle(): Promise<void>;
  /** Emits Orchestrator.collapsed for the latest Worker.candidates of `worker` (index 0 unless given). */
  collapse(worker: WorkerName, index?: number): Candidate;
  /** Emits Orchestrator.userPicked for the latest Worker.candidates of `worker`. */
  userPick(worker: WorkerName, index?: number): Candidate;
  /** Resolves when an event of `type` (matching predicate) has arrived; rejects on timeout. */
  waitFor<T extends EventType>(
    type: T,
    opts?: { predicate?: (e: Extract<QuantagentEvent, { type: T }>) => boolean; timeoutMs?: number },
  ): Promise<Extract<QuantagentEvent, { type: T }>>;
  stop(): Promise<void>;
}

export function fakeProof(selectedIndex: number): QuantumProof {
  return {
    provider: "test-qrng",
    entropyHex: "00ff",
    attestation: "test-attestation",
    drawHash: "test-draw-hash",
    requestedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    selectedIndex,
  };
}

export function harness(worker: Worker, opts: HarnessOptions = {}): Harness {
  const launchId = opts.launchId ?? LAUNCH_ID;
  const bus = new EventBus({ onError: () => undefined });
  const autopilot: Autopilot = { posts: false, trades: false, recruiting: false, ...opts.autopilot };
  const gate = new ApprovalGate({ bus, getAutopilot: () => autopilot });
  const events: QuantagentEvent[] = [];
  bus.subscribe((e) => void events.push(e), { launchId });
  const options: ResolvedLaunchOptions = { autopilot, cluster: "devnet", devBuySol: 0.1, ...opts.options };
  const run = new WorkerRun({
    bus,
    gate,
    launchId,
    worker,
    prompt: opts.prompt ?? "a cat that runs a quantum lab",
    connections: CONNECTIONS,
    options,
    clients: opts.clients ?? {},
    budget: { ...DEFAULT_BUDGET, ...opts.budget },
  });

  const ofType = <T extends EventType>(type: T) => events.filter((e) => e.type === type) as Extract<QuantagentEvent, { type: T }>[];
  const latestCandidates = (w: WorkerName): Candidate[] => {
    const list = ofType("Worker.candidates").filter((e) => e.worker === w);
    const last = list[list.length - 1];
    if (!last) throw new Error(`no Worker.candidates from ${w} yet`);
    return last.payload.candidates;
  };

  return {
    bus,
    gate,
    run,
    launchId,
    events,
    ofType,
    emit: (input) => bus.emit(launchId, input),
    async start() {
      run.listen();
      return run.run();
    },
    settle: () => run.settleHandlers(),
    collapse(w, index = 0) {
      const candidates = latestCandidates(w);
      const chosen = candidates[index];
      if (!chosen) throw new Error(`no candidate at index ${index}`);
      bus.emit(launchId, {
        type: "Orchestrator.collapsed",
        reason: `test quantum draw picked ${chosen.id}`,
        payload: { worker: w, chosen, proof: fakeProof(index), candidates },
      });
      return chosen;
    },
    userPick(w, index = 0) {
      const candidates = latestCandidates(w);
      const chosen = candidates[index];
      if (!chosen) throw new Error(`no candidate at index ${index}`);
      bus.emit(launchId, { type: "Orchestrator.userPicked", reason: `test user picked ${chosen.id}`, payload: { worker: w, chosen } });
      return chosen;
    },
    waitFor(type, o = {}) {
      const existing = ofType(type).find((e) => !o.predicate || o.predicate(e));
      if (existing) return Promise.resolve(existing);
      return bus.waitFor(launchId, type, { ...o, timeoutMs: o.timeoutMs ?? 5000 });
    },
    async stop() {
      await run.stop();
      await bus.close();
    },
  };
}

/* ───────────────────────────── fake clients ───────────────────────────── */

export type LlmResponder = (input: { system: string; user: string; schema?: Record<string, unknown> }) => unknown;

/** An LlmClient that answers with whatever `respond` returns (object → json, string → text). */
export function fakeLlm(respond: LlmResponder): LlmClient & { calls: { system: string; user: string }[] } {
  const calls: { system: string; user: string }[] = [];
  return {
    calls,
    async complete(input) {
      calls.push({ system: input.system, user: input.user });
      const out = respond(input);
      if (typeof out === "string") return { text: out, tokensUsed: 50 };
      return { text: JSON.stringify(out), json: out, tokensUsed: 50 };
    },
  };
}

export function fakePost(over: Partial<XPost> = {}): XPost {
  return {
    id: `post-${Math.random().toString(36).slice(2, 8)}`,
    url: "https://x.com/i/status/1",
    text: "gm",
    authorId: "u1",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

export function fakeX(over: Partial<XClient> = {}): XClient {
  return {
    accountId: "x-account-1",
    async post(input) {
      return fakePost({ text: input.text });
    },
    async thread(input) {
      return input.posts.map((p) => fakePost({ text: p.text }));
    },
    async uploadMedia() {
      return { mediaId: "media-1" };
    },
    async mentions() {
      return [];
    },
    async search() {
      return [];
    },
    async trends() {
      return [
        { name: "quantum", volume: 12000 },
        { name: "cats", volume: 9000 },
      ];
    },
    async users() {
      return [];
    },
    async updateProfile() {},
    async budget() {
      return { used: 0, limit: 1000, resetsAt: new Date().toISOString(), paused: false };
    },
    ...over,
  };
}

export const FAKE_CA = "CoinCA1111111111111111111111111111111111111";

export function fakeSolana(over: Partial<SolanaClient> = {}): SolanaClient {
  return {
    cluster: "devnet",
    agentWallet: "AgentWallet111111111111111111111111111111",
    async qsdLaunch(_input, handlers) {
      handlers.onStage("keyGeneration", {});
      handlers.onChainStep(0, 1);
      handlers.onTreeLevelFused(0);
      handlers.onStage("superposition", {});
      handlers.onStage("quantumDraw", {});
      handlers.onSignChainStop(0, 1);
      handlers.onStage("signing", {});
      handlers.onStage("anchoring", { tx: "anchor-sig" });
      return { identityRoot: "root-abc", proof: fakeProof(0), signature: "sig-abc", anchorTx: "anchor-sig" };
    },
    async deployPumpFun(input) {
      return { coinCa: FAKE_CA, txSignature: `deploy-sig-${input.identity.ticker}`, devBuySignature: "devbuy-sig" };
    },
    async buy() {
      return { txSignature: "buy-sig" };
    },
    async sell() {
      return { txSignature: "sell-sig" };
    },
    async claimCreatorFees() {
      return { txSignature: "claim-sig", sol: 0 };
    },
    async isNameTaken() {
      return { name: false, ticker: false };
    },
    async findLogoMatches() {
      return [];
    },
    async findNameMatches() {
      return [];
    },
    async watchAnomalies() {
      return () => undefined;
    },
    async watchMilestones() {
      return () => undefined;
    },
    async registerWithQsd() {},
    async balanceSol() {
      return 1;
    },
    ...over,
  };
}

export interface FakeHosting extends HostingClient {
  publishes: { slug: string; html: string; assets?: { path: string; url: string }[] }[];
}

export function fakeHosting(over: Partial<HostingClient> = {}): FakeHosting {
  const publishes: FakeHosting["publishes"] = [];
  return {
    provider: "fake",
    publishes,
    async publish(input) {
      publishes.push(input);
      return { url: `https://${input.slug}.quantagent.site`, deployId: `deploy-${publishes.length}` };
    },
    async connectCustomDomain(input) {
      return { verification: `CNAME ${input.domain} -> ${input.slug}.quantagent.site` };
    },
    ...over,
  };
}

/** A tiny 1x1 PNG so fake image clients can serve real bytes. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export interface FakeImage extends ImageClient {
  calls: { prompt: string; kind: ImageAsset["kind"]; width: number; height: number; styleRef?: string }[];
}

/** An ImageClient returning data: urls of TINY_PNG; `fail` makes chosen kinds throw. */
export function fakeImage(opts: { fail?: (input: { prompt: string; kind: ImageAsset["kind"] }, n: number) => string | undefined } = {}): FakeImage {
  const calls: FakeImage["calls"] = [];
  return {
    provider: "fake-image",
    calls,
    async generate(input) {
      calls.push(input);
      const why = opts.fail?.(input, calls.length);
      if (why) throw new Error(why);
      return {
        url: `data:image/png;base64,${TINY_PNG.toString("base64")}`,
        kind: input.kind,
        width: input.width,
        height: input.height,
        externalId: `gen-${calls.length}`,
      };
    },
  };
}

/** Wait until predicate holds or timeout. */
export async function until(pred: () => boolean, timeoutMs = 5000, step = 5): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("until() timed out");
    await new Promise((r) => setTimeout(r, step));
  }
}

/** Fetch stub for provider tests: routes by URL substring, records every call. */
export interface FetchStub {
  fetch: typeof fetch;
  calls: { url: string; method: string; headers: Record<string, string>; body: string | FormData | null }[];
}

export function fetchStub(routes: { match: string | RegExp; status?: number; body: unknown; headers?: Record<string, string> }[]): FetchStub {
  const calls: FetchStub["calls"] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const hdrs: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      hdrs[k.toLowerCase()] = v;
    });
    const body = init?.body;
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: hdrs,
      body: body instanceof FormData ? body : typeof body === "string" ? body : body ? String(body) : null,
    });
    const route = routes.find((r) => (typeof r.match === "string" ? url.includes(r.match) : r.match.test(url)));
    if (!route) return new Response("no route", { status: 404 });
    const b = route.body;
    const isBinary = b instanceof Uint8Array;
    return new Response(isBinary ? (b as unknown as BodyInit) : typeof b === "string" ? b : JSON.stringify(b), {
      status: route.status ?? 200,
      headers: route.headers ?? (isBinary ? { "content-type": "image/png" } : { "content-type": "application/json" }),
    });
  }) as typeof fetch;
  return { fetch: impl, calls };
}
