import { describe, expect, it } from "vitest";
import { CopycatFinder, diceSimilarity, hammingHex, phashFromGray, phashImage, PHASH_SIZE, similarityFromHamming } from "../src/discovery/index";
import { jsonResponse, mockFetch } from "./helpers";

function gradient(dir: "h" | "v" | "inv" = "h"): Uint8Array {
  const g = new Uint8Array(PHASH_SIZE * PHASH_SIZE);
  for (let y = 0; y < PHASH_SIZE; y++)
    for (let x = 0; x < PHASH_SIZE; x++) {
      const v = dir === "h" ? x * 8 : dir === "v" ? y * 8 : 255 - x * 8;
      g[y * PHASH_SIZE + x] = v;
    }
  return g;
}

describe("pHash", () => {
  it("is deterministic, 16 hex chars, and distinguishes orientation", () => {
    const h = phashFromGray(gradient("h"));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(phashFromGray(gradient("h"))).toBe(h);
    expect(hammingHex(h, h)).toBe(0);
    // a pure axis gradient has energy in one DCT row/column: 8 bits flip between h and v
    expect(hammingHex(h, phashFromGray(gradient("v")))).toBeGreaterThanOrEqual(8);
    expect(hammingHex(h, phashFromGray(gradient("inv")))).toBeGreaterThanOrEqual(8);
  });

  it("hamming distance on hex + similarity", () => {
    expect(hammingHex("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingHex("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hammingHex("00000000000000f0", "0000000000000000")).toBe(4);
    expect(hammingHex("ABCD", "abcd")).toBe(0);
    expect(() => hammingHex("abc", "abcd")).toThrow(/lengths/);
    expect(() => hammingHex("zz", "zz")).toThrow(/hex/);
    expect(similarityFromHamming(0)).toBe(1);
    expect(similarityFromHamming(16)).toBe(0.75);
  });

  it("hashes real PNG bytes through sharp (or jimp) and a re-encoded copy matches closely", async () => {
    const sharp = (await import("sharp")).default;
    const base = sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 40, b: 200 } } })
      .composite([{ input: Buffer.from(`<svg width="64" height="64"><circle cx="20" cy="24" r="14" fill="white"/><rect x="36" y="30" width="22" height="26" fill="black"/></svg>`), top: 0, left: 0 }])
      .png();
    const png = await base.toBuffer();
    const jpg = await sharp(png).jpeg({ quality: 85 }).toBuffer();
    const h1 = await phashImage(new Uint8Array(png));
    const h2 = await phashImage(new Uint8Array(jpg));
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingHex(h1, h2)).toBeLessThanOrEqual(6);
    const other = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([{ input: Buffer.from(`<svg width="64" height="64"><polygon points="2,62 32,2 62,62" fill="red"/></svg>`), top: 0, left: 0 }])
      .png()
      .toBuffer();
    expect(hammingHex(h1, await phashImage(new Uint8Array(other)))).toBeGreaterThan(10);
  });
});

describe("name / ticker discovery", () => {
  const coins = [
    { mint: "M1", name: "Quanta Cat", symbol: "QCAT", image_uri: "https://img/1.png", created_timestamp: 1_700_000_000_000 },
    { mint: "M2", name: "quanta-cat", symbol: "QCT", image_uri: "https://img/2.png", created_timestamp: 1_700_000_001_000 },
    { mint: "M3", name: "Totally Different", symbol: "TDF", image_uri: null, created_timestamp: 1_700_000_002_000 },
  ];

  it("isNameTaken and findNameMatches use /coins/search and tolerate both array and {data} responses", async () => {
    const fetch = mockFetch({ "/coins/search": (c) => (c.url.includes("searchTerm=QCAT") ? jsonResponse({ data: coins, total: 3 }) : jsonResponse(coins)) });
    const f = new CopycatFinder({ env: {}, fetch });
    expect(await f.isNameTaken({ name: "Quanta Cat", ticker: "QCAT" })).toEqual({ name: true, ticker: true });
    expect(await f.isNameTaken({ name: "Quanta Dog", ticker: "QDOG" })).toEqual({ name: false, ticker: false });
    expect(fetch.calls[0]!.url).toMatch(/frontend-api-v3\.pump\.fun\/coins\/search\?.*searchTerm=Quanta\+Cat/);
    const matches = await f.findNameMatches({ name: "Quanta Cat", ticker: "QCAT" });
    expect(matches.map((m) => [m.externalId, m.match, m.score])).toEqual([
      ["M1", "name", 1],
      ["M1", "ticker", 1],
      ["M2", "name", 1],
    ]);
    expect(matches[0]!.url).toBe("https://pump.fun/coin/M1");
    expect(matches[0]!.source).toBe("pump.fun");
    expect(matches[0]!.seenAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("dice similarity catches near-copies", () => {
    expect(diceSimilarity("Quanta Cat", "Quanta Cats")).toBeGreaterThan(0.8);
    expect(diceSimilarity("Quanta Cat", "Bitcoin")).toBeLessThan(0.3);
  });

  it("findLogoMatches hashes recent coins' images and filters by hamming distance", async () => {
    const hashes: Record<string, string> = { "https://img/1.png": "ffffffffffffffff", "https://img/2.png": "fffffffffffffff0" };
    const fetch = mockFetch({ "/coins?": () => jsonResponse(coins) });
    const f = new CopycatFinder({
      env: {},
      fetch,
      recentLimit: 50,
      fetchImage: async (url) => new TextEncoder().encode(url),
      hashImage: async (bytes) => hashes[new TextDecoder().decode(bytes)] ?? "0000000000000000",
    });
    const r = await f.findLogoMatches({ phash: "ffffffffffffffff", threshold: 5 });
    expect(r.map((c) => [c.externalId, c.match, c.score])).toEqual([
      ["M1", "logo", 1],
      ["M2", "logo", 1 - 4 / 64],
    ]);
    expect(fetch.calls[0]!.url).toMatch(/\/coins\?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false/);
    const strict = await f.findLogoMatches({ phash: "ffffffffffffffff", threshold: 0.99 });
    expect(strict.map((c) => c.externalId)).toEqual(["M1"]);
  });
});
