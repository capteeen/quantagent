/**
 * §9 check 4: QUANTUM RANDOMNESS IS REAL. Enabling a pseudorandom provider with
 * NODE_ENV=production is impossible in core (registerQuantumProvider / assertProofUsable)
 * and in solana (createQuantumClient / assertProviderAllowed). Every package's src is
 * scanned for Math.random / crypto.randomInt / randomBytes / getRandomValues / randomUUID;
 * each hit is classified selection vs non-selection, and a hit on any selection path fails.
 */
import { afterEach, describe, expect, it } from "vitest";
import { FORBIDDEN_PROVIDER_PATTERN, ForbiddenQuantumProvider, assertProofUsable, registerQuantumProvider, unregisterQuantumProvider } from "@quantagent/core";
import { FORBIDDEN_PROVIDER_NAME, assertProviderAllowed, createQuantumClient, verifyProof, type QrngProvider } from "@quantagent/solana";
import { fakeProof, fakeQuantum } from "./helpers/fakes";
import { simulate, type Sim } from "./helpers/launch";
import { grepLines, packageSources } from "./helpers/scan";

const PROD = { NODE_ENV: "production" };
const PSEUDO_NAMES = ["pseudo", "pseudo-random", "pseudorandom", "prng", "PRNG-xorshift", "mock", "mock-qrng", "fake", "Math.random", "math-random", "mathrandom", "random"];

let sim: Sim | undefined;
afterEach(async () => {
  await sim?.stop();
  sim = undefined;
});

describe("core: registerQuantumProvider / assertProofUsable refuse pseudorandom providers in production", () => {
  it.each(PSEUDO_NAMES)("registerQuantumProvider(%j) throws ForbiddenQuantumProvider with NODE_ENV=production", (name) => {
    expect(() => registerQuantumProvider(name, fakeQuantum(), PROD)).toThrow(ForbiddenQuantumProvider);
    unregisterQuantumProvider(name);
  });

  it.each(PSEUDO_NAMES)("assertProofUsable refuses a proof from %j in production", (name) => {
    expect(() => assertProofUsable(fakeProof(0, name), 3, PROD)).toThrow(ForbiddenQuantumProvider);
  });

  it("the check reads the env it is given, so a production launch cannot be fooled by a test NODE_ENV", async () => {
    // A launch running under NODE_ENV=production whose QuantumClient answers with a pseudo provider:
    // the orchestrator must NOT collapse; it must emit Orchestrator.collapseUnavailable and wait for the user.
    sim = await simulate({ env: PROD, quantum: { provider: "prng-local" } });
    const unavailable = await sim.waitFor("Orchestrator.collapseUnavailable", { timeoutMs: 10_000 });
    expect(unavailable.payload.reason).toMatch(/pseudorandom|cannot be used in production/);
    expect(sim.ofType("Orchestrator.collapsed")).toEqual([]);
    // The worker's candidates stay on screen (status "candidates") until the user picks.
    const state = sim.handle.getState();
    expect(state.workers[unavailable.payload.worker].status).toBe("candidates");
    expect(state.workers[unavailable.payload.worker].proof).toBeUndefined();
    // The user picks; the launch continues without a proof, and the log says so.
    const chosen = unavailable.payload.candidates[0]!;
    sim.handle.userPick(unavailable.payload.worker, chosen.id);
    const picked = await sim.waitFor("Orchestrator.userPicked");
    expect(picked.payload.chosen.id).toBe(chosen.id);
    expect(picked.reason).toMatch(/QRNG unreachable; user picked/);
  });

  it("a genuine provider name is accepted in production and the collapse carries its proof", async () => {
    sim = await simulate({ env: PROD, quantum: { provider: "anu" }, autopilot: { posts: true } });
    const collapsed = await sim.waitFor("Orchestrator.collapsed", { timeoutMs: 10_000 });
    expect(collapsed.payload.proof.provider).toBe("anu");
    expect(collapsed.payload.chosen.id).toBe(collapsed.payload.candidates[collapsed.payload.proof.selectedIndex]!.id);
    expect(sim.fakes.quantum.draws.length).toBeGreaterThanOrEqual(1);
  });

  it("an unreachable QRNG never falls back: candidates are shown and the reason names the error", async () => {
    sim = await simulate({ quantum: { fail: new Error("QRNG unreachable: 503") } });
    const unavailable = await sim.waitFor("Orchestrator.collapseUnavailable", { timeoutMs: 10_000 });
    expect(unavailable.payload.reason).toContain("QRNG unreachable: 503");
    expect(unavailable.payload.candidates.length).toBeGreaterThan(1);
    expect(sim.ofType("Orchestrator.collapsed")).toEqual([]);
  });

  it("no QuantumClient at all: still no fallback, the user picks", async () => {
    sim = await simulate({ quantum: null });
    const unavailable = await sim.waitFor("Orchestrator.collapseUnavailable", { timeoutMs: 10_000 });
    expect(unavailable.payload.reason).toContain("no QuantumClient");
  });

  it("core and solana deny-lists agree: 'local-prng' / 'seeded-mock' / 'stub' are refused in production by both (was finding F5)", () => {
    for (const name of ["local-prng", "seeded-mock", "qrng-fallback-fake", "stub"]) {
      expect(() => assertProviderAllowed(name, PROD), `solana refuses ${name}`).toThrow();
      expect(() => registerQuantumProvider(name, fakeQuantum(), PROD), `core must refuse ${name} too`).toThrow(ForbiddenQuantumProvider);
      unregisterQuantumProvider(name);
    }
    // Both patterns are unanchored substring matches.
    expect(FORBIDDEN_PROVIDER_PATTERN.source.startsWith("^")).toBe(false);
    expect(FORBIDDEN_PROVIDER_NAME.source.startsWith("^")).toBe(false);
  });
});

describe("solana: createQuantumClient / assertProviderAllowed refuse pseudorandom providers everywhere", () => {
  const pseudo = (name: string): QrngProvider => ({
    name,
    async fetchEntropy() {
      return { entropy: new Uint8Array(32), requestUrl: "local", requestedAt: "", receivedAt: "", rawResponse: null };
    },
  });

  it.each(["pseudo", "prng", "mock", "fake", "Math.random", "mathrandom", "dummy", "stub", "seeded", "seeded-xorshift", "local-prng"])(
    "assertProviderAllowed(%j) throws in production and in development",
    (name) => {
      expect(() => assertProviderAllowed(name, PROD)).toThrow(/refused \(production\)/);
      expect(() => assertProviderAllowed(name, { NODE_ENV: "development" })).toThrow(/refused/);
      expect(() => createQuantumClient({ provider: pseudo(name), env: PROD })).toThrow(/refused/);
    },
  );

  it("createQuantumClient without a provider and without ANU_QRNG_API_KEY throws NotImplemented at draw time, never a local draw", async () => {
    const client = createQuantumClient({ env: { NODE_ENV: "production" } });
    await expect(client.draw({ candidateIds: ["a", "b"], context: "t" })).rejects.toMatchObject({ name: "NotImplemented", needs: ["ANU_QRNG_API_KEY"] });
  });

  it("an unreachable ANU endpoint throws; nothing is drawn locally", async () => {
    let fetches = 0;
    const client = createQuantumClient({
      env: { NODE_ENV: "production", ANU_QRNG_API_KEY: "k" },
      fetch: async () => {
        fetches += 1;
        return new Response("down", { status: 503 });
      },
    });
    await expect(client.draw({ candidateIds: ["a", "b", "c"], context: "t" })).rejects.toThrow();
    expect(fetches).toBeGreaterThanOrEqual(1);
  });

  it("a real-shaped ANU answer produces a proof whose derived fields verify, and the index comes from the entropy", async () => {
    const data = Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);
    const client = createQuantumClient({
      env: { NODE_ENV: "production", ANU_QRNG_API_KEY: "k" },
      fetch: async () => new Response(JSON.stringify({ success: true, type: "uint8", length: 32, data }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    const ids = ["a", "b", "c", "d", "e"];
    const proof = await client.draw({ candidateIds: ids, context: "t" });
    expect(proof.provider).not.toMatch(FORBIDDEN_PROVIDER_NAME);
    expect(verifyProof(proof, ids)).toBe(true);
    expect(proof.entropyHex).toBe(Buffer.from(data).toString("hex"));
    expect(proof.selectedIndex).toBe(Number(BigInt(`0x${proof.entropyHex.slice(0, 16)}`) % 5n));
    expect(() => assertProofUsable(proof, ids.length, PROD)).not.toThrow();
  });
});

describe("source scan: randomness in every package's src", () => {
  const RANDOM_RE = /Math\.random|randomInt\b|randomBytes\b|getRandomValues|randomUUID|crypto\.random/;
  const files = packageSources();
  // Comment-only lines are not code paths (packages/ui/src/chamber/perf/dispose.ts:23 documents a
  // deterministic mulberry32 PRNG for vapour placement; it is noted in /docs/audit-log.md).
  const hits = grepLines(files, RANDOM_RE).filter((h) => !/^(\/\/|\*|\/\*)/.test(h.text));

  /** Every known hit, with its classification. A new hit anywhere fails the test below. */
  const CLASSIFIED: Record<string, "non-selection" | "selection"> = {
    "packages/solana/src/wallet/crypto.ts": "non-selection", // AES-GCM IV for the wallet secret at rest
    "packages/x/src/oauth/crypto.ts": "non-selection", // AES-GCM IV for tokens at rest
    "packages/x/src/oauth/pkce.ts": "non-selection", // PKCE verifier + CSRF state (must be unpredictable)
    "packages/x/src/ratelimit/backoff.ts": "non-selection", // retry jitter
    "packages/x/src/ratelimit/dlq.ts": "non-selection", // dead-letter id suffix
    "packages/x/src/client/oauth1.ts": "non-selection", // OAuth 1.0a nonce
    "packages/workers/src/testing/fakes.ts": "non-selection", // test-only fake post id (not exported from the index)
  };

  it("lists every hit with file:line (see /docs/audit-log.md)", () => {
    expect(files.length).toBeGreaterThan(50);
    const byFile = new Map<string, number[]>();
    for (const h of hits) byFile.set(h.path, [...(byFile.get(h.path) ?? []), h.line]);
    for (const [path, lines] of byFile) {
      expect(CLASSIFIED[path], `unclassified randomness in ${path}:${lines.join(",")}`).toBeDefined();
    }
    for (const path of Object.keys(CLASSIFIED)) expect(byFile.has(path), `${path} no longer has a hit; update the classification`).toBe(true);
  });

  it("zero hits on any selection path", () => {
    const selectionPaths = [
      /^packages\/core\/src\/orchestrator\//,
      /^packages\/core\/src\/runtime\//,
      /^packages\/core\/src\/state\//,
      /^packages\/solana\/src\/quantum\//,
      /^packages\/solana\/src\/qsd\//,
      /^packages\/workers\/src\/(ideator|artist|launcher|voice|trader|shield|recruiter|builder)\//,
      /^packages\/ui\/src\/chamber\//,
    ];
    const onSelection = hits.filter((h) => selectionPaths.some((re) => re.test(h.path)));
    expect(onSelection).toEqual([]);
    expect(Object.values(CLASSIFIED).every((c) => c === "non-selection")).toBe(true);
  });

  it("core has no Math.random and no node:crypto randomness at all", () => {
    const core = hits.filter((h) => h.path.startsWith("packages/core/"));
    expect(core).toEqual([]);
  });

  it("the only draw source in core is the injected QuantumClient (quantum.draw)", () => {
    const launchSrc = files.find((f) => f.path === "packages/core/src/orchestrator/launch.ts")!.text;
    expect(launchSrc).toContain("quantum.draw(");
    expect(launchSrc).not.toMatch(/selectedIndex\s*=\s*Math/);
  });
});
