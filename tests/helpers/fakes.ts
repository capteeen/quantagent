/**
 * Agent G's own fake clients. They implement the public client interfaces from
 * @quantagent/core/types/clients, record every call, and never touch a network.
 * Nothing here is imported from any package's internal test harness.
 */
import { NotImplemented, type QuantumProof } from "@quantagent/core/types";
import type {
  HostingClient,
  ImageClient,
  LlmClient,
  QuantumClient,
  SolanaClient,
  XClient,
  XPost,
} from "@quantagent/core/types/clients";

/** Pad with "1" (valid base58) to a 44-char Solana-looking address. */
export function base58Pad(prefix: string, length = 44): string {
  return (prefix + "1".repeat(length)).slice(0, length);
}

export const CA = base58Pad("CoinCA");
export const AGENT_WALLET = base58Pad("AgentWa11et");
export const OWNER_WALLET = base58Pad("UserWa11et");
export const X_ACCOUNT_ID = "x-account-1849302211";
export const DEPLOY_TX = "deploy-tx-signature-1";

/** A 1×1 PNG so the Artist's fetch → fit → pHash → store path runs on real bytes. */
export const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/* ───────────────────────────── LLM ───────────────────────────── */

export interface FakeLlm extends LlmClient {
  calls: { system: string; user: string }[];
}

export interface FakeLlmOptions {
  tokensUsed?: number;
  /** Candidate identities the Ideator receives. */
  candidates?: { name: string; ticker: string; lore: string; hook: string; trend: string }[];
  /** Throw on every call (kills the Ideator / Recruiter). */
  fail?: Error;
  /** Awaited before each reply (or before `fail` is thrown): lets a test time the LLM's death against other events. */
  gate?: (call: { system: string; user: string; n: number }) => Promise<void>;
}

export const DEFAULT_CANDIDATES = [
  { name: "Frostbyte", ticker: "FROST", lore: "Born in a cryostat, Frostbyte keeps every fridge honest.", hook: "a fridge that never lies", trend: "quantum" },
  { name: "Cryocat", ticker: "CRYO", lore: "A cat that sleeps at absolute zero and dreams in qubits.", hook: "the coldest cat alive", trend: "cats" },
  { name: "Kelvinaut", ticker: "KELVIN", lore: "An explorer of the last millikelvin.", hook: "zero is a destination", trend: "none" },
  { name: "Icecube Ike", ticker: "CUBE", lore: "Ike is a cube. Ike is cold. Ike is enough.", hook: "square, cold, yours", trend: "none" },
  { name: "Nitro Ned", ticker: "NITRO", lore: "Ned runs on liquid nitrogen and good vibes.", hook: "boil at 77K", trend: "quantum" },
];

/** Dispatches on the worker's system prompt, so one fake serves Ideator, Recruiter and Voice. */
export function fakeLlm(opts: FakeLlmOptions = {}): FakeLlm {
  const calls: FakeLlm["calls"] = [];
  let replies = 0;
  return {
    calls,
    async complete(input) {
      calls.push({ system: input.system, user: input.user });
      await opts.gate?.({ system: input.system, user: input.user, n: calls.length });
      if (opts.fail) throw opts.fail;
      const sys = input.system;
      let json: unknown;
      if (/name memecoins/i.test(sys)) {
        json = { candidates: opts.candidates ?? DEFAULT_CANDIDATES };
      } else if (/compliance checker/i.test(sys)) {
        const names = [...input.user.matchAll(/^- (.+?) \(\$/gm)].map((m) => m[1]);
        json = { verdicts: names.map((name) => ({ name, isRealPerson: false })) };
      } else if (/content angles/i.test(sys)) {
        json = { angles: ["angle one: the fridge speaks", "angle two: a cold open", "angle three: zero kelvin club"] };
      } else if (/score X accounts/i.test(sys)) {
        const ids = [...input.user.matchAll(/id=(\S+)/g)].map((m) => m[1]);
        json = { accounts: ids.map((id) => ({ id, relevance: 0.9 })) };
      } else if (/public reply/i.test(sys) || /reply on X/i.test(sys)) {
        replies += 1;
        json = { text: `thanks for the kind words, friend number ${replies}` };
      } else {
        json = {};
      }
      return { text: JSON.stringify(json), json, tokensUsed: opts.tokensUsed ?? 50 };
    },
  };
}

/* ───────────────────────────── image ───────────────────────────── */

export interface FakeImage extends ImageClient {
  calls: { prompt: string; kind: string; width: number; height: number }[];
}

export function fakeImage(opts: { fail?: (prompt: string, n: number) => string | undefined } = {}): FakeImage {
  const calls: FakeImage["calls"] = [];
  return {
    provider: "test-image",
    calls,
    async generate(input) {
      calls.push({ prompt: input.prompt, kind: input.kind, width: input.width, height: input.height });
      const why = opts.fail?.(input.prompt, calls.length);
      if (why) throw new Error(why);
      return { url: TINY_PNG_DATA_URL, kind: input.kind, width: input.width, height: input.height, externalId: `gen-${calls.length}` };
    },
  };
}

/** The object store the Artist writes to (ArtistOptions.store). */
export function fakeObjectStore() {
  const puts: { key: string; bytes: number; contentType: string }[] = [];
  return {
    kind: "test-store",
    puts,
    async put(input: { key: string; bytes: Uint8Array; contentType: string }) {
      puts.push({ key: input.key, bytes: input.bytes.length, contentType: input.contentType });
      return { url: `https://img.test/${input.key}` };
    },
  };
}

/* ───────────────────────────── X ───────────────────────────── */

export interface FakeX extends XClient {
  posts: { text: string; mediaIds?: string[]; replyTo?: string }[];
  threads: { posts: { text: string; mediaIds?: string[] }[] }[];
  uploads: string[];
  profileUpdates: { avatarUrl?: string; bannerUrl?: string }[];
  searches: string[];
  /** Every text that reached the provider (posts + thread posts). */
  allTexts(): string[];
}

export interface FakeXOptions {
  accountId?: string;
  searchResults?: XPost[];
  users?: { id: string; handle: string; followers: number }[];
  trends?: { name: string; volume?: number }[];
  mentions?: XPost[];
  postFail?: Error;
}

export function fakeX(opts: FakeXOptions = {}): FakeX {
  const accountId = opts.accountId ?? X_ACCOUNT_ID;
  const posts: FakeX["posts"] = [];
  const threads: FakeX["threads"] = [];
  const uploads: string[] = [];
  const profileUpdates: FakeX["profileUpdates"] = [];
  const searches: string[] = [];
  let n = 0;
  const mk = (text: string): XPost => {
    n += 1;
    return { id: `post-${n}`, url: `https://x.com/connected/status/${n}`, text, authorId: accountId, createdAt: new Date().toISOString() };
  };
  return {
    accountId,
    posts,
    threads,
    uploads,
    profileUpdates,
    searches,
    allTexts: () => [...posts.map((p) => p.text), ...threads.flatMap((t) => t.posts.map((p) => p.text))],
    async post(input) {
      if (opts.postFail) throw opts.postFail;
      posts.push(input);
      return mk(input.text);
    },
    async thread(input) {
      if (opts.postFail) throw opts.postFail;
      threads.push(input);
      return input.posts.map((p) => mk(p.text));
    },
    async uploadMedia(input) {
      uploads.push(input.url);
      return { mediaId: `media-${uploads.length}` };
    },
    async mentions() {
      return opts.mentions ?? [];
    },
    async search(input) {
      searches.push(input.query);
      return opts.searchResults ?? [];
    },
    async trends() {
      return opts.trends ?? [{ name: "quantum", volume: 12000 }, { name: "cats", volume: 9000 }];
    },
    async users() {
      return opts.users ?? [];
    },
    async updateProfile(input) {
      profileUpdates.push(input);
    },
    async budget() {
      return { used: 0, limit: 1500, resetsAt: new Date().toISOString(), paused: false };
    },
  };
}

/* ───────────────────────────── Solana ───────────────────────────── */

export interface FakeSolana extends SolanaClient {
  deploys: { identity: { name: string; ticker: string }; devBuySol: number; siteUrl: string }[];
  buys: { coinCa: string; sol: number }[];
  sells: { coinCa: string; percent: number }[];
}

export interface FakeSolanaOptions {
  coinCa?: string;
  agentWallet?: string;
  /** Delay before deployPumpFun resolves, like a real confirmation. */
  deployDelayMs?: number;
  deployFail?: Error;
  /** What qsdLaunch does: "notImplemented" (default, like the real client without qsd-market), "run" (emits every stage), or an error. */
  qsd?: "notImplemented" | "run" | Error;
}

export function fakeSolana(opts: FakeSolanaOptions = {}): FakeSolana {
  const coinCa = opts.coinCa ?? CA;
  const deploys: FakeSolana["deploys"] = [];
  const buys: FakeSolana["buys"] = [];
  const sells: FakeSolana["sells"] = [];
  return {
    cluster: "devnet",
    agentWallet: opts.agentWallet ?? AGENT_WALLET,
    deploys,
    buys,
    sells,
    async qsdLaunch(_input, handlers) {
      const mode = opts.qsd ?? "notImplemented";
      if (mode instanceof Error) throw mode;
      if (mode === "notImplemented") {
        throw new NotImplemented("QSD protocol", "qsd-market is not linked in this workspace", ["link qsd-market into the pnpm workspace"]);
      }
      handlers.onStage("keyGeneration", {});
      for (let c = 0; c < 67; c++) for (let d = 0; d < 16; d++) handlers.onChainStep(c, d);
      handlers.onStage("merkleTree", {});
      for (let l = 0; l < 8; l++) handlers.onTreeLevelFused(l);
      handlers.onStage("superposition", { halfLife: 3600 });
      handlers.onStage("quantumDraw", { proof: fakeProof(0) });
      handlers.onStage("signing", {});
      for (let c = 0; c < 67; c++) handlers.onSignChainStop(c, c % 16);
      handlers.onStage("anchoring", { anchorTx: "anchor-tx-1" });
      return { identityRoot: "root-0001", proof: fakeProof(0), signature: "qsd-sig-1", anchorTx: "anchor-tx-1" };
    },
    async deployPumpFun(input) {
      if (opts.deployFail) throw opts.deployFail;
      if (opts.deployDelayMs) await new Promise((r) => setTimeout(r, opts.deployDelayMs));
      deploys.push({ identity: { name: input.identity.name, ticker: input.identity.ticker }, devBuySol: input.devBuySol, siteUrl: input.siteUrl });
      return { coinCa, txSignature: DEPLOY_TX, devBuySignature: DEPLOY_TX };
    },
    async buy(input) {
      buys.push({ coinCa: input.coinCa, sol: input.sol });
      return { txSignature: `buy-tx-${buys.length}` };
    },
    async sell(input) {
      sells.push({ coinCa: input.coinCa, percent: input.percent });
      return { txSignature: `sell-tx-${sells.length}` };
    },
    async claimCreatorFees() {
      return { txSignature: "claim-tx-1", sol: 0 };
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
  };
}

/* ───────────────────────────── hosting ───────────────────────────── */

export interface FakeHosting extends HostingClient {
  publishes: { slug: string; html: string; assets?: { path: string; url: string }[] }[];
}

export interface FakeHostingOptions {
  /** Throw on every publish. */
  fail?: Error;
  /** Throw on one publish: called with the input and the 1-based attempt number (failed attempts count). */
  failFor?: (input: { slug: string; html: string }, attempt: number) => Error | undefined;
  /** Delay before a publish resolves, per attempt (a slow edge deploy). */
  delayMs?: (input: { slug: string; html: string }, attempt: number) => number;
  /** Awaited before a publish resolves: holds a deploy on the wire until the test says so. */
  hold?: (input: { slug: string; html: string }, attempt: number) => Promise<void>;
}

export function fakeHosting(opts: FakeHostingOptions = {}): FakeHosting {
  const publishes: FakeHosting["publishes"] = [];
  let attempts = 0;
  return {
    provider: "test-hosting",
    publishes,
    async publish(input) {
      attempts += 1;
      const delay = opts.delayMs?.(input, attempts) ?? 0;
      if (delay > 0) await sleep(delay);
      await opts.hold?.(input, attempts);
      if (opts.fail) throw opts.fail;
      const why = opts.failFor?.(input, attempts);
      if (why) throw why;
      publishes.push(input);
      return { url: `https://${input.slug}.quantagent.site`, deployId: `deploy-${publishes.length}` };
    },
    async connectCustomDomain(input) {
      return { verification: `CNAME ${input.domain}` };
    },
  };
}

/* ───────────────────────────── quantum ───────────────────────────── */

/** A proof whose hex fields contain zeros, so they can never be mistaken for base58 addresses. */
export function fakeProof(selectedIndex: number, provider = "test-qrng"): QuantumProof {
  return {
    provider,
    entropyHex: "00ff".repeat(16),
    attestation: JSON.stringify({ requestUrl: "https://qrng.test/", id: "att-0001" }),
    drawHash: "0a".repeat(32),
    requestedAt: "2026-10-09T12:00:00.000Z",
    receivedAt: "2026-10-09T12:00:00.010Z",
    selectedIndex,
  };
}

export interface FakeQuantum extends QuantumClient {
  draws: { candidateIds: string[]; context: string }[];
}

export interface FakeQuantumOptions {
  provider?: string;
  selectedIndex?: number;
  fail?: Error;
  /** Awaited before the draw answers: lets a test hold a collapse open while something else happens. */
  gate?: (input: { candidateIds: string[]; context: string }) => Promise<void>;
}

export function fakeQuantum(opts: FakeQuantumOptions = {}): FakeQuantum {
  const draws: FakeQuantum["draws"] = [];
  return {
    draws,
    async draw(input) {
      draws.push({ candidateIds: [...input.candidateIds], context: input.context });
      await opts.gate?.({ candidateIds: [...input.candidateIds], context: input.context });
      if (opts.fail) throw opts.fail;
      return fakeProof(opts.selectedIndex ?? 0, opts.provider);
    },
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
