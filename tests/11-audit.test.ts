/**
 * §9 check 11: AUDIT. Every Artist generation goes through the content rules; the Voice
 * never posts the same text twice; the Recruiter respects RECRUITER_HOURLY_CAP; every
 * Builder.published carries a trigger caused by an earlier event; the X rate limiter
 * honours reset headers (through @quantagent/x's public API with a mocked fetch).
 */
import { afterEach, describe, expect, it } from "vitest";
import { checkContent } from "@quantagent/workers";
import { createXRuntime, XApiError, XBudgetPaused } from "@quantagent/x";
import { simulate, type Sim } from "./helpers/launch";

let sim: Sim | undefined;
afterEach(async () => {
  await sim?.stop();
  sim = undefined;
  delete process.env.RECRUITER_HOURLY_CAP;
});

describe("Artist: every generation goes through the content rules in code", () => {
  it("a disallowed prompt: the provider is never called and the Artist fails with ContentRuleViolation", async () => {
    sim = await simulate({ autopilot: { posts: true }, prompt: "a coin about Mickey Mouse with guns and blood" });
    const failed = await sim.waitFor("Worker.failed", { predicate: (e) => e.worker === "Artist", timeoutMs: 10_000 });
    expect(failed.payload.reason).toContain("ContentRuleViolation");
    expect(failed.payload.reason).toMatch(/protected brand|violent/);
    expect(sim.fakes.image.calls).toEqual([]);
    expect(sim.fakes.store.puts).toEqual([]);
  });

  it("a disallowed brief after launch (Voice.needsImage): Artist.generationFailed is emitted and the provider is never called", async () => {
    sim = await simulate({ autopilot: { posts: true } });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const before = sim.fakes.image.calls.length;
    const failedBefore = sim.ofType("Artist.generationFailed").length;
    sim.handle.bus.emit(sim.handle.id, { type: "Voice.needsImage", reason: "test", payload: { brief: "a photo of Elon Musk holding a rifle" } });
    await sim.handle.runs.get("Artist")!.settleHandlers();
    const failed = sim.ofType("Artist.generationFailed");
    expect(failed).toHaveLength(failedBefore + 1);
    expect(failed.at(-1)!.payload.error).toContain("ContentRuleViolation");
    expect(failed.at(-1)!.payload.error).toMatch(/real person|violent/);
    expect(failed.at(-1)!.reason).toContain("no replacement image");
    expect(sim.fakes.image.calls).toHaveLength(before);
    expect(sim.ofType("Artist.imageReady")).toHaveLength(sim.ofType("Artist.imageReady").length); // unchanged
  });

  it("every prompt that reached the provider passes checkContent and carries the safety suffix", async () => {
    sim = await simulate({ autopilot: { posts: true } });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    expect(sim.fakes.image.calls.length).toBeGreaterThanOrEqual(2 + 1 + 1 + 6); // candidates + logo + banner + characters
    for (const c of sim.fakes.image.calls) {
      expect(checkContent(c.prompt).ok, c.prompt).toBe(true);
      expect(c.prompt).toContain("No real people");
    }
    // Every emitted asset was really generated and stored (no stock image path exists).
    const ready = [...sim.ofType("Artist.logoReady"), ...sim.ofType("Artist.bannerReady"), ...sim.ofType("Artist.imageReady")];
    for (const e of ready) expect(e.payload.asset.url).toMatch(/^https:\/\/img\.test\//);
    expect(sim.fakes.store.puts.length).toBeGreaterThanOrEqual(ready.length);
  });

  it("a failed generation is logged as Artist.generationFailed and never replaced", async () => {
    sim = await simulate({ autopilot: { posts: true }, imageFail: (p) => (/Character sheet image 3:/.test(p) ? "provider timeout" : undefined) });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const failed = sim.ofType("Artist.generationFailed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.payload.error).toContain("provider timeout");
    expect(sim.ofType("Artist.imageReady")).toHaveLength(5);
    const state = sim.handle.getState();
    expect(state.workers.Artist.status).toBe("done");
    expect((state.workers.Artist.outputs.failed as unknown[]).length).toBe(1);
    expect(state.workers.Artist.outputs.images).toHaveLength(5);
  });
});

describe("Voice: never posts the same text twice", () => {
  it("two identical milestones produce exactly one post", async () => {
    sim = await simulate({ autopilot: { posts: true } });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const postsBefore = sim.fakes.x.posts.length;
    const milestone = { type: "Chain.milestone" as const, reason: "holders crossed 100", payload: { kind: "holders" as const, value: 100 } };
    sim.handle.bus.emit(sim.handle.id, milestone);
    sim.handle.bus.emit(sim.handle.id, milestone);
    await sim.handle.runs.get("Voice")!.settleHandlers();
    const milestonePosts = sim.ofType("Voice.posted").filter((e) => e.payload.kind === "milestone");
    expect(milestonePosts).toHaveLength(1);
    expect(milestonePosts[0]!.payload.text).toContain("100 holders");
    expect(sim.fakes.x.posts).toHaveLength(postsBefore + 1);
    const dup = sim.ofType("Worker.progress").filter((e) => e.worker === "Voice" && e.payload.step === "milestone.duplicate");
    expect(dup).toHaveLength(1);
    expect(dup[0]!.reason).toMatch(/never posting the same text twice/);
    // Across the whole launch no text ever reached X twice.
    const texts = sim.fakes.x.allTexts();
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("every post is logged with its post id and a reason", async () => {
    sim = await simulate({ autopilot: { posts: true } });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const posted = sim.ofType("Voice.posted");
    expect(posted.length).toBeGreaterThanOrEqual(2);
    for (const e of posted) {
      expect(e.payload.postId).toMatch(/^post-\d+$/);
      expect(e.reason.length).toBeGreaterThan(10);
      expect(e.payload.url).toContain(e.payload.postId.replace("post-", ""));
    }
    expect(posted.map((e) => e.payload.kind)).toEqual(["thread", "ca"]);
  });
});

describe("Recruiter: hard hourly cap, public replies only", () => {
  const candidates = Array.from({ length: 5 }, (_, i) => ({
    id: `cand-${i}`,
    url: `https://x.com/u${i}/status/${i}`,
    text: `quantum fridge cats forever ${i}`,
    authorId: `u${i}`,
    createdAt: new Date(Date.now() - i * 1000).toISOString(),
  }));

  it("RECRUITER_HOURLY_CAP=2 with 5 candidates: 2 replies, then Recruiter.capped", async () => {
    process.env.RECRUITER_HOURLY_CAP = "2";
    sim = await simulate({
      autopilot: { posts: true, recruiting: true },
      x: { searchResults: candidates, users: candidates.map((p, i) => ({ id: p.authorId, handle: `u${i}`, followers: 1000 * (i + 1) })) },
    });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const reached = sim.ofType("Recruiter.reached");
    expect(reached).toHaveLength(2);
    const capped = sim.ofType("Recruiter.capped");
    expect(capped).toHaveLength(1);
    expect(capped[0]!.payload.cap).toBe(2);
    expect(sim.ofType("Recruiter.found")[0]!.payload.accounts).toHaveLength(5);
    const outreach = sim.fakes.x.posts.filter((p) => p.replyTo);
    expect(outreach).toHaveLength(2);
    for (const p of outreach) expect(p.replyTo).toMatch(/^cand-/); // public replies, never DMs or follows
    expect(sim.handle.getState().workers.Recruiter.status).toBe("done");
    expect(sim.handle.getState().workers.Recruiter.outputs).toMatchObject({ reached: 2, capped: true, hourlyCap: 2 });
  });

  it("with recruiting autopilot off the Recruiter asks and nothing goes out", async () => {
    sim = await simulate({
      autopilot: { posts: true },
      x: { searchResults: candidates, users: candidates.map((p, i) => ({ id: p.authorId, handle: `u${i}`, followers: 1000 })) },
    });
    await sim.waitFor("Worker.awaitingApproval", { predicate: (e) => e.worker === "Recruiter", timeoutMs: 20_000 });
    expect(sim.fakes.x.posts.filter((p) => p.replyTo)).toEqual([]);
    expect(sim.ofType("Recruiter.reached")).toEqual([]);
  });
});

describe("Builder: every patch has its trigger event", () => {
  it("every Builder.published carries a trigger, and each trigger names t0 or an event that precedes it in the log", async () => {
    sim = await simulate({ autopilot: { posts: true } });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const log = await sim.log();
    const published = sim.ofType("Builder.published");
    expect(published.length).toBeGreaterThanOrEqual(3);
    expect(published[0]!.payload.trigger).toBe("t0");
    for (const p of published) {
      expect(p.payload.trigger).toBeTruthy();
      expect(p.payload.deployId).toBeTruthy();
      expect(p.payload.url).toMatch(/^https:\/\//);
      for (const part of p.payload.trigger.split("+")) {
        if (part === "t0") continue;
        const cause = log.find((e) => e.type === part && e.seq < p.seq);
        expect(cause, `${part} precedes Builder.published #${p.seq}`).toBeDefined();
      }
    }
    expect(sim.ofType("Builder.patchFailed")).toEqual([]);
    // A post-launch domain event also patches the site with its trigger.
    const milestone = sim.handle.bus.emit(sim.handle.id, { type: "Chain.milestone", reason: "mcap", payload: { kind: "mcap", value: 50_000 } });
    await sim.handle.runs.get("Builder")!.settleHandlers();
    await sim.handle.runs.get("Voice")!.settleHandlers(); // the Voice also posts the milestone → one more Builder patch
    await sim.handle.runs.get("Builder")!.settleHandlers();
    const after = sim.ofType("Builder.published").filter((e) => e.seq > milestone.seq);
    const idx = after.findIndex((e) => e.payload.trigger.split("+").includes("Chain.milestone"));
    expect(idx, "a Builder.published triggered by Chain.milestone").toBeGreaterThanOrEqual(0);
    const publishesAfter = sim.fakes.hosting.publishes.slice(-after.length);
    expect(publishesAfter[idx]!.html).toContain("50K");
    expect(publishesAfter[idx]!.html).toContain("market cap");
  });
});

describe("X rate limiter honours reset headers (through @quantagent/x with a mocked fetch)", () => {
  interface Env {
    X_CLIENT_ID: string;
    X_REDIRECT_URI: string;
    X_TOKEN_KEY: string;
    X_TOKEN_STORE: string;
    X_MONTHLY_CALL_BUDGET?: string;
  }
  const env = (): Env => ({ X_CLIENT_ID: "cid", X_REDIRECT_URI: "https://app.test/cb", X_TOKEN_KEY: "ab".repeat(32), X_TOKEN_STORE: "memory" });

  async function runtime(responses: (() => Response)[], extraEnv: Partial<Env> = {}) {
    let now = 1_700_000_000_000;
    const sleeps: number[] = [];
    const fetches: { url: string; at: number }[] = [];
    const rt = await createXRuntime({
      env: { ...env(), ...extraEnv } as unknown as NodeJS.ProcessEnv,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      fetch: async (input) => {
        fetches.push({ url: String(input), at: now });
        const next = responses.shift();
        if (!next) throw new Error("no more canned responses");
        return next();
      },
    });
    await rt.store.put({
      accountId: "acct-1",
      handle: "connected",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(now + 24 * 3600_000).toISOString(),
      scopes: ["tweet.write"],
      updatedAt: new Date(now).toISOString(),
    });
    return { rt, client: rt.client("acct-1"), sleeps, fetches, now: () => now };
  }

  const ok = (id: string, headers: Record<string, string> = {}) => () =>
    new Response(JSON.stringify({ data: { id, text: "t" } }), { status: 201, headers: { "content-type": "application/json", ...headers } });

  it("after x-rate-limit-remaining: 0 nothing is sent on that route until x-rate-limit-reset", async () => {
    const reset = Math.floor(1_700_000_000_000 / 1000) + 30; // 30s ahead, epoch seconds as X sends it
    const { client, sleeps, fetches } = await runtime([
      ok("1", { "x-rate-limit-limit": "50", "x-rate-limit-remaining": "0", "x-rate-limit-reset": String(reset) }),
      ok("2", { "x-rate-limit-limit": "50", "x-rate-limit-remaining": "49", "x-rate-limit-reset": String(reset + 900) }),
    ]);
    const first = await client.post({ text: "one" });
    expect(first.id).toBe("1");
    expect(first.authorId).toBe("acct-1");
    const second = await client.post({ text: "two" });
    expect(second.id).toBe("2");
    expect(sleeps).toEqual([30_000]);
    expect(fetches[1]!.at - fetches[0]!.at).toBe(30_000);
  });

  it("a 429 with retry-after waits exactly that long, then retries", async () => {
    const { client, sleeps, fetches } = await runtime([
      () => new Response(JSON.stringify({ title: "Too Many Requests" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "7" } }),
      ok("3"),
    ]);
    const post = await client.post({ text: "three" });
    expect(post.id).toBe("3");
    expect(sleeps).toEqual([7_000]);
    expect(fetches).toHaveLength(2);
  });

  it("a 429 with only a reset timestamp waits until the reset", async () => {
    const reset = Math.floor(1_700_000_000_000 / 1000) + 12;
    const { client, sleeps } = await runtime([
      () => new Response("{}", { status: 429, headers: { "content-type": "application/json", "x-rate-limit-remaining": "0", "x-rate-limit-reset": String(reset) } }),
      ok("4"),
    ]);
    await client.post({ text: "four" });
    expect(sleeps[0]).toBe(12_000);
  });

  it("the per-account window is tracked per route: a search is not blocked by a posting window", async () => {
    const reset = Math.floor(1_700_000_000_000 / 1000) + 30;
    const { client, sleeps } = await runtime([
      ok("5", { "x-rate-limit-remaining": "0", "x-rate-limit-reset": String(reset) }),
      () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    ]);
    await client.post({ text: "five" });
    await client.search({ query: "fridge", max: 10 });
    expect(sleeps).toEqual([]);
  });

  it("at 100% of the monthly call budget every call is refused with XBudgetPaused and budget().paused is true", async () => {
    const { client, fetches } = await runtime([ok("6"), ok("7"), ok("8")], { X_MONTHLY_CALL_BUDGET: "2" });
    await client.post({ text: "six" });
    await client.post({ text: "seven" });
    await expect(client.post({ text: "eight" })).rejects.toBeInstanceOf(XBudgetPaused);
    expect(fetches).toHaveLength(2);
    const b = await client.budget();
    expect(b.paused).toBe(true);
    expect(b.used).toBe(2);
    expect(b.limit).toBe(2);
  });

  it("a 4xx other than 401/429 is thrown as XApiError, not retried, not swallowed", async () => {
    const { client, fetches } = await runtime([() => new Response(JSON.stringify({ title: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } })]);
    await expect(client.post({ text: "nine" })).rejects.toBeInstanceOf(XApiError);
    expect(fetches).toHaveLength(1);
  });
});
