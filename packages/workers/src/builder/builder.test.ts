import { describe, expect, it } from "vitest";
import type { Identity, ImageAsset } from "@quantagent/core/types";
import { createBuilder } from "./builder";
import { emptySiteState, render, formatCompact, esc } from "./template";
import { renderOgSvg, OG_PATH } from "./og";
import { findBase58Addresses } from "../shared";
import { FAKE_CA, fakeHosting, harness } from "../testing/fakes";

const IDENTITY: Identity = { name: "Qubit Cat", ticker: "QCAT", lore: "A cat that lives in two boxes.\nBoth are based.", hook: "both alive & based", trend: "quantum" };
const LOGO: ImageAsset = { url: "https://cdn.test/launch/logo-1.png", kind: "logo", width: 1024, height: 1024, externalId: "g1" };
const BANNER: ImageAsset = { url: "https://cdn.test/launch/banner-2.png", kind: "banner", width: 1500, height: 500, externalId: "g2" };
const CHAR = (n: number): ImageAsset => ({ url: `https://cdn.test/launch/character-${n}.png`, kind: "character", width: 1024, height: 1024, externalId: `c${n}` });

describe("template.render (pure)", () => {
  it("shows pending launch with a live indicator before deploy and no base58 address anywhere", () => {
    const html = render(emptySiteState("launch-test-0001", "a cat that runs a quantum lab", "2026-10-09T00:00:00Z"));
    expect(html).toContain("CA: pending launch");
    expect(html).toContain('class="dot pending"');
    expect(html).not.toContain("pump.fun/coin/");
    expect(findBase58Addresses(html)).toEqual([]);
    expect(html).toContain("#06080A");
    expect(html).toContain("JetBrains Mono");
    expect(html).not.toMatch(/<script(?! async src="https:\/\/platform\.twitter\.com)/); // no JS of our own
    expect(html).toContain("No images yet");
    expect(html).toContain("Nothing posted yet");
  });
  it("is deterministic for the same state", () => {
    const s = emptySiteState("l", "p", "t");
    expect(render(s)).toBe(render(s));
  });
  it("renders the CA block, buy button and chart embed only with the deployed CA", () => {
    const s = emptySiteState("l", "p", "t");
    s.identity = IDENTITY;
    s.logo = LOGO;
    s.launch = { coinCa: FAKE_CA, txSignature: "sig", cluster: "devnet" };
    s.milestones.push({ kind: "mcap", value: 123_456, at: "t" }, { kind: "holders", value: 1_200, at: "t" });
    s.copycats.push({ source: "pump.fun", externalId: "x", url: "https://pump.fun/coin/x", match: "name", score: 0.9, seenAt: "t" });
    const html = render(s);
    expect(html).toContain(`https://pump.fun/coin/${FAKE_CA}`);
    expect(html).toContain(`dexscreener.com/solana/${FAKE_CA}`);
    expect(html).toContain('class="dot live"');
    expect(html).not.toContain("pending launch");
    expect(html).toContain("$123K");
    expect(html).toContain("Verify the real CA");
    expect([...new Set(findBase58Addresses(html))]).toEqual([FAKE_CA]);
    expect(html).toContain("<title>Qubit Cat ($QCAT)</title>");
    expect(html).toContain('rel="icon" href="https://cdn.test/launch/logo-1.png"');
  });
  it("escapes user text", () => {
    const s = emptySiteState("l", "<script>alert(1)</script>", "t");
    expect(render(s)).not.toContain("<script>alert");
    expect(esc("a&b")).toBe("a&amp;b");
    expect(formatCompact(12_000_000)).toBe("12M");
  });
  it("OG svg carries the ticker and the logo", () => {
    const svg = renderOgSvg({ identity: IDENTITY, logo: LOGO, pending: true });
    expect(svg).toContain("$QCAT");
    expect(svg).toContain(LOGO.url);
    expect(svg).toContain("CA: pending launch");
    expect(renderOgSvg({ pending: false })).toContain("live on pump.fun");
  });
});

describe("BuilderWorker", () => {
  it("publishes at t=0 with pending CA, patches on every trigger, patches the CA within one publish of Launcher.deployed", async () => {
    const hosting = fakeHosting();
    const h = harness(createBuilder(), { prompt: "a cat that runs a quantum lab", clients: { hosting } });
    const finished = h.start();
    const first = await h.waitFor("Builder.published");
    expect(first.payload.trigger).toBe("t0");
    expect(first.payload.url).toBe("https://q-launch-test-0001.quantagent.site");
    expect(hosting.publishes[0]!.html).toContain("CA: pending launch");
    expect(hosting.publishes[0]!.assets?.[0]?.path).toBe(OG_PATH);
    expect(hosting.publishes[0]!.assets?.[0]?.url.startsWith("data:image/svg+xml;base64,")).toBe(true);

    h.emit({ type: "Ideator.named", reason: "t", payload: { identity: IDENTITY } });
    await h.settle();
    h.emit({ type: "Artist.logoReady", reason: "t", payload: { asset: LOGO } });
    await h.settle();
    h.emit({ type: "Artist.bannerReady", reason: "t", payload: { asset: BANNER } });
    await h.settle();
    h.emit({ type: "Artist.imageReady", reason: "t", payload: { asset: CHAR(1) } });
    await h.settle();
    const named = hosting.publishes.find((p) => p.slug === "qcat")!;
    expect(named).toBeDefined();
    expect(named.html).toContain("Qubit Cat");
    expect(hosting.publishes.at(-1)!.html).toContain(CHAR(1).url);
    expect(hosting.publishes.at(-1)!.html).toContain(BANNER.url);
    // still pending before deploy, and no base58 token anywhere
    for (const p of hosting.publishes) {
      expect(p.html).toContain("CA: pending launch");
      expect(findBase58Addresses(p.html)).toEqual([]);
    }

    const countBefore = hosting.publishes.length;
    h.emit({ type: "Launcher.deployed", reason: "t", payload: { coinCa: FAKE_CA, txSignature: "sig", identityRoot: "" } });
    expect(await finished).toBe("done");
    expect(hosting.publishes.length).toBe(countBefore + 1);
    const live = hosting.publishes.at(-1)!;
    expect(live.html).toContain(`https://pump.fun/coin/${FAKE_CA}`);
    expect(live.html).not.toContain("pending launch");
    expect([...new Set(findBase58Addresses(live.html))]).toEqual([FAKE_CA]);
    const pub = h.ofType("Builder.published").at(-1)!;
    expect(pub.payload.trigger).toBe("Launcher.deployed");
    expect(pub.reason).toContain(FAKE_CA);
    expect(h.ofType("Worker.done")[0]!.payload.outputs).toMatchObject({ slug: "qcat", coinCa: FAKE_CA, failures: 0 });

    // post-launch patches keep flowing: feed, stats, copycat banner
    h.emit({ type: "Voice.posted", reason: "t", payload: { postId: "1", url: "https://x.com/q/status/1", text: "we are live", kind: "thread" } });
    await h.settle();
    h.emit({ type: "Chain.milestone", reason: "t", payload: { kind: "holders", value: 420 } });
    await h.settle();
    h.emit({ type: "Shield.copycatFound", reason: "t", payload: { copycat: { source: "x", externalId: "p", url: "https://x.com/p", match: "ticker", score: 1, seenAt: "t" } } });
    await h.settle();
    const latest = hosting.publishes.at(-1)!.html;
    expect(latest).toContain("we are live");
    expect(latest).toContain("twitter-tweet");
    expect(latest).toContain("<b>420</b>");
    expect(latest).toContain("Verify the real CA");
    expect([...new Set(findBase58Addresses(latest))]).toEqual([FAKE_CA]);
    const triggers = h.ofType("Builder.published").map((e) => e.payload.trigger);
    expect(triggers).toEqual(expect.arrayContaining(["t0", "Ideator.named", "Artist.logoReady", "Artist.imageReady", "Launcher.deployed", "Voice.posted", "Chain.milestone", "Shield.copycatFound"]));
    expect(h.events.every((e) => e.reason.length > 0)).toBe(true);
    await h.stop();
  });

  it("coalesces a burst of triggers into one republish carrying the latest state", async () => {
    let release: (() => void) | undefined;
    const hosting = fakeHosting({
      async publish(input) {
        hosting.publishes.push(input);
        if (hosting.publishes.length === 2) await new Promise<void>((r) => { release = r; });
        return { url: `https://${input.slug}.quantagent.site`, deployId: `d${hosting.publishes.length}` };
      },
    });
    const h = harness(createBuilder(), { clients: { hosting } });
    const finished = h.start();
    await h.waitFor("Builder.published");
    h.emit({ type: "Artist.imageReady", reason: "t", payload: { asset: CHAR(1) } }); // publish #2, blocks
    await new Promise((r) => setTimeout(r, 5));
    h.emit({ type: "Artist.imageReady", reason: "t", payload: { asset: CHAR(2) } });
    h.emit({ type: "Artist.imageReady", reason: "t", payload: { asset: CHAR(3) } });
    h.emit({ type: "Ideator.named", reason: "t", payload: { identity: IDENTITY } });
    expect(hosting.publishes).toHaveLength(2);
    release!();
    await h.settle();
    expect(hosting.publishes).toHaveLength(3);
    expect(hosting.publishes[2]!.html).toContain(CHAR(3).url);
    expect(hosting.publishes[2]!.slug).toBe("qcat");
    expect(h.ofType("Builder.published")[2]!.payload.trigger).toBe("Artist.imageReady+Artist.imageReady+Ideator.named");
    h.emit({ type: "Launcher.deployed", reason: "t", payload: { coinCa: FAKE_CA, txSignature: "sig", identityRoot: "" } });
    expect(await finished).toBe("done");
    await h.stop();
  });

  it("emits Builder.patchFailed with the trigger when a republish fails, and keeps going", async () => {
    let fail = false;
    const hosting = fakeHosting({
      async publish(input) {
        hosting.publishes.push(input);
        if (fail) throw new Error("edge 502");
        return { url: `https://${input.slug}.quantagent.site`, deployId: `d${hosting.publishes.length}` };
      },
    });
    const h = harness(createBuilder(), { clients: { hosting } });
    const finished = h.start();
    await h.waitFor("Builder.published");
    fail = true;
    h.emit({ type: "Artist.imageReady", reason: "t", payload: { asset: CHAR(1) } });
    await h.settle();
    const failed = h.ofType("Builder.patchFailed")[0]!;
    expect(failed.payload).toEqual({ trigger: "Artist.imageReady", error: "Error: edge 502" });
    fail = false;
    h.emit({ type: "Launcher.deployed", reason: "t", payload: { coinCa: FAKE_CA, txSignature: "sig", identityRoot: "" } });
    expect(await finished).toBe("done");
    expect(h.ofType("Worker.done")[0]!.payload.outputs).toMatchObject({ failures: 1, deploys: 2 });
    await h.stop();
  });

  it("fails the worker when the first publish fails (no site link for the Voice)", async () => {
    const hosting = fakeHosting({ async publish() { throw new Error("no project"); } });
    const h = harness(createBuilder(), { clients: { hosting } });
    expect(await h.start()).toBe("failed");
    expect(h.ofType("Builder.patchFailed")[0]!.payload.trigger).toBe("t0");
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/initial publish failed/);
    await h.stop();
  });

  it("connects a custom domain after the first publish and logs the verification", async () => {
    const hosting = fakeHosting();
    const h = harness(createBuilder({ customDomain: "mycoin.xyz" }), { clients: { hosting } });
    const finished = h.start();
    await h.waitFor("Worker.progress", { predicate: (e) => e.payload.step === "domain" });
    expect(h.ofType("Worker.progress").find((e) => e.payload.step === "domain")!.reason).toMatch(/mycoin\.xyz/);
    h.emit({ type: "Launcher.deployed", reason: "t", payload: { coinCa: FAKE_CA, txSignature: "sig", identityRoot: "" } });
    await finished;
    await h.stop();
  });

  it("fails with NotImplemented naming HOSTING_PROVIDER when no hosting client is wired", async () => {
    const h = harness(createBuilder(), { clients: {} });
    expect(await h.start()).toBe("failed");
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/HOSTING_PROVIDER/);
    await h.stop();
  });
});
