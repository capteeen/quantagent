/**
 * Writes src/fixtures/launch.recorded.json: a realistic full-launch event log following
 * @quantagent/core/types exactly. Authored here (the 67×16 chain steps and 67 sign stops are
 * too many to type by hand) and committed as JSON. Test and Storybook only: never seeds the app.
 *
 *   pnpm --filter @quantagent/ui fixture
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate, QuantagentEvent, QuantumProof, WorkerName } from "@quantagent/core/types";

const LAUNCH_ID = "lch_01J9RECORDED0000000000001";
const T0 = Date.parse("2026-10-09T12:00:00.000Z");
const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const AGENT = "AgentWa11etPubKey111111111111111111111111111";
const X_ACCOUNT = "x_1849302211";
const CA = "QsDc0inM1ntAddr3ss4RecordedLaunch1111111111";
const SITE = "https://quantagent-fridge.pages.dev";

const pending: { ms: number; order: number; e: object }[] = [];

// deterministic ids / hashes without crypto, so the file is stable
function hex(seed: number, len: number): string {
  let s = "";
  let a = seed >>> 0;
  while (s.length < len) {
    a = (Math.imul(a ^ (a >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    s += a.toString(16).padStart(8, "0");
  }
  return s.slice(0, len);
}

/** Distributive over the event union so per-event fields (worker, payload) keep their types. */
type EventSeed = QuantagentEvent extends infer E ? (E extends QuantagentEvent ? Omit<E, "id" | "launchId" | "at" | "seq"> : never) : never;

function emit<E extends EventSeed>(ms: number, e: E): void {
  pending.push({ ms, order: pending.length, e });
}

/** The bus assigns seq in arrival order: sort by time (stable on emission order), then number. */
function finalize(): QuantagentEvent[] {
  pending.sort((a, b) => a.ms - b.ms || a.order - b.order);
  return pending.map(({ ms, e }, n) => ({
    id: `evt_${String(n).padStart(5, "0")}`,
    launchId: LAUNCH_ID,
    at: new Date(T0 + ms).toISOString(),
    seq: n,
    ...e,
  }) as QuantagentEvent);
}

const WORKERS: WorkerName[] = ["Ideator", "Artist", "Builder", "Launcher", "Voice", "Trader", "Shield", "Recruiter"];

const budget = { tokens: 200_000, apiCalls: 400, sol: 0.5, deploys: 6 };
const budgets = Object.fromEntries(WORKERS.map((w) => [w, { ...budget }])) as Record<WorkerName, typeof budget>;

function progress(ms: number, worker: WorkerName, step: string, reason: string, detail?: Record<string, unknown>) {
  emit(ms, { type: "Worker.progress", worker, reason, payload: detail ? { step, detail } : { step } });
}

function proof(seed: number, candidates: Candidate[], selected: number, atMs: number): QuantumProof {
  return {
    provider: "qsd-quantum/anu-qrng",
    entropyHex: hex(seed, 64),
    attestation: `anu:req_${hex(seed + 1, 16)}:sig_${hex(seed + 2, 40)}`,
    drawHash: hex(seed + 3, 64),
    requestedAt: new Date(T0 + atMs - 420).toISOString(),
    receivedAt: new Date(T0 + atMs).toISOString(),
    selectedIndex: selected,
  };
}

/* ───── t=0 Launch.started, all eight start within 100ms ───── */
emit(0, {
  type: "Launch.started",
  reason: "user tapped Launch",
  payload: {
    prompt: "a coin for people who keep their fridge at absolute zero",
    workers: WORKERS,
    ownerWallet: OWNER,
    xAccountId: X_ACCOUNT,
    agentWallet: AGENT,
    autopilot: { posts: false, trades: false, recruiting: false },
    cluster: "devnet",
    budgets,
  },
});
WORKERS.forEach((w, i) => emit(8 + i * 11, { type: "Worker.started", worker: w, reason: "orchestrator fan-out", payload: {} }));

/* ───── Ideator: 5 names → collapse ───── */
progress(420, "Ideator", "reading-prompt", "parse the one-line prompt into intent + tone");
progress(1300, "Ideator", "scanning-trends", "pull the live trend list for angles");
progress(2600, "Ideator", "drafting-names", "write five candidate identities");
const names: Candidate<{ name: string; ticker: string }>[] = [
  { id: "cand_name_0", value: { name: "Dilution", ticker: "DILU" }, reason: "the fridge itself", label: "DILUTION" },
  { id: "cand_name_1", value: { name: "Millikelvin", ticker: "MKLV" }, reason: "the temperature", label: "MILLIKELVIN" },
  { id: "cand_name_2", value: { name: "Cryostat", ticker: "CRYO" }, reason: "the vessel", label: "CRYOSTAT" },
  { id: "cand_name_3", value: { name: "Chandelier", ticker: "CHND" }, reason: "what it looks like", label: "CHANDELIER" },
  { id: "cand_name_4", value: { name: "Absolute Zero", ticker: "ZERO" }, reason: "the prompt's own words", label: "ABSOLUTE ZERO" },
];
emit(3400, { type: "Worker.candidates", worker: "Ideator", reason: "five identities drafted, asking for a draw", payload: { candidates: names } });
const nameProof = proof(0x1001, names, 2, 4900);
emit(4900, {
  type: "Orchestrator.collapsed",
  reason: "quantum draw selected index 2",
  payload: { worker: "Ideator", chosen: names[2]!, proof: nameProof, candidates: names },
});
emit(5000, {
  type: "Ideator.named",
  reason: "identity fixed by the draw",
  payload: {
    identity: {
      name: "Cryostat",
      ticker: "CRYO",
      lore: "A coin kept at 10 millikelvin. Nothing moves unless it is computed.",
      hook: "the only coin that is colder than your bags",
      trend: "lab-core aesthetics",
    },
  },
});
progress(5200, "Ideator", "writing-angles", "three posting angles from the chosen identity");
emit(5600, { type: "Ideator.angles", reason: "angles ready for the Voice", payload: { angles: ["colder than your bags", "nothing moves unless computed", "the fridge is the point"] } });
emit(5700, { type: "Worker.done", worker: "Ideator", reason: "identity and angles delivered", payload: { outputs: { name: "Cryostat", ticker: "CRYO" } } });

/* ───── Artist: 12 images → collapse → logo ───── */
progress(600, "Artist", "brief", "write an image brief from the prompt while the name is pending");
progress(2000, "Artist", "generating-batch-1", "6 logo candidates requested", { count: 6 });
progress(4200, "Artist", "generating-batch-2", "6 more after the name landed", { count: 6 });
progress(6100, "Artist", "scoring", "drop duplicates by perceptual hash");
const images: Candidate<{ url: string }>[] = Array.from({ length: 12 }, (_, i) => ({
  id: `cand_img_${i}`,
  value: { url: `https://img.quantagent.fun/gen/${hex(0x2000 + i, 12)}.png` },
  reason: i < 6 ? "batch 1: prompt only" : "batch 2: with the name",
  thumbnailUrl: `https://img.quantagent.fun/gen/${hex(0x2000 + i, 12)}_48.png`,
}));
emit(7200, { type: "Worker.candidates", worker: "Artist", reason: "twelve logos, asking for a draw", payload: { candidates: images } });
const imgProof = proof(0x3001, images, 7, 8800);
emit(8800, { type: "Orchestrator.collapsed", reason: "quantum draw selected index 7", payload: { worker: "Artist", chosen: images[7]!, proof: imgProof, candidates: images } });
progress(9000, "Artist", "upscaling-logo", "upscale the chosen logo to 1024");
emit(10200, {
  type: "Artist.logoReady",
  reason: "chosen logo upscaled",
  payload: { asset: { url: images[7]!.value.url, kind: "logo", width: 1024, height: 1024, externalId: "gen_" + hex(0x3077, 10), phash: hex(0x3078, 16) } },
});
progress(10400, "Artist", "banner", "banner in the same style");
emit(12600, { type: "Artist.bannerReady", reason: "banner generated", payload: { asset: { url: `https://img.quantagent.fun/gen/${hex(0x2100, 12)}.png`, kind: "banner", width: 1500, height: 500, externalId: "gen_" + hex(0x3079, 10) } } });
progress(12700, "Artist", "og-image", "og image for the site");
emit(13900, { type: "Artist.imageReady", reason: "og image generated", payload: { asset: { url: `https://img.quantagent.fun/gen/${hex(0x2101, 12)}.png`, kind: "og", width: 1200, height: 630, externalId: "gen_" + hex(0x307a, 10) } } });
emit(14000, { type: "Worker.done", worker: "Artist", reason: "logo, banner and og delivered", payload: { outputs: { logo: images[7]!.value.url } } });

/* ───── Builder ───── */
progress(500, "Builder", "scaffold", "static site scaffold with a pending-launch CA state");
progress(5800, "Builder", "apply-identity", "name, ticker, lore into the page");
progress(10500, "Builder", "apply-images", "logo and banner into the page");
progress(11400, "Builder", "deploy", "first deploy, CA shown as pending launch");
emit(13200, { type: "Builder.published", reason: "first deploy live with CA pending", payload: { url: SITE, deployId: "dep_" + hex(0x4001, 10), trigger: "identity+images" } });

/* ───── Launcher: QSD handoff ───── */
progress(700, "Launcher", "agent-wallet", "derive the per-launch agent wallet");
progress(1900, "Launcher", "fund-check", "owner wallet balance is enough for the dev buy");
progress(6200, "Launcher", "qsd-prepare", "identity root inputs assembled from the chosen name");
emit(6400, { type: "Launcher.qsdStage", reason: "QSD key generation begins", payload: { stage: "keyGeneration", detail: { chains: 67, depth: 16 } } });
// 67 chains × 16 links, interleaved like a real parallel hasher, over ~6s
let t = 6450;
for (let depth = 0; depth < 16; depth++) {
  for (let chain = 0; chain < 67; chain++) {
    emit(t, { type: "Launcher.chainStep", reason: `chain ${chain} link ${depth}`, payload: { chain, depth } });
    t += 5;
  }
  t += 20;
}
progress(t + 50, "Launcher", "qsd-chains-done", "1072 links hashed");
t += 200;
emit(t, { type: "Launcher.qsdStage", reason: "fold chain tips into a 256-leaf merkle tree", payload: { stage: "merkleTree", detail: { leaves: 256 } } });
for (let level = 1; level <= 8; level++) {
  t += 320;
  emit(t, { type: "Launcher.treeLevelFused", reason: `level ${level} fused`, payload: { level } });
}
t += 300;
emit(t, { type: "Launcher.qsdStage", reason: "superposition parameters chosen", payload: { stage: "superposition", detail: { halfLife: 7200, branches: 2 } } });
progress(t + 100, "Launcher", "qsd-superposition", "half-life 7200s, two branches");
t += 1400;
const drawCandidates: Candidate[] = [
  { id: "branch_0", value: "branch-0", reason: "superposition branch 0" },
  { id: "branch_1", value: "branch-1", reason: "superposition branch 1" },
];
const drawProof = proof(0x5001, drawCandidates, 1, t);
emit(t, { type: "Launcher.qsdStage", reason: "quantum draw resolved the superposition", payload: { stage: "quantumDraw", detail: { proof: drawProof } } });
t += 2300;
emit(t, { type: "Launcher.qsdStage", reason: "signing the identity root", payload: { stage: "signing", detail: {} } });
for (let chain = 0; chain < 67; chain++) {
  t += 22;
  const depth = (chain * 7 + 3) % 16;
  emit(t, { type: "Launcher.signChainStop", reason: `chain ${chain} stops at ${depth}`, payload: { chain, depth } });
}
progress(t + 60, "Launcher", "qsd-signed", "67 chain stops lifted into the signature ring");
t += 900;
emit(t, { type: "Launcher.qsdStage", reason: "anchoring the signed state on devnet", payload: { stage: "anchoring", detail: { cluster: "devnet" } } });
t += 1700;
const txSig = hex(0x6001, 88);
emit(t, { type: "Launcher.deployed", reason: "pump.fun create tx confirmed", payload: { coinCa: CA, txSignature: txSig, identityRoot: hex(0x6002, 64) } });
progress(t + 80, "Launcher", "dev-buy", "dev buy from the agent wallet");
t += 900;
emit(t, { type: "Launcher.devBuy", reason: "dev buy confirmed", payload: { txSignature: hex(0x6003, 88), sol: 0.1 } });
emit(t + 50, { type: "Worker.done", worker: "Launcher", reason: "deployed and bought in", payload: { outputs: { coinCa: CA, txSignature: txSig } } });
const deployedAt = t;

/* ───── Voice: a gated thread ───── */
progress(900, "Voice", "profile-prep", "avatar and banner will update once the Artist delivers");
progress(6000, "Voice", "draft-thread", "draft the announcement thread from the angles");
emit(7000, {
  type: "Worker.awaitingApproval",
  worker: "Voice",
  reason: "first launch: posts need a tap",
  payload: {
    approval: {
      id: "apr_voice_thread",
      launchId: LAUNCH_ID,
      worker: "Voice",
      actionClass: "posts",
      title: "Post the announcement thread (3 posts) from @cryostat",
      draft: { posts: ["Cryostat is a coin kept at 10 millikelvin.", "Nothing moves unless it is computed.", "CA drops here the second the tx confirms."] },
      reason: "the thread is the first thing the account says",
      createdAt: new Date(T0 + 7000).toISOString(),
    },
  },
});
emit(12000, { type: "Worker.approvalResolved", worker: "Voice", reason: "user approved", payload: { approvalId: "apr_voice_thread", decision: "approve" } });
progress(12100, "Voice", "posting-thread", "posting the approved thread");
emit(13500, { type: "Voice.posted", reason: "thread posted", payload: { postId: "1849302211000001", url: "https://x.com/cryostat/status/1849302211000001", text: "Cryostat is a coin kept at 10 millikelvin.", kind: "thread" } });
emit(13600, { type: "Voice.profileUpdated", reason: "avatar and banner set from the Artist", payload: { avatar: true, banner: true } });
progress(deployedAt + 200, "Voice", "posting-ca", "the CA within 5 seconds of deploy");
emit(deployedAt + 1400, { type: "Voice.posted", reason: "CA posted", payload: { postId: "1849302211000002", url: "https://x.com/cryostat/status/1849302211000002", text: `CA: ${CA}`, kind: "ca" } });
emit(deployedAt + 1500, { type: "Worker.done", worker: "Voice", reason: "thread and CA posted", payload: { outputs: { posts: 2 } } });

/* ───── Trader ───── */
progress(1100, "Trader", "watch", "watching for the deploy; dev buy is the Launcher's");
progress(deployedAt + 1200, "Trader", "quote", "quote the first post-launch buy");
emit(deployedAt + 1300, {
  type: "Worker.awaitingApproval",
  worker: "Trader",
  reason: "buys beyond the dev buy need a tap",
  payload: {
    approval: { id: "apr_trader_buy", launchId: LAUNCH_ID, worker: "Trader", actionClass: "trades", title: "Buy 0.05 SOL of CRYO", draft: { side: "buy", sol: 0.05 }, reason: "seed liquidity after the dev buy", createdAt: new Date(T0 + deployedAt + 1300).toISOString() },
  },
});
emit(deployedAt + 2600, { type: "Worker.approvalResolved", worker: "Trader", reason: "user skipped", payload: { approvalId: "apr_trader_buy", decision: "skip" } });
emit(deployedAt + 2650, { type: "Trader.rejected", reason: "skipped by the user", payload: { side: "buy", sol: 0.05, reason: "approval skipped" } });
emit(deployedAt + 2700, { type: "Worker.done", worker: "Trader", reason: "no further trades without approval", payload: { outputs: { trades: 0 } } });

/* ───── Shield ───── */
progress(1000, "Shield", "baseline", "snapshot pump.fun and X for the name space");
progress(5300, "Shield", "watch-name", "watching for CRYO copycats");
emit(deployedAt + 300, { type: "Shield.canonicalRegistered", reason: "canonical CA registered", payload: { coinCa: CA } });
progress(deployedAt + 350, "Shield", "scan", "first post-launch scan");
emit(deployedAt + 1900, { type: "Shield.report", reason: "first report, clean", payload: { report: { canonicalCa: CA, copycats: [], bundleFlags: [] } } });
emit(deployedAt + 1950, { type: "Worker.done", worker: "Shield", reason: "scanning continues post-launch", payload: { outputs: { copycats: 0 } } });

/* ───── Recruiter ───── */
progress(1200, "Recruiter", "search", "find accounts in the lab-core niche");
emit(4000, { type: "Recruiter.found", reason: "candidates found", payload: { accounts: [{ id: "u_1", handle: "cryolab", reach: 12000, relevance: 0.8 }, { id: "u_2", handle: "kelvinposting", reach: 4300, relevance: 0.7 }] } });
emit(4100, {
  type: "Worker.awaitingApproval",
  worker: "Recruiter",
  reason: "outreach needs a tap",
  payload: {
    approval: { id: "apr_recruit_1", launchId: LAUNCH_ID, worker: "Recruiter", actionClass: "recruiting", title: "Reply to @cryolab", draft: { accountId: "u_1", text: "your fridge would like this" }, reason: "highest reach × relevance", createdAt: new Date(T0 + 4100).toISOString() },
  },
});
emit(11000, { type: "Worker.approvalResolved", worker: "Recruiter", reason: "user approved", payload: { approvalId: "apr_recruit_1", decision: "approve" } });
progress(11100, "Recruiter", "reach", "replying to @cryolab");
emit(12200, { type: "Recruiter.reached", reason: "reply posted", payload: { accountId: "u_1", postId: "1849302211000003", text: "your fridge would like this" } });
emit(deployedAt + 2000, { type: "Worker.done", worker: "Recruiter", reason: "one outreach done, cap reached for the window", payload: { outputs: { reached: 1 } } });

/* ───── Builder patches the CA, then Launch.live ───── */
progress(deployedAt + 100, "Builder", "patch-ca", "replace pending-launch with the real CA");
emit(deployedAt + 1600, { type: "Builder.published", reason: "CA patched into the site", payload: { url: SITE, deployId: "dep_" + hex(0x4002, 10), trigger: "ca" } });
emit(deployedAt + 1650, { type: "Worker.done", worker: "Builder", reason: "site shows the real CA", payload: { outputs: { url: SITE } } });

const liveAt = deployedAt + 2900;
emit(liveAt, { type: "Launch.live", reason: "all workers delivered", payload: { coinCa: CA, siteUrl: SITE } });

/* ───── post-launch: coin mode ───── */
emit(liveAt + 3000, { type: "Chain.milestone", reason: "first holders", payload: { kind: "holders", value: 12 } });
progress(liveAt + 3100, "Voice", "milestone-post", "12 holders milestone");
emit(liveAt + 3400, { type: "Voice.posted", reason: "milestone posted", payload: { postId: "1849302211000004", url: "https://x.com/cryostat/status/1849302211000004", text: "12 holders at 10 millikelvin", kind: "milestone" } });
progress(liveAt + 4000, "Shield", "scan", "periodic scan");
emit(liveAt + 4200, {
  type: "Shield.copycatFound",
  reason: "ticker match on pump.fun",
  payload: { copycat: { source: "pump.fun", externalId: hex(0x7001, 44), url: "https://pump.fun/coin/" + hex(0x7001, 44), match: "ticker", score: 0.91, seenAt: new Date(T0 + liveAt + 4200).toISOString() } },
});
emit(liveAt + 6000, { type: "Chain.decay", reason: "volume quiet for one half-life", payload: { roughness: 0.3, halfLife: 7200 } });
emit(liveAt + 7500, { type: "Chain.measurement", reason: "a holder measured the state", payload: { proof: proof(0x8001, drawCandidates, 0, liveAt + 7500) } });

const events = finalize();
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../src/fixtures/launch.recorded.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, "[\n" + events.map((e) => JSON.stringify(e)).join(",\n") + "\n]\n");
console.log(`wrote ${events.length} events to ${out} (span ${(events[events.length - 1]!.at)})`);
