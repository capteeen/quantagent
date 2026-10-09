import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import type { Identity, ImageAsset } from "@quantagent/core/types";
import { createLauncher, QSD_SKIPPED_REASON } from "./launcher";
import { FAKE_CA, fakeSolana, harness } from "../testing/fakes";

const IDENTITY: Identity = { name: "Qubit Cat", ticker: "QCAT", lore: "two boxes", hook: "based", trend: "none" };
const LOGO: ImageAsset = { url: "https://cdn.test/logo.png", kind: "logo", width: 1024, height: 1024, externalId: "gen-1", phash: "0".repeat(16) };

describe("LauncherWorker", () => {
  it("waits for Ideator.named and Artist.logoReady in either order, runs QSD stages, deploys with the dev buy", async () => {
    const calls: unknown[] = [];
    const solana = fakeSolana({
      async deployPumpFun(input) {
        calls.push(input);
        return { coinCa: FAKE_CA, txSignature: "deploy-sig", devBuySignature: "devbuy-sig" };
      },
    });
    const h = harness(createLauncher(), { clients: { solana }, options: { devBuySol: 0.25 } });
    const finished = h.start();
    h.emit({ type: "Builder.published", reason: "test", payload: { url: "https://qcat.quantagent.site", deployId: "d1", trigger: "t0" } });
    h.emit({ type: "Artist.logoReady", reason: "test", payload: { asset: LOGO } }); // logo first
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(0);
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity: IDENTITY } });
    expect(await finished).toBe("done");

    expect(calls[0]).toMatchObject({ identity: IDENTITY, logoUrl: LOGO.url, siteUrl: "https://qcat.quantagent.site", devBuySol: 0.25 });
    const stages = h.ofType("Launcher.qsdStage").map((e) => e.payload.stage);
    expect(stages).toEqual(["keyGeneration", "superposition", "quantumDraw", "signing", "anchoring"]);
    expect(h.ofType("Launcher.chainStep")).toHaveLength(1);
    expect(h.ofType("Launcher.treeLevelFused")).toHaveLength(1);
    expect(h.ofType("Launcher.signChainStop")).toHaveLength(1);
    const deployed = h.ofType("Launcher.deployed")[0]!;
    expect(deployed.payload).toEqual({ coinCa: FAKE_CA, txSignature: "deploy-sig", identityRoot: "root-abc" });
    expect(deployed.reason).toContain(FAKE_CA);
    const devBuy = h.ofType("Launcher.devBuy")[0]!;
    expect(devBuy.payload).toEqual({ txSignature: "devbuy-sig", sol: 0.25 });
    // the dev buy was charged to the SOL budget by the scoped client
    expect(h.ofType("Worker.spent").some((e) => e.payload.dimension === "sol" && e.payload.amount === 0.25)).toBe(true);
    const outputs = h.ofType("Worker.done")[0]!.payload.outputs;
    expect(outputs).toMatchObject({ coinCa: FAKE_CA, qsd: "ran", identityRoot: "root-abc", anchorTx: "anchor-sig" });
    expect(h.ofType("Worker.progress").map((e) => e.payload.step)).toContain("qsd.registered");
    await h.stop();
  });

  it("skips QSD with a logged reason when the client throws NotImplemented, and still deploys (identityRoot empty)", async () => {
    const solana = fakeSolana({
      async qsdLaunch() {
        throw new NotImplemented("Solana.qsdLaunch", "qsd-market repo not linked", ["QSD_REPO_PATH"]);
      },
    });
    const h = harness(createLauncher(), { clients: { solana } });
    const finished = h.start();
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity: IDENTITY } });
    h.emit({ type: "Artist.logoReady", reason: "test", payload: { asset: LOGO } });
    expect(await finished).toBe("done");

    const skipped = h.ofType("Worker.progress").find((e) => e.payload.step === "qsd-skipped")!;
    expect(skipped.reason).toBe(QSD_SKIPPED_REASON);
    expect(skipped.payload.detail).toMatchObject({ reason: QSD_SKIPPED_REASON, needs: ["QSD_REPO_PATH"] });
    expect(h.ofType("Launcher.qsdStage")).toHaveLength(0);
    const deployed = h.ofType("Launcher.deployed")[0]!;
    expect(deployed.payload).toEqual({ coinCa: FAKE_CA, txSignature: "deploy-sig-QCAT", identityRoot: "" });
    expect(deployed.reason).toMatch(/QSD skipped/);
    expect(h.ofType("Launcher.devBuy")[0]!.payload.sol).toBe(0.1); // default dev buy
    expect(h.ofType("Worker.done")[0]!.payload.outputs).toMatchObject({ qsd: "skipped", identityRoot: "", proof: null });
    await h.stop();
  });

  it("fails the worker on any other QSD error (never deploys)", async () => {
    let deploys = 0;
    const solana = fakeSolana({
      async qsdLaunch() {
        throw new Error("anchor tx rejected");
      },
      async deployPumpFun() {
        deploys++;
        return { coinCa: FAKE_CA, txSignature: "x", devBuySignature: "y" };
      },
    });
    const h = harness(createLauncher(), { clients: { solana } });
    const finished = h.start();
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity: IDENTITY } });
    h.emit({ type: "Artist.logoReady", reason: "test", payload: { asset: LOGO } });
    expect(await finished).toBe("failed");
    expect(deploys).toBe(0);
    expect(h.ofType("Launcher.deployed")).toHaveLength(0);
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/anchor tx rejected/);
    await h.stop();
  });

  it("refuses to announce a malformed mint address", async () => {
    const solana = fakeSolana({ async deployPumpFun() { return { coinCa: "not-a-mint", txSignature: "x", devBuySignature: "y" }; } });
    const h = harness(createLauncher(), { clients: { solana } });
    const finished = h.start();
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity: IDENTITY } });
    h.emit({ type: "Artist.logoReady", reason: "test", payload: { asset: LOGO } });
    expect(await finished).toBe("failed");
    expect(h.ofType("Launcher.deployed")).toHaveLength(0);
    await h.stop();
  });

  it("fails with NotImplemented naming the Solana env vars when no client is wired", async () => {
    const h = harness(createLauncher(), { clients: {} });
    expect(await h.start()).toBe("failed");
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/SOLANA_RPC_URL/);
    await h.stop();
  });

  it("stops cleanly while still waiting for inputs", async () => {
    const h = harness(createLauncher(), { clients: { solana: fakeSolana() } });
    const finished = h.start();
    await new Promise((r) => setTimeout(r, 5));
    await h.run.stop();
    expect(await finished).toBe("stopped");
    expect(h.ofType("Launcher.deployed")).toHaveLength(0);
    await h.bus.close();
  });
});

describe("LauncherWorker when a producer dies before its input is ready (audit F2)", () => {
  it("fails with 'Ideator failed before naming the coin: <reason>' instead of waiting forever", async () => {
    const h = harness(createLauncher(), { clients: { solana: fakeSolana() } });
    const finished = h.start();
    await h.waitFor("Worker.progress");
    h.emit({ type: "Artist.logoReady", reason: "test", payload: { asset: LOGO } });
    h.emit({ type: "Worker.failed", worker: "Ideator", reason: "llm down", payload: { reason: "llm down" } });
    expect(await finished).toBe("failed");
    expect(h.ofType("Worker.failed").find((e) => e.worker === "Launcher")!.reason).toMatch(/Ideator failed before naming the coin: llm down/);
    expect(h.ofType("Launcher.deployed")).toHaveLength(0);
    await h.stop();
  });

  it("fails with 'Artist failed before a logo was ready' instead of waiting forever", async () => {
    const h = harness(createLauncher(), { clients: { solana: fakeSolana() } });
    const finished = h.start();
    await h.waitFor("Worker.progress");
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity: IDENTITY } });
    h.emit({ type: "Worker.failed", worker: "Artist", reason: "provider refused", payload: { reason: "provider refused" } });
    expect(await finished).toBe("failed");
    expect(h.ofType("Worker.failed").find((e) => e.worker === "Launcher")!.reason).toMatch(/Artist failed before a logo was ready: provider refused/);
    expect(h.ofType("Launcher.deployed")).toHaveLength(0);
    await h.stop();
  });

  it("fails on Launch.failed while an input is still missing", async () => {
    const h = harness(createLauncher(), { clients: { solana: fakeSolana() } });
    const finished = h.start();
    await h.waitFor("Worker.progress");
    h.emit({ type: "Launch.failed", reason: "stopped", payload: { reason: "stopped" } });
    expect(await finished).toBe("failed");
    expect(h.ofType("Worker.failed").find((e) => e.worker === "Launcher")!.reason).toMatch(/launch failed before the inputs were ready: stopped/);
    await h.stop();
  });

  it("an Artist that dies after the logo is in does not stop the deploy", async () => {
    const h = harness(createLauncher(), { clients: { solana: fakeSolana() } });
    const finished = h.start();
    await h.waitFor("Worker.progress");
    h.emit({ type: "Artist.logoReady", reason: "test", payload: { asset: LOGO } });
    h.emit({ type: "Worker.failed", worker: "Artist", reason: "banner failed", payload: { reason: "banner failed" } });
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity: IDENTITY } });
    expect(await finished).toBe("done");
    expect(h.ofType("Launcher.deployed")[0]!.payload.coinCa).toBe(FAKE_CA);
    await h.stop();
  });
});
