import { describe, expect, it } from "vitest";
import type { BundleFlag, Copycat } from "@quantagent/core/types";
import { FAKE_CA, fakePost, fakeSolana, fakeX, harness, until } from "../testing/fakes";
import { addressesIn, extractKeywords, postToCopycat } from "./match";
import { ShieldWorker } from "./shield";

const OTHER_CA = "AnotherCA" + "1".repeat(34);
const identity = { name: "Schrodinger Cat", ticker: "SCAT", lore: "l", hook: "h", trend: "t" };

function copycat(over: Partial<Copycat> = {}): Copycat {
  return { source: "pump.fun", externalId: OTHER_CA, url: `https://pump.fun/coin/${OTHER_CA}`, match: "name", score: 0.95, seenAt: new Date().toISOString(), ...over };
}

describe("match helpers", () => {
  it("extracts prompt keywords without stopwords", () => {
    expect(extractKeywords("a cat that runs a quantum lab")).toEqual(["quantum"]);
    expect(extractKeywords("$DOGE killer frog coin on mars", 5)).toEqual(["doge", "killer", "frog", "mars"]);
  });

  it("finds base58 addresses in text", () => {
    expect(addressesIn(`CA: ${OTHER_CA} and https://x.com`)).toEqual([OTHER_CA]);
    expect(addressesIn("no address here")).toEqual([]);
  });

  it("turns a post naming us with a foreign CA into copycat evidence, and nothing else", () => {
    const base = { keywords: [], canonicalCa: FAKE_CA, ownAccountId: "me" };
    const hit = postToCopycat({ ...base, post: fakePost({ id: "p1", text: `$SCAT is live! CA: ${OTHER_CA}` }), ticker: "SCAT", name: "Schrodinger Cat" });
    expect(hit).toMatchObject({ source: "x", externalId: "p1", match: "ticker", score: 0.9 });
    expect(postToCopycat({ ...base, post: fakePost({ text: `$SCAT CA: ${FAKE_CA}` }), ticker: "SCAT" })).toBeNull();
    expect(postToCopycat({ ...base, post: fakePost({ text: `$SCAT to the moon` }), ticker: "SCAT" })).toBeNull();
    expect(postToCopycat({ ...base, post: fakePost({ authorId: "me", text: `$SCAT ${OTHER_CA}` }), ticker: "SCAT" })).toBeNull();
    expect(postToCopycat({ ...base, post: fakePost({ text: `$OTHER ${OTHER_CA}` }), ticker: "SCAT" })).toBeNull();
    const weak = postToCopycat({ ...base, post: fakePost({ text: `quantum cat coin ${OTHER_CA}` }), keywords: ["quantum"], canonicalCa: null });
    expect(weak?.score).toBe(0.4);
  });
});

describe("ShieldWorker", () => {
  it("fails with NotImplemented naming env vars when a client is missing", async () => {
    const h = harness(new ShieldWorker(), { clients: { x: fakeX() } });
    expect(await h.start()).toBe("failed");
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/NotImplemented.*SOLANA_RPC_URL/);
    await h.stop();
    const h2 = harness(new ShieldWorker(), { clients: { solana: fakeSolana() } });
    expect(await h2.start()).toBe("failed");
    expect(h2.ofType("Worker.failed")[0]!.reason).toMatch(/X_CLIENT_ID/);
    await h2.stop();
  });

  it("scans pump.fun and X from t=0 on prompt keywords, rescans on the name, by phash on the logo", async () => {
    const nameQueries: { name: string; ticker: string }[] = [];
    const logoQueries: { phash: string; threshold: number }[] = [];
    const searches: string[] = [];
    const solana = fakeSolana({
      async findNameMatches(q) {
        nameQueries.push(q);
        return q.name === "Schrodinger Cat" ? [copycat()] : [];
      },
      async findLogoMatches(q) {
        logoQueries.push(q);
        return [copycat({ externalId: "LogoCopy11111111111111111111111111111111111", match: "logo", score: 0.97 })];
      },
    });
    const x = fakeX({
      async search({ query }) {
        searches.push(query);
        return query === "$SCAT" ? [fakePost({ id: "px", text: `$SCAT launching now ${OTHER_CA}`, url: "https://x.com/i/status/px" })] : [];
      },
    });
    const h = harness(new ShieldWorker({ logoThreshold: 0.85 }), { clients: { solana, x }, prompt: "a cat that runs a quantum lab" });
    const started = h.start();
    await h.waitFor("Worker.progress", { predicate: (e) => e.payload.step === "scan.prompt.done" });
    expect(nameQueries[0]).toEqual({ name: "quantum", ticker: "QUANTU" });
    expect(searches).toContain("quantum");

    h.emit({ type: "Ideator.named", reason: "test", payload: { identity } });
    await h.settle();
    expect(nameQueries).toContainEqual({ name: "Schrodinger Cat", ticker: "SCAT" });
    expect(searches).toContain("$SCAT");
    const found = h.ofType("Shield.copycatFound");
    expect(found.map((e) => e.payload.copycat.externalId).sort()).toEqual([OTHER_CA, "px"].sort());
    expect(found[0]!.reason).toMatch(/matches our/);

    // same evidence again is not re-filed
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity } });
    await h.settle();
    expect(h.ofType("Shield.copycatFound")).toHaveLength(2);

    h.emit({ type: "Artist.logoReady", reason: "test", payload: { asset: { url: "https://img/logo.png", kind: "logo", width: 512, height: 512, externalId: "g1", phash: "abcd1234" } } });
    await h.settle();
    expect(logoQueries).toEqual([{ phash: "abcd1234", threshold: 0.85 }]);
    expect(h.ofType("Shield.copycatFound").at(-1)!.payload.copycat.match).toBe("logo");

    const reports = h.ofType("Shield.report");
    expect(reports.at(-1)!.payload.report.copycats).toHaveLength(3);
    expect(reports.at(-1)!.payload.report.canonicalCa).toBeNull();

    h.emit({ type: "Launcher.deployed", reason: "test", payload: { coinCa: FAKE_CA, txSignature: "sig", identityRoot: "root" } });
    expect(await started).toBe("done");
    const report = h.ofType("Worker.done")[0]!.payload.outputs.report as { canonicalCa: string; copycats: unknown[] };
    expect(report.canonicalCa).toBe(FAKE_CA);
    expect(report.copycats).toHaveLength(3);
    await h.stop();
  });

  it("registers the canonical CA synchronously on Launcher.deployed and watches anomalies", async () => {
    let onFlag: ((f: BundleFlag) => void) | null = null;
    let unwatched = 0;
    const solana = fakeSolana({
      async watchAnomalies(input) {
        onFlag = input.onFlag;
        return () => {
          unwatched++;
        };
      },
    });
    const h = harness(new ShieldWorker(), { clients: { solana, x: fakeX() }, prompt: "" });
    const started = h.start();
    await h.waitFor("Worker.progress", { predicate: (e) => e.payload.step === "scan.prompt.done" });

    h.emit({ type: "Launcher.deployed", reason: "test", payload: { coinCa: FAKE_CA, txSignature: "sig", identityRoot: "root" } });
    // synchronous: already on the bus when emit() returns
    const registered = h.ofType("Shield.canonicalRegistered");
    expect(registered).toHaveLength(1);
    expect(registered[0]!.payload.coinCa).toBe(FAKE_CA);
    expect(h.ofType("Shield.report").at(-1)!.payload.report.canonicalCa).toBe(FAKE_CA);
    expect(await started).toBe("done");
    await until(() => onFlag !== null);

    const flag: BundleFlag = { kind: "bundled-launch", evidence: "7 wallets funded by one source bought in the deploy block", txSignatures: ["t1", "t2"], seenAt: new Date().toISOString() };
    onFlag!(flag);
    const flags = h.ofType("Shield.bundleFlag");
    expect(flags).toHaveLength(1);
    expect(flags[0]!.payload.flag).toEqual(flag);
    expect(flags[0]!.reason).toMatch(/bundled-launch/);
    expect(h.ofType("Shield.report").at(-1)!.payload.report.bundleFlags).toEqual([flag]);

    await h.stop();
    expect(unwatched).toBe(1);
  });

  it("post-launch tick rescans name and logo", async () => {
    let nameScans = 0;
    const solana = fakeSolana({
      async findNameMatches() {
        nameScans++;
        return [];
      },
    });
    const h = harness(new ShieldWorker(), { clients: { solana, x: fakeX() }, prompt: "" });
    const started = h.start();
    await h.waitFor("Worker.progress");
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity } });
    h.emit({ type: "Launcher.deployed", reason: "test", payload: { coinCa: FAKE_CA, txSignature: "sig", identityRoot: "root" } });
    await started;
    const before = nameScans;
    await h.run.tick();
    expect(nameScans).toBe(before + 1);
    await h.stop();
  });
});
