import { describe, expect, it } from "vitest";
import type { XPost } from "@quantagent/core/types/clients";
import { fakeLlm, fakePost, fakeX, harness } from "../testing/fakes";
import { RateWindow, hourlyCapFromEnv, llmJson, rankAccounts, recruitScore } from "./rank";
import { RecruiterWorker } from "./recruiter";

const identity = { name: "Schrodinger Cat", ticker: "SCAT", lore: "a cat in a box", hook: "both alive and dead", trend: "quantum" };

function world(n: number, relevance: (id: string) => number) {
  const ids = Array.from({ length: n }, (_, i) => `u${i + 1}`);
  const posts: XPost[] = ids.map((id, i) => fakePost({ id: `p-${id}`, authorId: id, text: `thinking about quantum cats #${i}`, createdAt: new Date(1_800_000_000_000 + i).toISOString() }));
  const sent: { text: string; replyTo?: string }[] = [];
  const x = fakeX({
    async search() {
      return posts;
    },
    async users({ ids: want }) {
      return want.map((id) => ({ id, handle: `h_${id}`, followers: 100 * (Number(id.slice(1)) + 1) }));
    },
    async post(input) {
      sent.push({ text: input.text, ...(input.replyTo ? { replyTo: input.replyTo } : {}) });
      return fakePost({ id: `reply-${sent.length}`, text: input.text });
    },
  });
  const llm = fakeLlm(({ system }) => {
    if (system.includes("score X accounts")) return { accounts: ids.map((id) => ({ id, relevance: relevance(id) })) };
    return { text: "love this. Schrodinger Cat is both alive and dead, come look" };
  });
  return { ids, posts, sent, x, llm };
}

describe("rank helpers", () => {
  it("scores relevance × log(1 + reach) and ranks descending", () => {
    expect(recruitScore(1, 0)).toBe(0);
    expect(recruitScore(0.5, Math.E - 1)).toBeCloseTo(0.5);
    expect(recruitScore(2, 10)).toBe(recruitScore(1, 10));
    const ranked = rankAccounts([
      { id: "a", handle: "a", reach: 10, relevance: 0.9 },
      { id: "b", handle: "b", reach: 100_000, relevance: 0.6 },
      { id: "c", handle: "c", reach: 1_000_000, relevance: 0 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("RateWindow caps per sliding hour", () => {
    const w = new RateWindow(2, 3_600_000);
    const t = 1_800_000_000_000;
    expect(w.allows(t)).toBe(true);
    w.record(t);
    w.record(t + 1);
    expect(w.allows(t + 2)).toBe(false);
    expect(w.allows(t + 3_600_001)).toBe(true);
    expect(w.count(t + 3_600_001)).toBe(0);
  });

  it("reads RECRUITER_HOURLY_CAP with a safe default", () => {
    expect(hourlyCapFromEnv({})).toBe(10);
    expect(hourlyCapFromEnv({ RECRUITER_HOURLY_CAP: "3" })).toBe(3);
    expect(hourlyCapFromEnv({ RECRUITER_HOURLY_CAP: "lots" })).toBe(10);
    expect(llmJson({ text: "```json\n{\"a\":1}\n```" })).toEqual({ a: 1 });
  });
});

describe("RecruiterWorker", () => {
  it("fails with NotImplemented naming env vars when x or llm is missing", async () => {
    const h = harness(new RecruiterWorker(), { clients: { llm: fakeLlm(() => ({})) } });
    expect(await h.start()).toBe("failed");
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/NotImplemented.*X_CLIENT_ID/);
    await h.stop();
    const h2 = harness(new RecruiterWorker(), { clients: { x: fakeX() } });
    expect(await h2.start()).toBe("failed");
    expect(h2.ofType("Worker.failed")[0]!.reason).toMatch(/LLM_API_KEY/);
    await h2.stop();
  });

  it("finds and ranks accounts by relevance × log(reach), then reaches through the recruiting gate with replyTo", async () => {
    const w = world(3, (id) => ({ u1: 0.9, u2: 0.2, u3: 0.7 })[id] ?? 0);
    const h = harness(new RecruiterWorker({ hourlyCap: 10 }), { clients: { x: w.x, llm: w.llm }, prompt: "a cat that runs a quantum lab" });
    const started = h.start();
    const found = await h.waitFor("Recruiter.found");
    // u3: 0.7*ln(301)=3.99, u1: 0.9*ln(201)=4.77, u2 below threshold
    expect(found.payload.accounts.map((a) => a.id)).toEqual(["u1", "u3", "u2"]);
    expect(found.payload.accounts[0]).toEqual({ id: "u1", handle: "h_u1", reach: 200, relevance: 0.9 });

    const first = await h.waitFor("Worker.awaitingApproval");
    expect(first.payload.approval.actionClass).toBe("recruiting");
    expect(first.payload.approval.draft).toMatchObject({ replyTo: "p-u1", accountId: "u1" });
    expect(w.sent).toHaveLength(0);
    h.gate.resolve(first.payload.approval.id, "skip");

    const second = await h.waitFor("Worker.awaitingApproval", { predicate: (e) => e.payload.approval.draft.accountId === "u3" });
    h.gate.resolve(second.payload.approval.id, "edit", { ...second.payload.approval.draft, text: "edited reply" });
    expect(await started).toBe("done");

    expect(w.sent).toEqual([{ text: "edited reply", replyTo: "p-u3" }]);
    const reached = h.ofType("Recruiter.reached");
    expect(reached).toHaveLength(1);
    expect(reached[0]!.payload).toEqual({ accountId: "u3", postId: "reply-1", text: "edited reply" });
    expect(reached[0]!.reason).toMatch(/reach 400/);
    expect(h.ofType("Worker.done")[0]!.payload.outputs).toMatchObject({ found: 3, reached: 1, capped: false });
    // u2 (relevance 0.2) was never asked about
    expect(h.ofType("Worker.awaitingApproval")).toHaveLength(2);
    await h.stop();
  });

  it("enforces the hourly cap in code and never reaches the same account twice", async () => {
    let now = 1_800_000_000_000;
    const w = world(5, () => 0.9);
    const worker = new RecruiterWorker({ hourlyCap: 2, now: () => now });
    const h = harness(worker, { clients: { x: w.x, llm: w.llm }, autopilot: { recruiting: true }, prompt: "quantum cats" });
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity } });
    expect(await h.start()).toBe("done");
    expect(w.sent).toHaveLength(2);
    // equal relevance: largest reach first
    expect(w.sent.map((s) => s.replyTo)).toEqual(["p-u5", "p-u4"]);
    const capped = h.ofType("Recruiter.capped");
    expect(capped).toHaveLength(1);
    expect(capped[0]!.payload).toEqual({ cap: 2, windowMs: 3_600_000 });
    expect(h.ofType("Worker.done")[0]!.payload.outputs).toMatchObject({ reached: 2, capped: true });

    // within the hour: nothing more, cap announced once
    now += 30 * 60_000;
    await h.run.tick();
    expect(w.sent).toHaveLength(2);
    expect(h.ofType("Recruiter.capped")).toHaveLength(1);

    // window cleared: outreach resumes with accounts not yet reached
    now += 31 * 60_000;
    await h.run.tick();
    expect(w.sent).toHaveLength(4);
    expect(w.sent.map((s) => s.replyTo)).toEqual(["p-u5", "p-u4", "p-u3", "p-u2"]);
    expect(h.ofType("Recruiter.reached").map((e) => e.payload.accountId)).toEqual(["u5", "u4", "u3", "u2"]);
    await h.stop();
  });

  it("a cap of 0 finds accounts but reaches nobody", async () => {
    const w = world(2, () => 1);
    const h = harness(new RecruiterWorker({ hourlyCap: 0 }), { clients: { x: w.x, llm: w.llm }, autopilot: { recruiting: true }, prompt: "quantum cats" });
    expect(await h.start()).toBe("done");
    expect(h.ofType("Recruiter.found")).toHaveLength(1);
    expect(w.sent).toHaveLength(0);
    expect(h.ofType("Recruiter.capped")).toHaveLength(1);
    await h.stop();
  });
});
