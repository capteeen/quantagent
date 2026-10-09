/**
 * Test + story fixtures for the kit. These are inputs to render components in
 * every state; they are never shipped to the app and never shown to a user.
 * Shapes follow @quantagent/core/types exactly.
 */
import {
  WORKER_NAMES,
  type ApprovalRequest,
  type Budget,
  type Candidate,
  type Launch,
  type QuantagentEvent,
  type QuantumProof,
  type ShieldReport,
  type WorkerName,
  type WorkerState,
} from "@quantagent/core/types";

export const T0 = "2026-10-09T12:00:00.000Z";
const at = (s: number): string => new Date(Date.parse(T0) + s * 1000).toISOString();

export const BUDGET: Budget = { tokens: 20_000, apiCalls: 50, sol: 0.5, deploys: 3 };
export const USED: Budget = { tokens: 1_200, apiCalls: 4, sol: 0, deploys: 0 };

export const LAUNCH_ID = "launch_test_0001";
export const OWNER_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
export const AGENT_WALLET = "9aE476sH92Vz7DMPyq5WLPkrKWivxeuTKEFKd2sZZcde";
export const COIN_CA = "8oTqkh2SwVp4iJ9pAeRcC7zq2hC6sKzXx1b3nQ8Ymfun";
export const TX_SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
export const SITE_URL = "https://quantagent-test-0001.example.app";
export const X_POST_ID = "1844000000000000000";

export const CANDIDATES: Candidate<string>[] = [
  { id: "c1", value: "Cold Cat", reason: "pairs the cryostat with a meme animal", label: "Cold Cat" },
  { id: "c2", value: "Qubit Frog", reason: "frogs trend; qubit is on-thesis", label: "Qubit Frog" },
  { id: "c3", value: "Dilution", reason: "the literal machine", label: "Dilution" },
  { id: "c4", value: "Entangled Pepe", reason: "high recognisability", label: "Entangled Pepe" },
  { id: "c5", value: "Absolute Zero", reason: "temperature pun with a ticker ZERO", label: "Absolute Zero" },
];

export const PROOF: QuantumProof = {
  provider: "qsd-quantum/anu-qrng",
  entropyHex: "9f1c3a7e5d2b4c8a0e6f1d3b5a7c9e2f4b6d8a0c2e4f6a8b0d2c4e6f8a1b3c5d",
  attestation:
    "eyJyZXF1ZXN0SWQiOiJhbnUtMjAyNi0xMC0wOS0wMDAxIiwic2lnIjoiTUVVQ0lRRHhZWmYyLi4uIiwiY2VydCI6Ii0tLS0tQkVHSU4gQ0VSVElGSUNBVEUtLS0tLSJ9",
  drawHash: "3b1f9c0a2e4d6f8b1a3c5e7f9d2b4c6e8a0f1d3c5b7e9a2c4e6f8b0d1a3c5e7f",
  requestedAt: at(4),
  receivedAt: at(5),
  selectedIndex: 1,
};

export const CHOSEN: Candidate<string> = CANDIDATES[1]!;

const base = (status: WorkerState["status"], extra: Partial<WorkerState> = {}): WorkerState => ({
  status,
  outputs: {},
  budget: BUDGET,
  used: USED,
  ...extra,
});

export const WORKER_STATES: Record<WorkerState["status"], WorkerState> = {
  pending: base("pending"),
  running: base("running", { startedAt: at(0) }),
  candidates: base("candidates", { startedAt: at(0), candidates: CANDIDATES }),
  awaitingApproval: base("awaitingApproval", { startedAt: at(0) }),
  done: base("done", {
    startedAt: at(0),
    doneAt: at(9),
    candidates: CANDIDATES,
    chosen: CHOSEN,
    proof: PROOF,
    outputs: { name: "Qubit Frog", ticker: "QFROG", siteUrl: SITE_URL },
  }),
  failed: base("failed", {
    startedAt: at(0),
    doneAt: at(3),
    failReason: "image provider returned 503 after 3 retries (job img_test_77)",
  }),
};

/** A full workers map in a plausible mid-launch mix of states. */
export function workersMix(): Launch["workers"] {
  const statuses: Record<WorkerName, WorkerState["status"]> = {
    Ideator: "done",
    Artist: "candidates",
    Builder: "running",
    Launcher: "running",
    Voice: "awaitingApproval",
    Trader: "pending",
    Shield: "running",
    Recruiter: "failed",
  };
  const out = {} as Launch["workers"];
  for (const name of WORKER_NAMES) out[name] = WORKER_STATES[statuses[name]];
  return out;
}

export function workersAll(status: WorkerState["status"]): Launch["workers"] {
  const out = {} as Launch["workers"];
  for (const name of WORKER_NAMES) out[name] = WORKER_STATES[status];
  return out;
}

export const APPROVAL: ApprovalRequest = {
  id: "appr_test_0001",
  launchId: LAUNCH_ID,
  worker: "Voice",
  actionClass: "posts",
  title: "Post the announcement thread from @yourproject",
  draft: {
    text: "Qubit Frog is live. Eight workers, one quantum draw, zero promises. CA below.",
    kind: "thread",
  },
  reason: "first post of the launch; your account, your call",
  createdAt: at(6),
};

export const APPROVAL_TRADE: ApprovalRequest = {
  id: "appr_test_0002",
  launchId: LAUNCH_ID,
  worker: "Trader",
  actionClass: "trades",
  title: "Buy 0.1 SOL beyond the dev buy",
  draft: { side: "buy", sol: 0.1, slippageBps: 300 },
  reason: "holder count crossed 25 within 4 minutes",
  createdAt: at(40),
};

export const SHIELD_CLEAR: ShieldReport = { canonicalCa: COIN_CA, copycats: [], bundleFlags: [] };

export const SHIELD_FLAGGED: ShieldReport = {
  canonicalCa: COIN_CA,
  copycats: [
    {
      source: "pump.fun",
      externalId: "2FakeMintAddressQfrogCopy11111111111111111111",
      url: "https://pump.fun/coin/2FakeMintAddressQfrogCopy11111111111111111111",
      match: "ticker",
      score: 0.98,
      seenAt: at(120),
    },
    {
      source: "x",
      externalId: "1844000000000000777",
      url: "https://x.com/i/web/status/1844000000000000777",
      match: "logo",
      score: 0.83,
      seenAt: at(150),
    },
  ],
  bundleFlags: [
    {
      kind: "bundled-launch",
      evidence: "4 wallets funded from one source bought in the same slot",
      txSignatures: [TX_SIG],
      seenAt: at(30),
    },
  ],
};

export const LAUNCH_PENDING: Pick<Launch, "status" | "coinCa" | "siteUrl" | "agentWallet" | "cluster"> = {
  status: "running",
  agentWallet: AGENT_WALLET,
  cluster: "devnet",
};

export const LAUNCH_LIVE: Pick<Launch, "status" | "coinCa" | "siteUrl" | "agentWallet" | "cluster"> = {
  status: "live",
  coinCa: COIN_CA,
  siteUrl: SITE_URL,
  agentWallet: AGENT_WALLET,
  cluster: "devnet",
};

export const LAUNCH_FAILED: Pick<Launch, "status" | "coinCa" | "siteUrl" | "agentWallet" | "cluster"> = {
  status: "failed",
  agentWallet: AGENT_WALLET,
  cluster: "devnet",
};

/** An event minus the bus-assigned fields, distributed over the union so each variant keeps its own payload (and `worker`). */
type EventSeed = QuantagentEvent extends infer E ? (E extends QuantagentEvent ? Omit<E, "id" | "launchId" | "seq"> : never) : never;

let seq = 0;
const ev = (e: EventSeed): QuantagentEvent => ({ ...e, id: `evt_test_${++seq}`, launchId: LAUNCH_ID, seq }) as QuantagentEvent;

export const EVENTS: QuantagentEvent[] = [
  ev({ type: "Launch.started", at: at(0), reason: "user tapped launch", payload: { prompt: "a coin about a frozen frog", workers: [...WORKER_NAMES] } }),
  ev({ type: "Worker.started", worker: "Ideator", at: at(0.02), reason: "launch started", payload: {} }),
  ev({ type: "Worker.started", worker: "Artist", at: at(0.03), reason: "launch started", payload: {} }),
  ev({ type: "Worker.progress", worker: "Ideator", at: at(1), reason: "reading the prompt and current trends", payload: { step: "trends" } }),
  ev({ type: "Worker.candidates", worker: "Ideator", at: at(3), reason: "five names, each with a reason", payload: { candidates: CANDIDATES } }),
  ev({
    type: "Orchestrator.collapsed",
    at: at(5),
    reason: "quantum draw selected index 1",
    payload: { worker: "Ideator", chosen: CHOSEN, proof: PROOF, candidates: CANDIDATES },
  }),
  ev({ type: "Worker.done", worker: "Ideator", at: at(6), reason: "identity fixed", payload: { outputs: { name: "Qubit Frog", ticker: "QFROG" } } }),
  ev({
    type: "Artist.generationFailed",
    at: at(7),
    reason: "image provider returned 503 after 3 retries",
    payload: { brief: "logo: frog in a cryostat", error: "503 Service Unavailable (job img_test_77)" },
  }),
  ev({ type: "Worker.failed", worker: "Artist", at: at(7.1), reason: "no logo could be generated", payload: { reason: "image provider returned 503 after 3 retries (job img_test_77)" } }),
  ev({ type: "Launcher.deployed", at: at(20), reason: "pump.fun create confirmed", payload: { coinCa: COIN_CA, txSignature: TX_SIG, identityRoot: "ab12cd34" } }),
  ev({ type: "Voice.posted", at: at(25), reason: "announcement thread approved by the user", payload: { postId: X_POST_ID, url: `https://x.com/i/web/status/${X_POST_ID}`, text: "Qubit Frog is live.", kind: "thread" } }),
  ev({ type: "Builder.published", at: at(26), reason: "site deployed with the real CA", payload: { url: SITE_URL, deployId: "dpl_test_01", trigger: "Launcher.deployed" } }),
  ev({ type: "Trader.rejected", at: at(30), reason: "slippage above the 3% limit", payload: { side: "buy", sol: 0.1, reason: "slippage 4.2% > 3%" } }),
];
