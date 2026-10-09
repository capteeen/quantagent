import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { BudgetExceeded, NotImplemented } from "@quantagent/core/types";
import {
  buyBody,
  collectCreatorFeeBody,
  createBody,
  estimateBuyCostSol,
  metadataUploaderFromEnv,
  PumpFunLauncher,
  PumpPortalError,
  PUMPPORTAL_TRADE_LOCAL_URL,
  requestTradeLocal,
  sellBody,
} from "../src/pumpfun/index";
import { AgentWallet, MemoryKeyStore } from "../src/wallet/index";
import { baseEnv, bytesResponse, jsonResponse, mockFetch, mockRpc, unsignedTx } from "./helpers";

const PK = Keypair.generate().publicKey.toBase58();
const MINT = Keypair.generate().publicKey.toBase58();

describe("PumpPortal trade-local bodies", () => {
  it("create: tokenMetadata + mint + dev buy denominated in SOL", () => {
    const b = createBody({ publicKey: PK, mint: MINT, name: "Quanta", symbol: "QNT", metadataUri: "ipfs://meta", devBuySol: 0.25, slippageBps: 1000, priorityFeeSol: 0.0005 });
    expect(b).toEqual({
      publicKey: PK,
      action: "create",
      tokenMetadata: { name: "Quanta", symbol: "QNT", uri: "ipfs://meta" },
      mint: MINT,
      denominatedInSol: "true",
      amount: 0.25,
      slippage: 10,
      priorityFee: 0.0005,
      pool: "pump",
    });
  });

  it("buy / sell / collectCreatorFee shapes match the documented fields", () => {
    expect(buyBody({ publicKey: PK, mint: MINT, sol: 0.1, slippageBps: 250, priorityFeeSol: 0.001, pool: "pump" })).toEqual({
      publicKey: PK,
      action: "buy",
      mint: MINT,
      denominatedInSol: "true",
      amount: 0.1,
      slippage: 2.5,
      priorityFee: 0.001,
      pool: "pump",
    });
    expect(sellBody({ publicKey: PK, mint: MINT, percent: 100, slippageBps: 500, priorityFeeSol: 0.001, pool: "auto" })).toEqual({
      publicKey: PK,
      action: "sell",
      mint: MINT,
      denominatedInSol: "false",
      amount: "100%",
      slippage: 5,
      priorityFee: 0.001,
      pool: "auto",
    });
    expect(collectCreatorFeeBody({ publicKey: PK, priorityFeeSol: 0.000001, mint: MINT })).toEqual({
      publicKey: PK,
      action: "collectCreatorFee",
      priorityFee: 0.000001,
      pool: "pump",
      mint: MINT,
    });
    expect(() => buyBody({ publicKey: PK, mint: MINT, sol: 0, slippageBps: 100, priorityFeeSol: 0, pool: "pump" })).toThrow();
    expect(() => sellBody({ publicKey: PK, mint: MINT, percent: 101, slippageBps: 100, priorityFeeSol: 0, pool: "pump" })).toThrow();
    expect(() => buyBody({ publicKey: PK, mint: MINT, sol: 1, slippageBps: 20_000, priorityFeeSol: 0, pool: "pump" })).toThrow(/slippageBps/);
  });

  it("requestTradeLocal POSTs JSON and deserializes the returned transaction", async () => {
    const payer = new PublicKey(PK);
    const tx = unsignedTx(payer);
    const fetch = mockFetch({ "/api/trade-local": () => bytesResponse(tx.serialize()) });
    const got = await requestTradeLocal(buyBody({ publicKey: PK, mint: MINT, sol: 0.1, slippageBps: 100, priorityFeeSol: 0.0005, pool: "pump" }), {
      tradeLocalUrl: PUMPPORTAL_TRADE_LOCAL_URL,
      priorityFeeSol: 0.0005,
      pool: "pump",
      fetch,
    });
    expect(got).toBeInstanceOf(VersionedTransaction);
    expect(got.message.recentBlockhash).toBe(tx.message.recentBlockhash);
    expect(fetch.calls[0]!.init?.method).toBe("POST");
    expect((fetch.calls[0]!.json as { action: string }).action).toBe("buy");
    const bad = mockFetch({ "/api/trade-local": () => new Response("Invalid mint", { status: 400 }) });
    await expect(
      requestTradeLocal(buyBody({ publicKey: PK, mint: MINT, sol: 0.1, slippageBps: 100, priorityFeeSol: 0, pool: "pump" }), { tradeLocalUrl: PUMPPORTAL_TRADE_LOCAL_URL, priorityFeeSol: 0, pool: "pump", fetch: bad }),
    ).rejects.toBeInstanceOf(PumpPortalError);
  });

  it("metadata uploader needs PINATA_JWT or PUMPFUN_IPFS_URL", () => {
    expect(() => metadataUploaderFromEnv({})).toThrow(NotImplemented);
    expect(metadataUploaderFromEnv({ PINATA_JWT: "j" }).name).toBe("pinata");
    expect(metadataUploaderFromEnv({ PUMPFUN_IPFS_URL: "https://pump.fun/api/ipfs" }).name).toBe("pump.fun-ipfs");
  });
});

describe("PumpFunLauncher", () => {
  async function wallet(budgetSol: number) {
    return AgentWallet.open({ launchId: `L-${budgetSol}`, cluster: "devnet", budgetSol, keyStore: new MemoryKeyStore(), env: baseEnv() });
  }

  it("on devnet without an alternative endpoint, deploy/buy/sell/claim are NotImplemented with exact needs", async () => {
    const w = await wallet(1);
    const l = new PumpFunLauncher({ wallet: w, rpc: mockRpc(), cluster: "devnet", env: baseEnv(), fetch: mockFetch({}) });
    await expect(l.buy({ coinCa: MINT, sol: 0.1, slippageBps: 100, reason: "t" })).rejects.toBeInstanceOf(NotImplemented);
    try {
      await l.deploy({ identity: { name: "A", ticker: "A", lore: "", hook: "", trend: "" }, logoUrl: "https://x/l.png", siteUrl: "https://x", devBuySol: 0.1 });
    } catch (e) {
      expect(e).toBeInstanceOf(NotImplemented);
      expect((e as NotImplemented).needs.join(" ")).toMatch(/PUMPPORTAL_URL/);
      expect((e as NotImplemented).because).toMatch(/mainnet only/);
    }
  });

  it("buy beyond the wallet budget throws BudgetExceeded before anything is signed", async () => {
    const w = await wallet(0.05);
    const tx = unsignedTx(w.publicKey);
    const fetch = mockFetch({ "/trade-local": () => bytesResponse(tx.serialize()) });
    const rpc = mockRpc({ balances: [1e9] });
    const l = new PumpFunLauncher({ wallet: w, rpc, cluster: "devnet", env: baseEnv({ PUMPPORTAL_URL: "https://devnet-fork.example/trade-local" }), fetch });
    await expect(l.buy({ coinCa: MINT, sol: 0.1, slippageBps: 100, reason: "over" })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(rpc.sent).toHaveLength(0);
    expect(estimateBuyCostSol(0.1, 0.0005)).toBeGreaterThan(0.1);
  });

  it("deploy uploads metadata, requests a create tx with the fresh mint, signs with mint + wallet, confirms", async () => {
    const w = await wallet(1);
    const rpc = mockRpc({ balances: [1e9, 1e9 - 55_000_000] });
    const fetch = mockFetch({
      "uploads.pinata.cloud": (call) => jsonResponse({ data: { cid: String(call.init?.body instanceof FormData ? "cidX" : "cidY") } }),
      "/trade-local": (call) => {
        const body = call.json as { mint: string; publicKey: string; action: string };
        expect(body.action).toBe("create");
        expect(body.publicKey).toBe(w.address);
        return bytesResponse(unsignedTx(w.publicKey, [new PublicKey(body.mint)]).serialize());
      },
    });
    const l = new PumpFunLauncher({
      wallet: w,
      rpc,
      cluster: "devnet",
      env: baseEnv({ PUMPPORTAL_URL: "https://devnet-fork.example/trade-local", PINATA_JWT: "jwt" }),
      fetch,
      fetchLogo: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }),
    });
    const r = await l.deploy({
      identity: { name: "Quanta", ticker: "QNT", lore: "lore", hook: "", trend: "" },
      logoUrl: "https://img/logo.png",
      siteUrl: "https://quanta.quantagent.site",
      xUrl: "https://x.com/quanta",
      devBuySol: 0.05,
    });
    expect(r.txSignature).toBe("sig1");
    expect(r.devBuySignature).toBe("sig1");
    expect(r.metadataUri).toMatch(/cidX$/);
    const create = fetch.calls.find((c) => c.url.includes("trade-local"))!.json as { tokenMetadata: { name: string; symbol: string; uri: string }; mint: string };
    expect(create.tokenMetadata).toEqual({ name: "Quanta", symbol: "QNT", uri: r.metadataUri });
    expect(create.mint).toBe(r.coinCa);
    expect(rpc.sent).toHaveLength(1);
    const sent = VersionedTransaction.deserialize(rpc.sent[0]!);
    expect(sent.signatures).toHaveLength(2);
    expect(sent.signatures.every((s) => s.some((b) => b !== 0))).toBe(true);
    expect(w.spentSol).toBeCloseTo(0.055, 9);
  });
});
