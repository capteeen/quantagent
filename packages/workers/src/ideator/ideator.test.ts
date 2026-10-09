import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import type { Identity } from "@quantagent/core/types";
import { createIdeator } from "./ideator";
import { checkIdentityConstraints, findDenied, PROTECTED_BRAND_DENY, REAL_PERSON_DENY } from "./constraints";
import { parseLlmJson } from "./schema";
import { fakeLlm, fakeSolana, fakeX, harness, type LlmResponder } from "../testing/fakes";

const GOOD: Identity[] = [
  { name: "Qubit Cat", ticker: "QCAT", lore: "A cat that lives in two boxes at once.", hook: "both alive and based", trend: "quantum" },
  { name: "Schrodinger Lab", ticker: "SLAB", lore: "The lab the cat runs.", hook: "measure me", trend: "none" },
  { name: "Entangle", ticker: "TANGL", lore: "Two coins, one state.", hook: "spooky", trend: "quantum" },
  { name: "Decoherence", ticker: "DECO", lore: "Everything collapses eventually.", hook: "collapse responsibly", trend: "cats" },
  { name: "Wavefunction", ticker: "WAVE", lore: "Probability amplitude as a lifestyle.", hook: "ride the amplitude", trend: "none" },
];

function responder(candidates: Identity[], verdicts?: { name: string; isRealPerson: boolean; who?: string }[]): LlmResponder {
  return ({ user }) => {
    if (user.includes("real living or historical person")) {
      return { verdicts: verdicts ?? candidates.map((c) => ({ name: c.name, isRealPerson: false })) };
    }
    if (user.includes("\"angles\"")) return { angles: ["angle one", "angle two", "angle three"] };
    return { candidates };
  };
}

describe("Ideator constraints (in code)", () => {
  it("rejects tickers longer than 6 chars and non A–Z0–9", () => {
    expect(checkIdentityConstraints({ ...GOOD[0]!, ticker: "TOOLONGX" })).toContainEqual(expect.stringContaining("longer than 6"));
    expect(checkIdentityConstraints({ ...GOOD[0]!, ticker: "QC-T" })).toContainEqual(expect.stringContaining("A–Z/0–9"));
    expect(checkIdentityConstraints(GOOD[0]!)).toEqual([]);
  });
  it("rejects real people and protected brands by deny-list", () => {
    expect(checkIdentityConstraints({ ...GOOD[0]!, name: "Elon Cat" })[0]).toMatch(/real person/);
    expect(checkIdentityConstraints({ ...GOOD[0]!, name: "Pikachu Coin" })[0]).toMatch(/protected brand/);
    expect(findDenied("just a cat", REAL_PERSON_DENY)).toBeUndefined();
    expect(findDenied("Disney World", PROTECTED_BRAND_DENY)).toBe("disney");
  });
  it("parses fenced JSON from text when the client gives no json", () => {
    expect(parseLlmJson({ text: "```json\n{\"a\":1}\n```" })).toEqual({ a: 1 });
    expect(() => parseLlmJson({ text: "nothing" })).toThrow(/no JSON/);
  });
});

describe("IdeatorWorker", () => {
  it("emits started → progress → candidates → Ideator.named → done through the real runtime", async () => {
    const llm = fakeLlm(responder(GOOD));
    const h = harness(createIdeator(), { prompt: "a cat that runs a quantum lab", clients: { llm, x: fakeX(), solana: fakeSolana() } });
    const finished = h.start();
    const cands = await h.waitFor("Worker.candidates");
    expect(cands.worker).toBe("Ideator");
    expect(cands.payload.candidates).toHaveLength(5);
    expect(cands.reason).toMatch(/quantum draw/);
    for (const c of cands.payload.candidates) expect(c.reason.length).toBeGreaterThan(0);
    const chosen = h.collapse("Ideator", 2);
    expect(await finished).toBe("done");

    const types = h.events.map((e) => e.type);
    expect(types[0]).toBe("Worker.started");
    expect(types.filter((t) => t === "Worker.progress").length).toBeGreaterThan(3);
    const named = h.ofType("Ideator.named")[0]!;
    expect(named.payload.identity).toEqual(chosen.value);
    expect(named.reason).toMatch(/quantum draw/);
    const done = h.ofType("Worker.done")[0]!;
    expect((done.payload.outputs as { identity: Identity }).identity.ticker).toBe("TANGL");
    expect(h.events.every((e) => typeof e.reason === "string" && e.reason.length > 0)).toBe(true);
    // trends were pulled, every candidate checked for availability
    expect(llm.calls.some((c) => c.user.includes("quantum (12000 posts)"))).toBe(true);
    await h.stop();
  });

  it("emits Ideator.named on Orchestrator.userPicked when the QRNG was unreachable", async () => {
    const h = harness(createIdeator(), { clients: { llm: fakeLlm(responder(GOOD)), x: fakeX(), solana: fakeSolana() } });
    const finished = h.start();
    await h.waitFor("Worker.candidates");
    h.userPick("Ideator", 4);
    expect(await finished).toBe("done");
    expect(h.ofType("Ideator.named")[0]!.reason).toMatch(/user pick/);
    expect(h.ofType("Ideator.named")[0]!.payload.identity.ticker).toBe("WAVE");
    await h.stop();
  });

  it("drops names that fail constraints, the LLM person check, or are taken on pump.fun, and re-asks", async () => {
    const bad: Identity[] = [
      { ...GOOD[0]!, name: "Elon Cat", ticker: "ELON" },
      { ...GOOD[1]!, ticker: "WAYTOOLONG" },
      { ...GOOD[2]!, name: "Taken Coin", ticker: "TAKEN" },
      { ...GOOD[3]!, name: "Some Senator", ticker: "SEN" },
      GOOD[4]!,
    ];
    let round = 0;
    const llm = fakeLlm(({ user }) => {
      if (user.includes("real living or historical person")) {
        return { verdicts: [{ name: "Some Senator", isRealPerson: true, who: "a sitting senator" }] };
      }
      round++;
      return { candidates: round === 1 ? bad : GOOD.slice(0, 4) };
    });
    const solana = fakeSolana({ async isNameTaken({ name }) { return { name: name === "Taken Coin", ticker: false }; } });
    const h = harness(createIdeator(), { clients: { llm, x: fakeX(), solana } });
    const finished = h.start();
    const cands = await h.waitFor("Worker.candidates");
    const tickers = cands.payload.candidates.map((c) => (c.value as Identity).ticker);
    expect(tickers).not.toContain("ELON");
    expect(tickers).not.toContain("WAYTOOLONG");
    expect(tickers).not.toContain("TAKEN");
    expect(tickers).not.toContain("SEN");
    expect(tickers).toHaveLength(5);
    const steps = h.ofType("Worker.progress").map((e) => e.payload.step);
    expect(steps).toContain("constraints.rejected");
    expect(steps).toContain("personCheck.rejected");
    expect(steps).toContain("availability.rejected");
    h.collapse("Ideator");
    expect(await finished).toBe("done");
    await h.stop();
  });

  it("fails with NotImplemented naming env vars when the LLM client is missing", async () => {
    const h = harness(createIdeator(), { clients: { x: fakeX(), solana: fakeSolana() } });
    expect(await h.start()).toBe("failed");
    const failed = h.ofType("Worker.failed")[0]!;
    expect(failed.reason).toMatch(/NotImplemented/);
    expect(failed.reason).toMatch(/LLM_API_KEY/);
    expect(h.ofType("Worker.candidates")).toHaveLength(0);
    await h.stop();
  });

  it("fails (never fakes) when the LLM output does not validate", async () => {
    const h = harness(createIdeator({ maxRounds: 1 }), {
      clients: { llm: fakeLlm(() => ({ candidates: [{ name: "x" }] })), x: fakeX(), solana: fakeSolana() },
    });
    expect(await h.start()).toBe("failed");
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/failed validation/);
    await h.stop();
  });

  it("produces 3 angles on Voice.needsAngle after launch", async () => {
    const x = fakeX({ async mentions() { return [{ id: "m1", url: "u", text: "when moon", authorId: "fan", createdAt: "now" }]; } });
    const h = harness(createIdeator(), { clients: { llm: fakeLlm(responder(GOOD)), x, solana: fakeSolana() } });
    const finished = h.start();
    await h.waitFor("Worker.candidates");
    h.collapse("Ideator");
    await finished;
    h.emit({ type: "Chain.milestone", reason: "test", payload: { kind: "mcap", value: 50_000 } });
    h.emit({ type: "Voice.needsAngle", reason: "engagement dropped", payload: { mentions: 1, engagement: 0.1 } });
    await h.settle();
    const angles = h.ofType("Ideator.angles")[0]!;
    expect(angles.payload.angles).toHaveLength(3);
    expect(angles.reason).toMatch(/1 mentions/);
    expect(angles.reason).toMatch(/mcap=50000/);
    await h.stop();
  });

  it("exposes NotImplemented as a typed error", () => {
    const e = new NotImplemented("Ideator.ideate", "no llm", ["LLM_API_KEY"]);
    expect(e.needs).toEqual(["LLM_API_KEY"]);
  });
});
