import { describe, expect, it } from "vitest";
import { DEFAULT_DEVNET_RPC, DEFAULT_MAINNET_RPC, UnknownCluster, resolveCluster, rpcUrlFor } from "../src/cluster";
import { createSolanaClient } from "../src/client";
import { baseEnv, mockRpc } from "./helpers";

describe("cluster resolution", () => {
  it("defaults to mainnet-beta with no flag", () => {
    expect(resolveCluster(undefined, {})).toBe("mainnet-beta");
    expect(resolveCluster("mainnet-beta", {})).toBe("mainnet-beta");
  });

  it("uses devnet only when asked for explicitly (argument or SOLANA_CLUSTER)", () => {
    expect(resolveCluster("devnet", {})).toBe("devnet");
    expect(resolveCluster(undefined, { SOLANA_CLUSTER: "devnet" })).toBe("devnet");
    expect(resolveCluster("mainnet-beta", { SOLANA_CLUSTER: "devnet" })).toBe("mainnet-beta");
  });

  it("refuses an unknown cluster instead of guessing", () => {
    expect(() => resolveCluster("testnet" as never, {})).toThrow(UnknownCluster);
    expect(() => resolveCluster(undefined, { SOLANA_CLUSTER: "mainnet" })).toThrow(UnknownCluster);
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
  it("is mainnet-beta by default and exposes the agent wallet + balance", async () => {
    const rpc = mockRpc({ balances: [2_500_000_000] });
    const c = await createSolanaClient({ launchId: "L", budgetSol: 1, env: baseEnv(), rpc });
    expect(c.cluster).toBe("mainnet-beta");
    expect(c.agentWallet).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(await c.balanceSol()).toBe(2.5);
    expect(c.webhookHandler).toBeNull();
  });

  it("runs on devnet when asked for explicitly", async () => {
    const c = await createSolanaClient({ launchId: "L", budgetSol: 1, env: baseEnv(), rpc: mockRpc(), cluster: "devnet" });
    expect(c.cluster).toBe("devnet");
  });
});
