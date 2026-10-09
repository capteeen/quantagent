import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { BudgetExceeded, NotImplemented } from "@quantagent/core/types";
import { AgentWallet, decryptSecretKey, encryptSecretKey, loadWalletKey, MemoryKeyStore, PgKeyStore } from "../src/wallet/index";
import { baseEnv, mockRpc, unsignedTx, WALLET_KEY_HEX } from "./helpers";

describe("wallet encryption", () => {
  it("round-trips a secret key under AES-256-GCM", () => {
    const key = loadWalletKey(baseEnv());
    const kp = Keypair.generate();
    const blob = encryptSecretKey(kp.secretKey, key, "launch-1");
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain(Buffer.from(kp.secretKey).toString("base64"));
    const back = decryptSecretKey(blob, key, "launch-1");
    expect(Buffer.from(back).equals(Buffer.from(kp.secretKey))).toBe(true);
    expect(Keypair.fromSecretKey(back).publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("rejects a wrong key, tampered blob or wrong AAD", () => {
    const key = loadWalletKey(baseEnv());
    const kp = Keypair.generate();
    const blob = encryptSecretKey(kp.secretKey, key, "launch-1");
    expect(() => decryptSecretKey(blob, Buffer.alloc(32, 7), "launch-1")).toThrow();
    expect(() => decryptSecretKey(blob, key, "launch-2")).toThrow();
    const parts = blob.split(":");
    const ct = Buffer.from(parts[3]!, "base64");
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptSecretKey(parts.join(":"), key, "launch-1")).toThrow();
  });

  it("throws NotImplemented naming AGENT_WALLET_KEY when it is missing, and rejects bad lengths", () => {
    expect(() => loadWalletKey({})).toThrow(NotImplemented);
    try {
      loadWalletKey({});
    } catch (e) {
      expect((e as NotImplemented).needs).toEqual(["AGENT_WALLET_KEY"]);
    }
    expect(() => loadWalletKey({ AGENT_WALLET_KEY: "abcd" })).toThrow(/64 hex/);
  });
});

describe("AgentWallet", () => {
  it("generates server-side, stores encrypted, and reloads the same key", async () => {
    const store = new MemoryKeyStore();
    const env = baseEnv();
    const w1 = await AgentWallet.open({ launchId: "L1", cluster: "devnet", budgetSol: 1, keyStore: store, env });
    const rec = await store.get("L1");
    expect(rec?.publicKey).toBe(w1.address);
    expect(rec?.encryptedSecretKey.startsWith("v1:")).toBe(true);
    expect(rec?.budgetLamports).toBe(1_000_000_000n);
    const w2 = await AgentWallet.open({ launchId: "L1", cluster: "devnet", budgetSol: 5, keyStore: store, env });
    expect(w2.address).toBe(w1.address);
    expect(w2.budgetSol).toBe(1); // stored budget wins over a later number
    await expect(AgentWallet.open({ launchId: "L1", cluster: "mainnet-beta", budgetSol: 1, keyStore: store, env })).rejects.toThrow(/created on devnet/);
  });

  it("refuses to sign a transaction that would exceed the SOL budget", async () => {
    const store = new MemoryKeyStore();
    const w = await AgentWallet.open({ launchId: "L2", cluster: "devnet", budgetSol: 0.5, keyStore: store, env: baseEnv() });
    const rpc = mockRpc({ balances: [10e9] });
    await expect(
      w.signAndSend({ tx: unsignedTx(w.publicKey), worker: "Trader", estimatedCostSol: 0.6, rpc }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
    expect(rpc.sent).toHaveLength(0);
    expect(w.spentSol).toBe(0);
  });

  it("signs, sends, confirms and reconciles spend against the real balance change", async () => {
    const store = new MemoryKeyStore();
    const w = await AgentWallet.open({ launchId: "L3", cluster: "devnet", budgetSol: 1, keyStore: store, env: baseEnv() });
    const rpc = mockRpc({ balances: [1_000_000_000, 1_000_000_000 - 120_000_000] });
    const sig = await w.signAndSend({ tx: unsignedTx(w.publicKey), worker: "Trader", estimatedCostSol: 0.1, rpc });
    expect(sig).toBe("sig1");
    expect(rpc.sent).toHaveLength(1);
    expect(w.spentSol).toBeCloseTo(0.12, 9);
    // cumulative: 0.12 spent, 0.88 left → another 0.9 is refused
    await expect(w.signAndSend({ tx: unsignedTx(w.publicKey), worker: "Trader", estimatedCostSol: 0.9, rpc })).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it("releases the reservation when sending fails", async () => {
    const store = new MemoryKeyStore();
    const w = await AgentWallet.open({ launchId: "L4", cluster: "devnet", budgetSol: 1, keyStore: store, env: baseEnv() });
    const rpc = mockRpc({ balances: [1e9], sendError: new Error("rpc down") });
    await expect(w.signAndSend({ tx: unsignedTx(w.publicKey), worker: "Launcher", estimatedCostSol: 0.4, rpc })).rejects.toThrow("rpc down");
    expect(w.spentSol).toBe(0);
    const rec = await store.get("L4");
    expect(rec?.spentLamports).toBe(0n);
  });

  it("PgKeyStore issues an atomic budget-guarded UPDATE", async () => {
    const queries: { text: string; values?: unknown[] }[] = [];
    const db = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, ...(values ? { values } : {}) });
        if (text.startsWith("UPDATE")) return { rows: [{ spent_lamports: "150", budget_lamports: "1000" }] };
        return { rows: [] };
      },
    };
    const ks = new PgKeyStore(db);
    await ks.ensureSchema();
    const r = await ks.addSpent("L", 150n);
    expect(r).toEqual({ ok: true, spentLamports: 150n, budgetLamports: 1000n });
    expect(queries[0]!.text).toContain("CREATE TABLE IF NOT EXISTS agent_wallets");
    expect(queries[1]!.text).toMatch(/spent_lamports \+ \$2::bigint <= budget_lamports/);
    expect(queries[1]!.values).toEqual(["L", "150"]);
    expect(WALLET_KEY_HEX).toHaveLength(64);
  });
});
