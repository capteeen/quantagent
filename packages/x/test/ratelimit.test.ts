import { describe, expect, it } from "vitest";
import { XApiError, XDeadLettered } from "../src/errors";
import { backoffMs, parseRateLimitHeaders, waitFromHeaders } from "../src/ratelimit/backoff";
import { RateLimiter, XRateLimitWait } from "../src/ratelimit/limiter";
import { TokenBucket } from "../src/ratelimit/tokenBucket";
import { FakeClock, buildClient, mockFetch, tweetsOk } from "./helpers";

describe("TokenBucket", () => {
  it("bursts to capacity then refills over time", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 2, refillPerSecond: 1 }, clock.now);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    expect(b.msUntilToken()).toBe(1000);
    clock.advance(1000);
    expect(b.tryTake()).toBe(true);
    clock.advance(10_000);
    expect(b.available()).toBe(2);
  });
});

describe("header parsing and backoff", () => {
  it("parses x-rate-limit-* and retry-after", () => {
    expect(parseRateLimitHeaders({ "x-rate-limit-limit": "50", "x-rate-limit-remaining": "3", "x-rate-limit-reset": "1700000000", "retry-after": "7" })).toEqual({
      limit: 50,
      remaining: 3,
      resetAt: 1_700_000_000_000,
      retryAfterMs: 7000,
    });
    expect(waitFromHeaders({ "retry-after": "2" }, 0)).toBe(2000);
    expect(waitFromHeaders({ "x-rate-limit-reset": "100" }, 40_000)).toBe(60_000);
    expect(waitFromHeaders({}, 0)).toBeUndefined();
  });
  it("backs off exponentially with a cap", () => {
    const o = { baseMs: 100, maxMs: 1000, jitter: 0 };
    expect([0, 1, 2, 3, 4, 10].map((a) => backoffMs(a, o))).toEqual([100, 200, 400, 800, 1000, 1000]);
  });
});

describe("RateLimiter", () => {
  it("honours a remaining=0 window by waiting until reset on that route only", async () => {
    const clock = new FakeClock();
    const rl = new RateLimiter({ now: clock.now, sleep: clock.sleep, global: { capacity: 100, refillPerSecond: 100 }, perAccount: { capacity: 100, refillPerSecond: 100 } });
    rl.observe("acc", "POST /2/tweets", { "x-rate-limit-remaining": "0", "x-rate-limit-reset": String(Math.floor(clock.t / 1000) + 30) });
    expect(rl.waitFor("acc", "POST /2/tweets")).toBeGreaterThan(29_000);
    expect(rl.waitFor("acc", "GET /2/users")).toBe(0);
    expect(rl.waitFor("other", "POST /2/tweets")).toBe(0);
    await rl.acquire("acc", "POST /2/tweets");
    expect(clock.sleeps.length).toBe(1);
    expect(clock.sleeps[0]).toBeGreaterThan(29_000);
  });

  it("throws instead of hanging when the wait exceeds the ceiling", async () => {
    const clock = new FakeClock();
    const rl = new RateLimiter({ now: clock.now, sleep: clock.sleep, maxWaitMs: 1000 });
    rl.observe("acc", "r", { "x-rate-limit-remaining": "0", "x-rate-limit-reset": String(Math.floor(clock.t / 1000) + 3600) });
    await expect(rl.acquire("acc", "r")).rejects.toBeInstanceOf(XRateLimitWait);
  });

  it("per-account and global buckets both gate", async () => {
    const clock = new FakeClock();
    const rl = new RateLimiter({ now: clock.now, sleep: clock.sleep, global: { capacity: 3, refillPerSecond: 1 }, perAccount: { capacity: 2, refillPerSecond: 1 } });
    await rl.acquire("a", "r");
    await rl.acquire("a", "r");
    expect(rl.waitFor("a", "r")).toBe(1000); // account bucket empty
    expect(rl.waitFor("b", "r")).toBe(0);
    await rl.acquire("b", "r");
    expect(rl.waitFor("b", "r")).toBe(1000); // global bucket empty now
    const snap = rl.snapshot();
    expect(snap.global.available).toBe(0);
    expect(snap.accounts["a"]?.available).toBe(0);
  });
});

describe("XHttp honours X rate-limit headers", () => {
  it("waits for the reset before the next call on a route X marked exhausted", async () => {
    const clock = new FakeClock();
    const resetSec = Math.floor(clock.t / 1000) + 30;
    const fetch = mockFetch((call, i) => {
      const r = tweetsOk()(call, i) as { json: unknown };
      return i === 0
        ? { ...r, headers: { "x-rate-limit-limit": "50", "x-rate-limit-remaining": "0", "x-rate-limit-reset": String(resetSec) } }
        : r;
    });
    const { client, limiter } = buildClient({ fetch, clock });
    await client.post({ text: "one" });
    expect(clock.sleeps).toEqual([]);
    const t0 = clock.t;
    await client.post({ text: "two" });
    expect(fetch.calls.length).toBe(2);
    expect(clock.sleeps.length).toBe(1);
    expect(clock.t - t0).toBeGreaterThanOrEqual(29_000);
    expect(clock.t).toBeGreaterThanOrEqual(resetSec * 1000);
    expect(limiter.snapshot().accounts["1234567890"]?.routes["POST /2/tweets"]?.limit).toBe(50);
  });

  it("backs off on 429 using the reset header, then succeeds", async () => {
    const clock = new FakeClock();
    const resetSec = Math.floor(clock.t / 1000) + 5;
    const fetch = mockFetch((call, i) =>
      i === 0
        ? { status: 429, json: { title: "Too Many Requests" }, headers: { "x-rate-limit-remaining": "0", "x-rate-limit-reset": String(resetSec) } }
        : tweetsOk()(call, i),
    );
    const { client, events } = buildClient({ fetch, clock });
    const post = await client.post({ text: "hi" });
    expect(post.id).toBe("100");
    expect(post.url).toBe("https://x.com/quantagent/status/100");
    expect(fetch.calls.length).toBe(2);
    expect(clock.sleeps.length).toBe(1);
    expect(clock.sleeps[0]).toBeGreaterThanOrEqual(4000);
    expect(clock.sleeps[0]).toBeLessThanOrEqual(5000);
    expect(events.find((e) => e.type === "retry")).toMatchObject({ type: "retry", reason: "429" });
  });

  it("backs off exponentially on 429 without headers and on 5xx", async () => {
    const clock = new FakeClock();
    const fetch = mockFetch((call, i) => (i === 0 ? { status: 429, json: {} } : i === 1 ? { status: 503, text: "down" } : tweetsOk()(call, i)));
    const { client } = buildClient({ fetch, clock, maxAttempts: 4 });
    await client.post({ text: "hi" });
    expect(fetch.calls.length).toBe(3);
    expect(clock.sleeps).toEqual([1000, 2000]);
  });

  it("gives up after maxAttempts and dead-letters the write, failure visible", async () => {
    const clock = new FakeClock();
    const fetch = mockFetch(() => ({ status: 429, json: { title: "Too Many Requests" } }));
    const { client, dlq, events } = buildClient({ fetch, clock, maxAttempts: 3 });
    const err = await client.post({ text: "hi" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(XDeadLettered);
    expect((err as XDeadLettered).cause).toBeInstanceOf(XApiError);
    expect(fetch.calls.length).toBe(3);
    const list = await dlq.list();
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ op: "post", status: "failed", input: { text: "hi" }, accountId: "1234567890" });
    expect(list[0]!.error).toMatch(/429/);
    expect(events.some((e) => e.type === "gaveUp")).toBe(true);
    expect(events.some((e) => e.type === "deadLetter")).toBe(true);
  });

  it("refreshes the token once on 401 and retries", async () => {
    const clock = new FakeClock();
    let refreshes = 0;
    const auth = {
      accountId: "1234567890",
      token: async () => (refreshes ? "fresh" : "stale"),
      refresh: async () => {
        refreshes++;
        return "fresh";
      },
      handle: async () => "quantagent",
    };
    const fetch = mockFetch((call, i) => (call.headers["authorization"] === "Bearer stale" ? { status: 401, json: {} } : tweetsOk()(call, i)));
    const { client } = buildClient({ fetch, clock, auth });
    await client.post({ text: "hi" });
    expect(refreshes).toBe(1);
    expect(fetch.calls.map((c) => c.headers["authorization"])).toEqual(["Bearer stale", "Bearer fresh"]);
  });

  it("does not retry or dead-letter a 400/403: the failure is terminal and thrown as-is", async () => {
    const fetch = mockFetch(() => ({ status: 403, json: { detail: "forbidden" } }));
    const { client, dlq } = buildClient({ fetch });
    await expect(client.post({ text: "x" })).rejects.toMatchObject({ name: "XApiError", status: 403 });
    expect(fetch.calls.length).toBe(1);
    expect(await dlq.list()).toEqual([]);
  });
});
