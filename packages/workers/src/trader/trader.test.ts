import { describe, expect, it } from "vitest";
import { FAKE_CA, fakeSolana, harness, until } from "../testing/fakes";
import { TraderWorker, type PriceFeed } from "./trader";

const OTHER_CA = "OtherCA111111111111111111111111111111111111";
const T0 = 1_800_000_000_000;

function feedOf(prices: number[]): PriceFeed & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    async price({ coinCa }) {
      calls.push(coinCa);
      const price = prices[Math.min(i, prices.length - 1)] ?? 1;
      i++;
      return { price };
    },
  };
}

function deployed(h: ReturnType<typeof harness>): void {
  h.emit({ type: "Launcher.deployed", reason: "test", payload: { coinCa: FAKE_CA, txSignature: "deploy-sig", identityRoot: "root" } });
}

describe("TraderWorker", () => {
  it("fails with NotImplemented naming the solana env vars when no solana client is wired", async () => {
    const h = harness(new TraderWorker(), { clients: {} });
    const status = await h.start();
    expect(status).toBe("failed");
    const failed = h.ofType("Worker.failed")[0]!;
    expect(failed.reason).toMatch(/NotImplemented/);
    expect(failed.reason).toMatch(/SOLANA_RPC_URL/);
    expect(failed.reason).toMatch(/AGENT_WALLET_KEY/);
    await h.stop();
  });

  it("at launch only observes the deploy and the dev buy, then is done", async () => {
    const buys: unknown[] = [];
    const solana = fakeSolana({
      async buy(input) {
        buys.push(input);
        return { txSignature: "buy-sig" };
      },
    });
    const h = harness(new TraderWorker(), { clients: { solana } });
    const started = h.start();
    await h.waitFor("Worker.progress", { predicate: (e) => e.payload.step === "observe" });
    deployed(h);
    h.emit({ type: "Launcher.devBuy", reason: "test", payload: { txSignature: "devbuy-sig", sol: 0.1 } });
    expect(await started).toBe("done");
    const done = h.ofType("Worker.done")[0]!;
    expect(done.payload.outputs.coinCa).toBe(FAKE_CA);
    expect(done.payload.outputs.devBuy).toEqual({ txSignature: "devbuy-sig", sol: 0.1 });
    expect(h.ofType("Worker.progress").map((e) => e.payload.step)).toContain("devBuy.observed");
    expect(buys).toHaveLength(0);
    expect(h.ofType("Trader.traded")).toHaveLength(0);
    await h.stop();
  });

  it("fails instead of hanging when the Launcher fails before deploying", async () => {
    const h = harness(new TraderWorker(), { clients: { solana: fakeSolana() } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    h.emit({ type: "Worker.failed", worker: "Launcher", reason: "rpc down", payload: { reason: "rpc down" } });
    expect(await started).toBe("failed");
    expect(h.ofType("Worker.failed").find((e) => e.worker === "Trader")!.reason).toMatch(/Launcher failed before deploying/);
    await h.stop();
  });

  it("buys on the dip through the trades gate, spends SOL first and logs the signature", async () => {
    const buys: { coinCa: string; sol: number; slippageBps: number; reason: string }[] = [];
    const solana = fakeSolana({
      async buy(input) {
        buys.push(input);
        return { txSignature: "buy-sig-1" };
      },
    });
    let now = T0;
    const feed = feedOf([1.0, 0.75, 0.74]);
    const worker = new TraderWorker({ priceFeed: feed, now: () => now, config: { buySol: 0.02 } });
    const h = harness(worker, { clients: { solana }, budget: { sol: 0.05 }, options: { devBuySol: 0 } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    deployed(h);
    expect(await started).toBe("done");

    // not live yet: hold, no feed call
    await h.run.tick();
    expect(feed.calls).toHaveLength(0);
    expect(h.ofType("Worker.progress").at(-1)!.reason).toMatch(/not live yet/);

    h.emit({ type: "Launch.live", reason: "test", payload: { coinCa: FAKE_CA, siteUrl: "https://cat.quantagent.site" } });
    await h.settle();

    // first sample: nothing to dip from
    await h.run.tick();
    expect(feed.calls).toEqual([FAKE_CA]);
    expect(h.ofType("Worker.progress").at(-1)!.payload.step).toBe("decide");
    expect(h.ofType("Worker.progress").at(-1)!.reason).toMatch(/no price sample/);

    // second sample, 25% under the 1h high: a gated buy
    now += 60_000;
    const ticking = h.run.tick();
    const awaiting = await h.waitFor("Worker.awaitingApproval");
    expect(awaiting.payload.approval.actionClass).toBe("trades");
    expect(awaiting.payload.approval.draft).toMatchObject({ side: "buy", coinCa: FAKE_CA, sol: 0.02, slippageBps: 500 });
    expect(buys).toHaveLength(0);
    h.gate.resolve(awaiting.payload.approval.id, "approve");
    await ticking;

    expect(buys).toEqual([{ coinCa: FAKE_CA, sol: 0.02, slippageBps: 500, reason: expect.stringMatching(/support buy/) }]);
    const traded = h.ofType("Trader.traded");
    expect(traded).toHaveLength(1);
    expect(traded[0]!.payload).toEqual({ side: "buy", sol: 0.02, txSignature: "buy-sig-1", price: 0.75 });
    expect(traded[0]!.reason).toMatch(/buy-sig-1/);
    const spent = h.ofType("Worker.spent").filter((e) => e.payload.dimension === "sol");
    expect(spent).toHaveLength(1);
    expect(spent[0]!.payload.amount).toBe(0.02);
    expect(spent[0]!.seq).toBeLessThan(traded[0]!.seq);

    // third tick, one minute later and still dipped: rate-limited
    now += 60_000;
    await h.run.tick();
    expect(buys).toHaveLength(1);
    expect(h.ofType("Worker.progress").at(-1)!.reason).toMatch(/one buy per 15 min/);
    await h.stop();
  });

  it("emits Trader.rejected when the user skips, and nothing is bought", async () => {
    const buys: unknown[] = [];
    const solana = fakeSolana({
      async buy(input) {
        buys.push(input);
        return { txSignature: "x" };
      },
    });
    let now = T0;
    const worker = new TraderWorker({ priceFeed: feedOf([1, 0.5]), now: () => now });
    const h = harness(worker, { clients: { solana }, options: { devBuySol: 0 } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    deployed(h);
    await started;
    h.emit({ type: "Launch.live", reason: "test", payload: { coinCa: FAKE_CA, siteUrl: "https://s" } });
    await h.settle();
    await h.run.tick();
    now += 60_000;
    const ticking = h.run.tick();
    const awaiting = await h.waitFor("Worker.awaitingApproval");
    h.gate.resolve(awaiting.payload.approval.id, "skip");
    await ticking;
    expect(buys).toHaveLength(0);
    expect(h.ofType("Trader.rejected")[0]!.payload).toMatchObject({ side: "buy", reason: "skipped by the user" });
    expect(h.run.status).toBe("done"); // a skip is not a failure
    await h.stop();
  });

  it("honours an edited amount and uses autopilot.trades without a tap", async () => {
    const buys: { sol: number }[] = [];
    const solana = fakeSolana({
      async buy(input) {
        buys.push({ sol: input.sol });
        return { txSignature: "x" };
      },
    });
    let now = T0;
    const worker = new TraderWorker({ priceFeed: feedOf([1, 0.5, 0.5]), now: () => now, config: { minBuyIntervalMs: 0 } });
    const h = harness(worker, { clients: { solana }, options: { devBuySol: 0 }, budget: { sol: 1 } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    deployed(h);
    await started;
    h.emit({ type: "Launch.live", reason: "test", payload: { coinCa: FAKE_CA, siteUrl: "https://s" } });
    await h.settle();
    await h.run.tick();
    now += 60_000;
    const ticking = h.run.tick();
    const awaiting = await h.waitFor("Worker.awaitingApproval");
    h.gate.resolve(awaiting.payload.approval.id, "edit", { ...awaiting.payload.approval.draft, sol: 0.03 });
    await ticking;
    expect(buys).toEqual([{ sol: 0.03 }]);
    await h.stop();
  });

  it("throws (and fails) when asked to trade a different CA", async () => {
    const buys: unknown[] = [];
    const solana = fakeSolana({
      async buy(input) {
        buys.push(input);
        return { txSignature: "x" };
      },
    });
    let now = T0;
    const worker = new TraderWorker({ priceFeed: feedOf([1, 0.5]), now: () => now });
    const h = harness(worker, { clients: { solana }, options: { devBuySol: 0 } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    deployed(h);
    await started;
    h.emit({ type: "Launch.live", reason: "test", payload: { coinCa: FAKE_CA, siteUrl: "https://s" } });
    await h.settle();
    await h.run.tick();
    now += 60_000;
    const ticking = h.run.tick();
    const awaiting = await h.waitFor("Worker.awaitingApproval");
    // the user (or anything else) edits the draft to another coin: refused before any trade
    h.gate.resolve(awaiting.payload.approval.id, "edit", { ...awaiting.payload.approval.draft, coinCa: OTHER_CA });
    await ticking;
    expect(buys).toHaveLength(0);
    expect(h.run.status).toBe("failed");
    expect(h.ofType("Worker.failed").find((e) => e.worker === "Trader")!.reason).toMatch(/WrongCoin.*refuses to trade/);
    await h.stop();
  });

  it("fails with NotImplemented naming TRADER_PRICE_FEED_URL when no price feed is injected", async () => {
    const worker = new TraderWorker();
    const h = harness(worker, { clients: { solana: fakeSolana() }, options: { devBuySol: 0 } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    deployed(h);
    await started;
    h.emit({ type: "Launch.live", reason: "test", payload: { coinCa: FAKE_CA, siteUrl: "https://s" } });
    await h.settle();
    await h.run.tick();
    await until(() => h.ofType("Worker.failed").length > 0);
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/NotImplemented.*TRADER_PRICE_FEED_URL/);
    await h.stop();
  });
});
