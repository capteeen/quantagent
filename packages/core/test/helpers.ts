import { WORKER_NAMES, type Connections, type EventOf, type EventType, type QuantagentEvent, type WorkerName } from "../types/index";
import type { StartResult, Worker, WorkerContext } from "../src/runtime/worker";
import type { EventBus } from "../src/bus/bus";

export const connections: Connections = { xAccountId: "x-123", ownerWallet: "OwnerWallet111111111111111111111111111111111" };

export interface TrivialWorkerOverrides {
  start?: (ctx: WorkerContext) => Promise<StartResult> | StartResult;
  on?: (event: QuantagentEvent, ctx: WorkerContext) => Promise<void> | void;
  stop?: () => Promise<void> | void;
}

/** A trivial worker: start resolves immediately, on/stop are no-ops unless overridden. */
export function makeWorker(name: WorkerName, o: TrivialWorkerOverrides = {}): Worker {
  return {
    name,
    start: o.start ?? (() => undefined),
    on: o.on ?? (() => undefined),
    stop: o.stop ?? (() => undefined),
  };
}

/** Eight trivial workers, with per-name overrides. */
export function roster(overrides: Partial<Record<WorkerName, TrivialWorkerOverrides>> = {}): Worker[] {
  return WORKER_NAMES.map((n) => makeWorker(n, overrides[n] ?? {}));
}

/**
 * Overrides that make a launch reach "live": Launcher deploys (after a short tick, as a
 * real confirmation would), Builder republishes after it.
 */
export function liveOverrides(): Partial<Record<WorkerName, TrivialWorkerOverrides>> {
  return {
    Launcher: {
      start: async (ctx) => {
        await sleep(2);
        ctx.emit({
          type: "Launcher.deployed",
          reason: "test deploy",
          payload: { coinCa: "CoinCA1111111111111111111111111111111111111", txSignature: "sig", identityRoot: "root" },
        });
      },
    },
    Builder: {
      start: async (ctx) => {
        const deployed = await ctx.waitFor("Launcher.deployed", { timeoutMs: 1000 });
        ctx.emit({
          type: "Builder.published",
          reason: "republished with CA",
          payload: { url: "https://test.quantagent.site", deployId: "d1", trigger: deployed.type },
        });
      },
    },
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The first event of `type` on a launch: from the persisted log if it already
 * happened (many reactions are synchronous), otherwise the next live one.
 */
export async function firstEvent<T extends EventType>(bus: EventBus, launchId: string, type: T, timeoutMs = 1000): Promise<EventOf<T>> {
  const ac = new AbortController();
  const live = bus.waitFor(launchId, type, { timeoutMs, signal: ac.signal });
  live.catch(() => undefined);
  const logged = (await bus.log(launchId)).find((e) => e.type === type) as EventOf<T> | undefined;
  if (logged) {
    ac.abort();
    return logged;
  }
  return live;
}

/* ───────────── recording test doubles (count calls; never shown to a user) ───────────── */

import type { QuantumProof } from "../types/index";
import type { QuantumClient, SolanaClient, XClient, XPost } from "../types/clients";

/** A proof bundle as a QRNG provider would return it, selecting `index`. */
export function proofFor(candidateIds: string[], index: number, provider = "test-qrng"): QuantumProof {
  const now = new Date().toISOString();
  return {
    provider,
    entropyHex: "ab".repeat(16),
    attestation: `att-${candidateIds.join(",")}`,
    drawHash: `hash-${candidateIds.join(",")}-${index}`,
    requestedAt: now,
    receivedAt: now,
    selectedIndex: index,
  };
}

/** A QuantumClient whose draw() is scripted: `select` returns the index or throws. */
export function quantumClient(select: (ids: string[]) => number | QuantumProof): QuantumClient & { calls: number } {
  const client = {
    calls: 0,
    async draw(input: { candidateIds: string[]; context: string }) {
      client.calls += 1;
      const r = select(input.candidateIds);
      return typeof r === "number" ? proofFor(input.candidateIds, r) : r;
    },
  };
  return client;
}

/** An XClient that records what reached it (no network). */
export function recordingX(): XClient & { posts: string[]; threads: number } {
  const post = (text: string): XPost => ({ id: `p-${text.length}`, url: "https://x.test/p", text, authorId: "x-123", createdAt: new Date().toISOString() });
  const client = {
    accountId: "x-123",
    posts: [] as string[],
    threads: 0,
    async post(input: { text: string }) {
      client.posts.push(input.text);
      return post(input.text);
    },
    async thread(input: { posts: { text: string }[] }) {
      client.threads += 1;
      return input.posts.map((p) => post(p.text));
    },
    async uploadMedia() {
      return { mediaId: "m" };
    },
    async mentions() {
      return [];
    },
    async search() {
      return [];
    },
    async trends() {
      return [];
    },
    async users() {
      return [];
    },
    async updateProfile() {},
    async budget() {
      return { used: 0, limit: 1, resetsAt: "", paused: false };
    },
  };
  return client;
}

/** A SolanaClient that records buys/sells (no chain). Other methods reject: nothing is faked. */
export function recordingSolana(): SolanaClient & { buys: number[]; sells: number[] } {
  const unavailable = async (): Promise<never> => {
    throw new Error("not available in this test double");
  };
  const client = {
    cluster: "devnet" as const,
    agentWallet: "AgentWallet111111111111111111111111111111111",
    buys: [] as number[],
    sells: [] as number[],
    async buy(input: { sol: number }) {
      client.buys.push(input.sol);
      return { txSignature: `buy-${client.buys.length}` };
    },
    async sell(input: { percent: number }) {
      client.sells.push(input.percent);
      return { txSignature: `sell-${client.sells.length}` };
    },
    qsdLaunch: unavailable,
    deployPumpFun: unavailable,
    claimCreatorFees: unavailable,
    isNameTaken: unavailable,
    findLogoMatches: unavailable,
    findNameMatches: unavailable,
    watchAnomalies: unavailable,
    watchMilestones: unavailable,
    registerWithQsd: unavailable,
    balanceSol: unavailable,
  };
  return client;
}
