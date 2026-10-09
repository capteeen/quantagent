import { describe, expect, it } from "vitest";
import { DEFAULT_DEVNET_RPC, DEFAULT_MAINNET_RPC, MainnetRefused, resolveCluster, rpcUrlFor } from "../src/cluster";
import { createSolanaClient } from "../src/client";
import { baseEnv, mockRpc } from "./helpers";

describe("cluster resolution", () => {
  it("defaults to devnet", () => {
    expect(resolveCluster(undefined, {})).toBe("devnet");
    expect(resolveCluster("devnet", { QUANTAGENT_MAINNET: "true" })).toBe("devnet");
    expect(resolveCluster(undefined, { QUANTAGENT_MAINNET: "true" })).toBe("devnet");
  });

  it("refuses mainnet-beta without QUANTAGENT_MAINNET=true", () => {
    expect(() => resolveCluster("mainnet-beta", {})).toThrow(MainnetRefused);
    expect(() => resolveCluster("mainnet-beta", { QUANTAGENT_MAINNET: "false" })).toThrow(/QUANTAGENT_MAINNET=true/);
  });

  it("allows mainnet-beta only when requested explicitly AND flagged", () => {
    expect(resolveCluster("mainnet-beta", { QUANTAGENT_MAINNET: "true" })).toBe("mainnet-beta");
  });

  it("picks the RPC url: SOLANA_RPC_URL > Helius > public cluster endpoint", () => {
    expect(rpcUrlFor("devnet", {})).toBe(DEFAULT_DEVNET_RPC);
    expect(rpcUrlFor("mainnet-beta", {})).toBe(DEFAULT_MAINNET_RPC);
    expect(rpcUrlFor("devnet", { HELIUS_API_KEY: "k" })).toBe("https://devnet.helius-rpc.com/?api-key=k");
    expect(rpcUrlFor("mainnet-beta", { HELIUS_API_KEY: "k" })).toBe("https://mainnet.helius-rpc.com/?api-key=k");
    expect(rpcUrlFor("devnet", { SOLANA_RPC_URL: "https://x.example", HELIUS_API_KEY: "k" })).toBe("https://x.example");
  });
});

describe("createSolanaClient", () => {
  it("is devnet by default and exposes the agent wallet + balance", async () => {
    const rpc = mockRpc({ balances: [2_500_000_000] });
    const c = await createSolanaClient({ launchId: "L", budgetSol: 1, env: baseEnv(), rpc });
    expect(c.cluster).toBe("devnet");
    expect(c.agentWallet).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(await c.balanceSol()).toBe(2.5);
    expect(c.webhookHandler).toBeNull();
  });

  it("refuses mainnet without the flag even when asked explicitly", async () => {
    await expect(createSolanaClient({ launchId: "L", budgetSol: 1, env: baseEnv(), rpc: mockRpc(), cluster: "mainnet-beta" })).rejects.toThrow(MainnetRefused);
    const c = await createSolanaClient({ launchId: "L", budgetSol: 1, env: baseEnv({ QUANTAGENT_MAINNET: "true" }), rpc: mockRpc(), cluster: "mainnet-beta" });
    expect(c.cluster).toBe("mainnet-beta");
  });
});
