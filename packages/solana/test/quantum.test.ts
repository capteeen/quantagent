import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import {
  ANU_API_URL,
  AnuQrngProvider,
  assertProviderAllowed,
  createQuantumClient,
  drawHashOf,
  QrngUnreachable,
  selectedIndexOf,
  verifyProof,
} from "../src/quantum/index";
import { jsonResponse, mockFetch } from "./helpers";

const BYTES = Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);

describe("ANU QRNG draw", () => {
  it("builds the proof exactly: entropyHex, drawHash, selectedIndex, attestation", async () => {
    const fetch = mockFetch({ "api.quantumnumbers.anu.edu.au": () => jsonResponse({ success: true, type: "uint8", length: 32, data: BYTES }) });
    const q = createQuantumClient({ env: { ANU_QRNG_API_KEY: "key-1" }, fetch });
    const ids = ["c1", "c2", "c3", "c4", "c5"];
    const proof = await q.draw({ candidateIds: ids, context: "Ideator:name" });

    const entropyHex = Buffer.from(BYTES).toString("hex");
    expect(proof.provider).toBe("anu");
    expect(proof.entropyHex).toBe(entropyHex);
    expect(proof.drawHash).toBe(createHash("sha256").update(`${ids.join(",")}:${entropyHex}`).digest("hex"));
    expect(proof.selectedIndex).toBe(Number(BigInt(`0x${entropyHex.slice(0, 16)}`) % 5n));
    expect(proof.selectedIndex).toBeGreaterThanOrEqual(0);
    expect(proof.selectedIndex).toBeLessThan(5);
    expect(verifyProof(proof, ids)).toBe(true);
    expect(verifyProof({ ...proof, selectedIndex: (proof.selectedIndex + 1) % 5 }, ids)).toBe(false);

    const att = JSON.parse(proof.attestation) as Record<string, unknown>;
    expect(Object.keys(att).sort()).toEqual(["rawResponse", "receivedAt", "requestUrl", "requestedAt"]);
    expect(att.requestUrl).toBe(`${ANU_API_URL}?length=32&type=uint8`);
    expect(att.rawResponse).toEqual({ success: true, type: "uint8", length: 32, data: BYTES });
    expect(att.requestedAt).toBe(proof.requestedAt);
    expect(att.receivedAt).toBe(proof.receivedAt);
    expect(Date.parse(proof.receivedAt)).toBeGreaterThanOrEqual(Date.parse(proof.requestedAt));

    const headers = fetch.calls[0]!.init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("key-1");
  });

  it("selectedIndex math is pure big-endian mod n", () => {
    expect(selectedIndexOf("00000000000000ff" + "00".repeat(24), 10)).toBe(5); // 255 % 10
    expect(selectedIndexOf("ffffffffffffffff" + "00".repeat(24), 7)).toBe(Number((2n ** 64n - 1n) % 7n));
    expect(drawHashOf(["a", "b"], "ab")).toBe(createHash("sha256").update("a,b:ab").digest("hex"));
    expect(() => selectedIndexOf("ab", 3)).toThrow(/too short/);
  });

  it("without ANU_QRNG_API_KEY the draw is NotImplemented naming the key", async () => {
    const q = createQuantumClient({ env: {}, fetch: mockFetch({}) });
    const err = await q.draw({ candidateIds: ["a"], context: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotImplemented);
    expect((err as NotImplemented).capability).toBe("quantum draw");
    expect((err as NotImplemented).needs).toEqual(["ANU_QRNG_API_KEY"]);
  });

  it("throws when the provider is unreachable, rate-limited or returns bad data — never falls back", async () => {
    const down = createQuantumClient({ env: { ANU_QRNG_API_KEY: "k" }, fetch: async () => { throw new Error("ECONNRESET"); } });
    await expect(down.draw({ candidateIds: ["a", "b"], context: "x" })).rejects.toBeInstanceOf(QrngUnreachable);

    const limited = createQuantumClient({ env: { ANU_QRNG_API_KEY: "k" }, fetch: mockFetch({ anu: () => jsonResponse({ success: false, message: "Too Many Requests" }, 429) }) });
    await expect(limited.draw({ candidateIds: ["a", "b"], context: "x" })).rejects.toThrow(/429.*Too Many Requests/);

    const short = createQuantumClient({ env: { ANU_QRNG_API_KEY: "k" }, fetch: mockFetch({ anu: () => jsonResponse({ success: true, data: [1, 2, 3] }) }) });
    await expect(short.draw({ candidateIds: ["a", "b"], context: "x" })).rejects.toThrow(/asked for 32 bytes, got 3/);

    const nonByte = createQuantumClient({ env: { ANU_QRNG_API_KEY: "k" }, fetch: mockFetch({ anu: () => jsonResponse({ success: true, data: BYTES.map(() => 300) }) }) });
    await expect(nonByte.draw({ candidateIds: ["a", "b"], context: "x" })).rejects.toThrow(/not a uint8/);
  });

  it("validates candidates and ANU length bounds", async () => {
    const q = createQuantumClient({ env: { ANU_QRNG_API_KEY: "k" }, fetch: mockFetch({}) });
    await expect(q.draw({ candidateIds: [], context: "x" })).rejects.toThrow(/at least one/);
    await expect(q.draw({ candidateIds: ["a", "a"], context: "x" })).rejects.toThrow(/unique/);
    const p = new AnuQrngProvider({ apiKey: "k", fetch: mockFetch({}) });
    await expect(p.fetchEntropy({ bytes: 2000, context: "x" })).rejects.toThrow(/1–1024/);
  });
});

describe("no pseudo-random fallback", () => {
  const quantumDir = join(__dirname, "..", "src", "quantum");

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  }

  it("src/quantum contains no Math.random / crypto.randomInt / randomBytes / randomUUID / getRandomValues", () => {
    const forbidden = /Math\.random|randomInt|randomBytes|randomUUID|getRandomValues|randomFill|webcrypto/;
    for (const f of files(quantumDir)) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, f).not.toMatch(forbidden);
    }
  });

  it("src/quantum never imports a local entropy source", () => {
    for (const f of files(quantumDir)) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/import\s+\{[^}]*random[^}]*\}\s+from\s+["'](node:)?crypto["']/);
    }
  });

  it("a provider named pseudo / mock / fake is refused, in production and everywhere else", () => {
    for (const name of ["pseudo", "mock-qrng", "fake", "prng", "MathRandom", "seeded"]) {
      expect(() => assertProviderAllowed(name, { NODE_ENV: "production" })).toThrow(/refused \(production\)/);
      expect(() => assertProviderAllowed(name, { NODE_ENV: "development" })).toThrow(/refused/);
      expect(() =>
        createQuantumClient({
          env: { NODE_ENV: "production" },
          provider: { name, fetchEntropy: async () => { throw new Error("unreachable"); } },
        }),
      ).toThrow(/refused/);
    }
    expect(() => assertProviderAllowed("anu", { NODE_ENV: "production" })).not.toThrow();
  });
});
