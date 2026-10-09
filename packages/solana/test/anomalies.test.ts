import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { BundleFlag } from "@quantagent/core/types";
import {
  AnomalyDetector,
  createHeliusWebhookHandler,
  createWebhook,
  normalizeEnhanced,
  normalizeParsed,
  rpcHolderCounter,
  watchAnomalies,
  watchMilestones,
  WebhookHub,
  type NormalizedTx,
} from "../src/anomalies/index";
import { jsonResponse, mockFetch, mockRpc } from "./helpers";

const MINT = Keypair.generate().publicKey.toBase58();
const CREATOR = "CreatorWallet111111111111111111111111111111";
const CURVE = "BondingCurve1111111111111111111111111111111";

function tx(p: Partial<NormalizedTx> & { signature: string; slot: number }): NormalizedTx {
  return { blockTime: 1_700_000_000, feePayer: "", tokenTransfers: [], nativeTransfers: [], ...p };
}

describe("AnomalyDetector", () => {
  const base = { coinCa: MINT, creator: CREATOR, bondingCurve: CURVE, createSlot: 100, createdAtMs: 1_700_000_000_000, minBundleBuys: 3, bundleSlotWindow: 0, devSellWindowMs: 30 * 60_000 };

  it("flags a bundled launch when ≥ minBundleBuys wallets buy in the create slot (curve + creator excluded)", () => {
    const d = new AnomalyDetector(base);
    const first = d.ingest([
      tx({ signature: "s1", slot: 100, tokenTransfers: [{ from: CURVE, to: "A", mint: MINT, amount: 10 }, { from: CURVE, to: CREATOR, mint: MINT, amount: 5 }] }),
      tx({ signature: "s2", slot: 100, tokenTransfers: [{ from: CURVE, to: "B", mint: MINT, amount: 10 }] }),
      tx({ signature: "s3", slot: 101, tokenTransfers: [{ from: CURVE, to: "C", mint: MINT, amount: 10 }] }),
    ]);
    expect(first).toEqual([]);
    const flags = d.ingest([tx({ signature: "s4", slot: 100, tokenTransfers: [{ from: CURVE, to: "D", mint: MINT, amount: 1 }] })]);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.kind).toBe("bundled-launch");
    expect(flags[0]!.txSignatures.sort()).toEqual(["s1", "s2", "s4"]);
    expect(flags[0]!.evidence).toMatch(/3 distinct wallets bought in the create slot 100/);
    // only once
    expect(d.ingest([tx({ signature: "s5", slot: 100, tokenTransfers: [{ from: CURVE, to: "E", mint: MINT, amount: 1 }] })])).toEqual([]);
  });

  it("flags the creator moving coins within the window, not after", () => {
    const d = new AnomalyDetector(base);
    const inWindow = d.ingest([tx({ signature: "d1", slot: 200, blockTime: 1_700_000_000 + 600, tokenTransfers: [{ from: CREATOR, to: CURVE, mint: MINT, amount: 1000 }] })]);
    expect(inWindow.map((f) => f.kind)).toEqual(["dev-wallet-anomaly"]);
    expect(inWindow[0]!.evidence).toMatch(/10\.0 min after launch/);
    expect(inWindow[0]!.txSignatures).toEqual(["d1"]);
    const late = d.ingest([tx({ signature: "d2", slot: 9000, blockTime: 1_700_000_000 + 3 * 3600, tokenTransfers: [{ from: CREATOR, to: "X", mint: MINT, amount: 1 }] })]);
    expect(late).toEqual([]);
  });

  it("learns creator and create slot from a CREATE transaction when not given", () => {
    const d = new AnomalyDetector({ ...base, creator: null, createSlot: null, createdAtMs: null });
    d.ingest([tx({ signature: "c", slot: 50, feePayer: "Dev", type: "CREATE", tokenTransfers: [{ from: "", to: "Dev", mint: MINT, amount: 1 }] })]);
    expect(d.creator).toBe("Dev");
    expect(d.createSlot).toBe(50);
  });
});

describe("Helius webhook", () => {
  it("registers with the documented body and cluster-specific webhookType", async () => {
    const fetch = mockFetch({ "api.helius.xyz/v0/webhooks": () => jsonResponse({ webhookID: "wh-1" }) });
    const cfg = { apiKey: "K", webhookUrl: "https://app/hooks/helius", secret: "S", fetch };
    const r = await createWebhook({ addresses: [MINT, CREATOR], cluster: "devnet" }, cfg);
    expect(r.webhookID).toBe("wh-1");
    expect(fetch.calls[0]!.url).toBe("https://api.helius.xyz/v0/webhooks?api-key=K");
    expect(fetch.calls[0]!.json).toEqual({
      webhookURL: "https://app/hooks/helius",
      transactionTypes: ["ANY"],
      accountAddresses: [MINT, CREATOR],
      webhookType: "enhancedDevnet",
      authHeader: "S",
      txnStatus: "success",
    });
  });

  it("handler checks the secret, normalizes enhanced transactions and routes by mint", () => {
    const hub = new WebhookHub();
    const got: NormalizedTx[] = [];
    hub.subscribe(MINT, (txs) => got.push(...txs));
    const handler = createHeliusWebhookHandler({ secret: "S", hub });
    const payload = [
      { signature: "e1", slot: 5, timestamp: 1_700_000_000, type: "SWAP", source: "PUMP_FUN", feePayer: "A", tokenTransfers: [{ fromUserAccount: CURVE, toUserAccount: "A", tokenAmount: 12.5, mint: MINT }], nativeTransfers: [{ fromUserAccount: "A", toUserAccount: CURVE, amount: 100 }] },
      { signature: "e2", slot: 5, feePayer: "B", tokenTransfers: [{ fromUserAccount: "B", toUserAccount: "C", tokenAmount: 1, mint: "OtherMint" }] },
    ];
    expect(handler({ headers: { authorization: "wrong" }, body: payload }).status).toBe(401);
    expect(handler({ headers: { authorization: "S" }, body: "{" }).status).toBe(400);
    const ok = handler({ headers: { Authorization: "S" }, body: JSON.stringify(payload) });
    expect(ok.status).toBe(200);
    expect(got).toEqual([
      {
        signature: "e1",
        slot: 5,
        blockTime: 1_700_000_000,
        feePayer: "A",
        type: "SWAP",
        source: "PUMP_FUN",
        tokenTransfers: [{ from: CURVE, to: "A", mint: MINT, amount: 12.5 }],
        nativeTransfers: [{ from: "A", to: CURVE, lamports: 100 }],
      },
    ]);
    expect(normalizeEnhanced({ signature: "x", slot: 1 })).toMatchObject({ feePayer: "", blockTime: null, tokenTransfers: [] });
  });

  it("watchAnomalies with Helius config registers a webhook and deletes it on stop", async () => {
    const fetch = mockFetch({
      "api.helius.xyz/v0/webhooks": (c) => (c.init?.method === "DELETE" ? new Response("", { status: 200 }) : jsonResponse({ webhookID: "wh-9" })),
      "/coins/": () => jsonResponse({ mint: MINT, name: "Q", symbol: "Q", creator: CREATOR, bonding_curve: CURVE, created_timestamp: 1_700_000_000_000 }),
    });
    const hub = new WebhookHub();
    const flags: BundleFlag[] = [];
    const stop = await watchAnomalies(
      { coinCa: MINT, onFlag: (f) => flags.push(f) },
      { rpc: mockRpc(), cluster: "devnet", env: {}, fetch, hub, helius: { apiKey: "K", webhookUrl: "https://app/h", secret: "S", fetch } },
    );
    expect(hub.size).toBe(1);
    const reg = fetch.calls.find((c) => c.url.includes("v0/webhooks"))!.json as { accountAddresses: string[] };
    expect(reg.accountAddresses).toEqual([MINT, CREATOR]);
    hub.dispatch([tx({ signature: "d1", slot: 10, blockTime: 1_700_000_000 + 60, tokenTransfers: [{ from: CREATOR, to: CURVE, mint: MINT, amount: 5 }] })]);
    expect(flags.map((f) => f.kind)).toEqual(["dev-wallet-anomaly"]);
    stop();
    await new Promise((r) => setTimeout(r, 0));
    expect(hub.size).toBe(0);
    expect(fetch.calls.some((c) => c.url.includes("/v0/webhooks/wh-9") && c.init?.method === "DELETE")).toBe(true);
  });
});

describe("RPC polling fallback", () => {
  it("normalizeParsed derives token flows from pre/post balances", () => {
    const payer = Keypair.generate().publicKey;
    const parsed = {
      slot: 77,
      blockTime: 1_700_000_100,
      transaction: { message: { accountKeys: [{ pubkey: payer }, { pubkey: new PublicKey(MINT) }] } },
      meta: {
        err: null,
        preBalances: [10, 0],
        postBalances: [5, 5],
        preTokenBalances: [
          { accountIndex: 2, mint: MINT, owner: CURVE, uiTokenAmount: { uiAmount: 1000 } },
          { accountIndex: 3, mint: MINT, owner: "Buyer", uiTokenAmount: { uiAmount: 0 } },
        ],
        postTokenBalances: [
          { accountIndex: 2, mint: MINT, owner: CURVE, uiTokenAmount: { uiAmount: 900 } },
          { accountIndex: 3, mint: MINT, owner: "Buyer", uiTokenAmount: { uiAmount: 100 } },
        ],
      },
    };
    const n = normalizeParsed("sigP", parsed as never, MINT)!;
    expect(n.slot).toBe(77);
    expect(n.feePayer).toBe(payer.toBase58());
    // one entry per non-zero owner delta; both resolve to curve → buyer
    expect(n.tokenTransfers).toEqual([
      { from: CURVE, to: "Buyer", mint: MINT, amount: 100 },
      { from: CURVE, to: "Buyer", mint: MINT, amount: 100 },
    ]);
    expect(n.nativeTransfers).toEqual([{ from: payer.toBase58(), to: MINT, lamports: 5 }]);
  });

  it("watchAnomalies polls getSignaturesForAddress when Helius is not configured", async () => {
    const rpc = mockRpc();
    let calls = 0;
    (rpc as { getSignaturesForAddress: unknown }).getSignaturesForAddress = async () => {
      calls++;
      return [];
    };
    const timers: { fn: () => void; ms: number }[] = [];
    const stop = await watchAnomalies(
      { coinCa: MINT, onFlag: () => {} },
      {
        rpc,
        cluster: "devnet",
        env: { ANOMALY_POLL_MS: "5000" },
        fetch: mockFetch({ "/coins/": () => new Response("", { status: 404 }) }),
        helius: null,
        setInterval: ((fn: () => void, ms: number) => {
          timers.push({ fn, ms });
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearInterval: (() => timers.pop()) as typeof clearInterval,
      },
    );
    expect(calls).toBeGreaterThanOrEqual(2); // create lookup + first tick
    expect(timers[0]!.ms).toBe(5000);
    stop();
    expect(timers).toHaveLength(0);
  });
});

describe("milestones", () => {
  it("emits each threshold once, ascending, from env-configured lists", async () => {
    const seen: { kind: string; value: number }[] = [];
    let mcap = 60_000;
    let holders = 120;
    const timers: (() => void)[] = [];
    const stop = await watchMilestones(
      { coinCa: MINT, onMilestone: (m) => seen.push(m) },
      {
        rpc: mockRpc(),
        cluster: "devnet",
        env: { MILESTONE_MCAP_USD: "10000,50000,100000", MILESTONE_HOLDERS: "100,500" },
        mcapUsdOf: async () => mcap,
        holderCounter: async () => holders,
        setInterval: ((fn: () => void) => {
          timers.push(fn);
          return 0 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearInterval: (() => {}) as typeof clearInterval,
      },
    );
    expect(seen).toEqual([
      { kind: "mcap", value: 10_000 },
      { kind: "mcap", value: 50_000 },
      { kind: "holders", value: 100 },
    ]);
    mcap = 250_000;
    holders = 90;
    timers[0]!();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.slice(3)).toEqual([{ kind: "mcap", value: 100_000 }]);
    stop();
  });

  it("rpcHolderCounter counts token accounts with a non-zero amount", async () => {
    const rpc = mockRpc();
    const amt = (n: bigint) => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(n);
      return { pubkey: Keypair.generate().publicKey, account: { data: b } };
    };
    (rpc as { getProgramAccounts: unknown }).getProgramAccounts = async () => [amt(5n), amt(0n), amt(1n)];
    expect(await rpcHolderCounter(rpc)(MINT)).toBe(2);
  });
});
