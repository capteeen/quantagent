/**
 * §9 check 12: known honest limitations are surfaced, never swallowed.
 * - pump.fun has no devnet: on devnet deployPumpFun / buy / sell / claimCreatorFees throw
 *   NotImplemented naming PUMPPORTAL_URL and the mainnet-beta default (devnet only when asked for).
 * - QSD stays NotImplemented (qsd-market not linked); the Launcher skips it with
 *   Worker.progress step "qsd-skipped" and says so on Launcher.deployed.
 * - mainnet is behind an explicit flag AND an explicit cluster.
 */
import { afterEach, describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import { launch, stopLaunch } from "@quantagent/core";
import { QSD_SKIPPED_REASON, createWorkers } from "@quantagent/workers";
import { UnknownCluster, createSolanaClient, loadQsd, resolveCluster, rpcUrlFor, type Rpc } from "@quantagent/solana";
import { fakeHosting, fakeImage, fakeLlm, fakeQuantum, fakeX, OWNER_WALLET, X_ACCOUNT_ID } from "./helpers/fakes";
import { simulate, type Sim } from "./helpers/launch";

const WALLET_ENV = { AGENT_WALLET_KEY: "cd".repeat(32) };

/** An RPC that answers balances and nothing else; no transaction may ever be sent here. */
function fakeRpc(): Rpc & { sent: number } {
  const rpc = {
    sent: 0,
    rpcEndpoint: "https://rpc.test",
    async sendRawTransaction() {
      rpc.sent += 1;
      throw new Error("the test RPC never sends");
    },
    async confirmTransaction() {
      throw new Error("never");
    },
    async getLatestBlockhash() {
      return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 };
    },
    async getBalance() {
      return 0;
    },
    async getSignaturesForAddress() {
      return [];
    },
    async getParsedTransactions() {
      return [];
    },
    async getProgramAccounts() {
      return [];
    },
  };
  return rpc as unknown as Rpc & { sent: number };
}

let sim: Sim | undefined;
afterEach(async () => {
  await sim?.stop();
  sim = undefined;
});

describe("pump.fun on an explicitly requested devnet is NotImplemented, loudly", () => {
  it("deployPumpFun / buy / sell / claimCreatorFees throw NotImplemented naming PUMPPORTAL_URL and the mainnet-beta default", async () => {
    const rpc = fakeRpc();
    const client = await createSolanaClient({ launchId: "lim-1", budgetSol: 0.5, cluster: "devnet", env: { ...WALLET_ENV }, rpc, fetch: async () => new Response("[]", { status: 200 }) });
    expect(client.cluster).toBe("devnet");
    const identity = { name: "Frostbyte", ticker: "FROST", lore: "l", hook: "h", trend: "none" };
    const calls = [
      () => client.deployPumpFun({ identity, logoUrl: "https://img.test/logo.png", siteUrl: "https://frost.quantagent.site", devBuySol: 0.1 }),
      () => client.buy({ coinCa: "x", sol: 0.01, slippageBps: 500, reason: "r" }),
      () => client.sell({ coinCa: "x", percent: 10, slippageBps: 500, reason: "r" }),
      () => client.claimCreatorFees({ coinCa: "x" }),
    ];
    for (const call of calls) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotImplemented);
      const ni = err as NotImplemented;
      expect(ni.capability).toMatch(/^pump\.fun/);
      expect(ni.because).toMatch(/mainnet only/);
      expect(ni.needs.join(" ")).toContain("PUMPPORTAL_URL");
      expect(ni.needs.join(" ")).toContain("mainnet-beta");
    }
    expect(rpc.sent).toBe(0);
  });

  it("mainnet-beta is the default with no flag; devnet only when asked for explicitly", () => {
    expect(resolveCluster(undefined, {})).toBe("mainnet-beta");
    expect(resolveCluster(undefined, { SOLANA_CLUSTER: "devnet" })).toBe("devnet");
    expect(resolveCluster("devnet", {})).toBe("devnet");
    expect(rpcUrlFor("mainnet-beta", {})).toContain("mainnet");
    expect(rpcUrlFor("devnet", {})).toContain("devnet");
  });

  it("createSolanaClient refuses an unknown cluster before touching a wallet", async () => {
    await expect(createSolanaClient({ launchId: "lim-2", budgetSol: 0.5, cluster: "testnet" as never, env: { ...WALLET_ENV }, rpc: fakeRpc() })).rejects.toBeInstanceOf(UnknownCluster);
  });

  it("without AGENT_WALLET_KEY no wallet is created: NotImplemented names the variable", async () => {
    await expect(createSolanaClient({ launchId: "lim-3", budgetSol: 0.5, env: {}, rpc: fakeRpc() })).rejects.toMatchObject({ name: "NotImplemented", needs: ["AGENT_WALLET_KEY"] });
  });
});

describe("QSD stays NotImplemented and the Launcher says so", () => {
  it("loadQsd / qsdLaunch / registerWithQsd throw NotImplemented('QSD protocol')", async () => {
    await expect(loadQsd()).rejects.toMatchObject({ name: "NotImplemented", capability: "QSD protocol" });
    const client = await createSolanaClient({ launchId: "lim-4", budgetSol: 0.5, env: { ...WALLET_ENV }, rpc: fakeRpc(), fetch: async () => new Response("[]") });
    const handlers = { onStage: () => {}, onChainStep: () => {}, onTreeLevelFused: () => {}, onSignChainStop: () => {} };
    await expect(client.qsdLaunch({ identity: { name: "n", ticker: "T", lore: "l", hook: "h", trend: "none" }, logoUrl: "u" }, handlers)).rejects.toMatchObject({ name: "NotImplemented", capability: "QSD protocol" });
    await expect(client.registerWithQsd({ coinCa: "x", identityRoot: "" })).rejects.toMatchObject({ name: "NotImplemented", capability: "QSD protocol" });
  });

  it("on a simulated launch the Launcher emits Worker.progress 'qsd-skipped' with the reason, deploys anyway, and marks identityRoot empty", async () => {
    sim = await simulate({ autopilot: { posts: true } });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const skipped = sim.ofType("Worker.progress").filter((e) => e.worker === "Launcher" && e.payload.step === "qsd-skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe(QSD_SKIPPED_REASON);
    expect(skipped[0]!.payload.detail).toMatchObject({ reason: QSD_SKIPPED_REASON });
    expect(String(skipped[0]!.payload.detail!.because)).toContain("qsd-market is not linked");
    expect(sim.ofType("Launcher.qsdStage")).toEqual([]);
    const deployed = sim.ofType("Launcher.deployed")[0]!;
    expect(deployed.payload.identityRoot).toBe("");
    expect(deployed.reason).toContain("QSD skipped");
    expect(sim.handle.getState().workers.Launcher.outputs).toMatchObject({ qsd: "skipped", identityRoot: "", proof: null, anchorTx: null });
  });

  it("any other qsdLaunch error fails the Launcher instead of being skipped", async () => {
    sim = await simulate({ autopilot: { posts: true }, solana: { qsd: new Error("qsd anchoring rejected") } });
    const failed = await sim.waitFor("Worker.failed", { predicate: (e) => e.worker === "Launcher", timeoutMs: 10_000 });
    expect(failed.payload.reason).toContain("qsd anchoring rejected");
    expect(sim.ofType("Worker.progress").filter((e) => e.worker === "Launcher" && e.payload.step === "qsd-skipped")).toEqual([]);
    expect(sim.ofType("Launcher.deployed")).toEqual([]);
    expect(sim.fakes.solana.deploys).toEqual([]);
    // BLOCKING if this fails: see 02-isolation (f) — the Builder never gives up on Launcher.deployed.
    expect(await sim.settledOrTimeout(3000), "a launch whose Launcher failed must settle").toBe("settled");
    expect(sim.handle.getState().status).toBe("failed");
    expect(sim.ofType("Launch.failed")[0]!.reason).toContain("qsd anchoring rejected");
  });
});

describe("the real solana client inside a real launch on an explicit devnet: the deploy limitation reaches the user as events", () => {
  it("Launcher fails with the NotImplemented text (PUMPPORTAL_URL / mainnet-beta) and the launch reports Launch.failed", async () => {
    const solana = await createSolanaClient({
      launchId: "lim-5",
      budgetSol: 0.5,
      cluster: "devnet",
      env: { ...WALLET_ENV },
      rpc: fakeRpc(),
      fetch: async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    });
    const workers = createWorkers().filter((w) => w.name !== "Artist");
    const { createArtist } = await import("@quantagent/workers");
    const store = { kind: "t", async put(i: { key: string }) { return { url: `https://img.test/${i.key}` }; } };
    workers.splice(1, 0, createArtist({ store, logoCandidates: 2, characterCount: 6 }));
    const x = fakeX({ accountId: X_ACCOUNT_ID });
    const handle = await launch(
      "a coin about quantum fridge cats",
      { xAccountId: X_ACCOUNT_ID, ownerWallet: OWNER_WALLET },
      { autopilot: { posts: true }, devBuySol: 0.1 },
      { workers, clients: { llm: fakeLlm(), image: fakeImage(), x, solana, hosting: fakeHosting(), quantum: fakeQuantum() }, env: { NODE_ENV: "test" } },
    );
    try {
      await handle.bus.waitFor(handle.id, "Worker.failed", { predicate: (e) => e.worker === "Launcher", timeoutMs: 15_000 });
      const s = handle.getState();
      expect(s.workers.Launcher.status).toBe("failed");
      expect(s.workers.Launcher.failReason).toContain("NotImplemented");
      expect(s.workers.Launcher.failReason).toContain("PUMPPORTAL_URL");
      expect(s.workers.Launcher.failReason).toContain("mainnet-beta");
      expect(s.coinCa).toBeUndefined();
      // The agent wallet is a real server-side keypair, exposed only by public key.
      expect(s.agentWallet).toBe(solana.agentWallet);
      expect(s.agentWallet).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      // Nothing posted a CA because there is none; the Voice failed honestly after the Launcher.
      await handle.bus.waitFor(handle.id, "Worker.failed", { predicate: (e) => e.worker === "Voice", timeoutMs: 5_000 });
      expect(x.posts.filter((p) => /CA:/.test(p.text))).toEqual([]);
      expect(handle.getState().workers.Voice.failReason).toMatch(/Launcher failed/);
      // BLOCKING if this fails: on an explicit devnet every real launch ends here, and the Builder's
      // wait for Launcher.deployed keeps the launch from ever reporting Launch.failed.
      const state = await Promise.race([handle.settled, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
      expect(state, "the launch settles after the Launcher failed").not.toBeNull();
      expect(handle.getState().status).toBe("failed");
      const log = await handle.bus.log(handle.id);
      const failed = log.find((e) => e.type === "Launch.failed")!;
      expect(failed).toBeDefined();
      expect(failed.reason).toContain("PUMPPORTAL_URL");
    } finally {
      await stopLaunch(handle.id);
    }
  });
});
