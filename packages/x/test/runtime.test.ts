import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import { createXClientFromEnv, createXRuntime } from "../src/client/runtime";
import { createTokenCipher } from "../src/oauth/crypto";
import { MemoryTokenStore } from "../src/oauth/tokenStore";
import { FakeClock, TEST_KEY, mockFetch, tweetsOk } from "./helpers";

const env = {
  X_CLIENT_ID: "cid",
  X_REDIRECT_URI: "https://quantagent.fun/x/callback",
  X_TOKEN_KEY: TEST_KEY,
  X_TOKEN_STORE: "memory",
  X_MONTHLY_CALL_BUDGET: "10",
};

async function seeded(clock: FakeClock) {
  const store = new MemoryTokenStore(createTokenCipher(TEST_KEY));
  await store.put({
    accountId: "42",
    handle: "projectx",
    accessToken: "AT",
    refreshToken: "RT",
    expiresAt: new Date(clock.t + 3_600_000).toISOString(),
    scopes: [],
    updatedAt: new Date(clock.t).toISOString(),
  });
  return store;
}

describe("createXRuntime", () => {
  it("refuses to start without the OAuth app or the token key, naming the variables", async () => {
    await expect(createXRuntime({ env: {} })).rejects.toBeInstanceOf(NotImplemented);
    await expect(createXRuntime({ env: { X_TOKEN_KEY: TEST_KEY, X_TOKEN_STORE: "memory" } })).rejects.toMatchObject({
      name: "NotImplemented",
      needs: ["X_CLIENT_ID", "X_REDIRECT_URI"],
    });
  });

  it("builds clients per connected account that share limiter, budget and DLQ; status() reports all of it", async () => {
    const clock = new FakeClock(Date.UTC(2026, 9, 9));
    const store = await seeded(clock);
    const fetch = mockFetch(tweetsOk(1));
    const rt = await createXRuntime({ env, store, fetch, now: clock.now, sleep: clock.sleep });
    const c = rt.client("42");
    expect(rt.client("42")).toBe(c);
    expect(c.accountId).toBe("42");
    const p = await c.post({ text: "hello" });
    expect(p.url).toBe("https://x.com/projectx/status/1");
    expect(fetch.calls[0]!.headers["authorization"]).toBe("Bearer AT");

    const s = await rt.status();
    expect(s.budget).toMatchObject({ used: 1, limit: 10, paused: false });
    expect(s.deadLetters).toEqual({ count: 0, failed: 0, items: [] });
    expect(s.accounts).toEqual([{ accountId: "42", handle: "projectx", expiresAt: expect.any(String), updatedAt: expect.any(String) }]);
    expect(s.rateLimit.accounts["42"]).toBeDefined();
    expect(JSON.stringify(s)).not.toContain("AT");
  });

  it("refreshes an expiring token through the store before calling X", async () => {
    const clock = new FakeClock();
    const store = await seeded(clock);
    clock.advance(3_600_000 - 10_000); // inside the 60s skew
    const fetch = mockFetch((call, i) => {
      if (call.url.pathname === "/2/oauth2/token") return { json: { access_token: "AT2", refresh_token: "RT2", expires_in: 7200 } };
      return tweetsOk()(call, i);
    });
    const rt = await createXRuntime({ env, store, fetch, now: clock.now, sleep: clock.sleep });
    await rt.client("42").post({ text: "x" });
    expect(fetch.calls[0]!.url.pathname).toBe("/2/oauth2/token");
    expect(fetch.calls[1]!.headers["authorization"]).toBe("Bearer AT2");
    expect((await store.get("42"))?.refreshToken).toBe("RT2");
  });

  it("a dead letter for an account with no live client still replays through the default handler", async () => {
    const clock = new FakeClock();
    const store = await seeded(clock);
    const fetch = mockFetch(tweetsOk(50));
    const rt = await createXRuntime({ env, store, fetch, now: clock.now, sleep: clock.sleep });
    const entry = await rt.dlq.add({ accountId: "42", op: "post", input: { text: "late" }, error: "earlier process died" });
    const r = await rt.dlq.retry(entry.id);
    expect(r.ok).toBe(true);
    expect(r.entry.result).toMatchObject({ id: "50", text: "late" });
  });

  it("createXClientFromEnv refuses an account the user never connected", async () => {
    const clock = new FakeClock();
    const store = await seeded(clock);
    await expect(createXClientFromEnv("not-connected", { env, store })).rejects.toBeInstanceOf(NotImplemented);
    const c = await createXClientFromEnv("42", { env, store, fetch: mockFetch(tweetsOk()) });
    expect(c.accountId).toBe("42");
  });

  it("picks up X_TREND_QUERY and X_OAUTH1_* from env", async () => {
    const clock = new FakeClock();
    const store = await seeded(clock);
    const fetch = mockFetch((call) => (call.url.pathname === "/2/users/personalized_trends" ? { status: 403, json: {} } : { json: { data: [] } }));
    const rt = await createXRuntime({
      env: { ...env, X_TREND_QUERY: "custom query", X_OAUTH1_CONSUMER_KEY: "a", X_OAUTH1_CONSUMER_SECRET: "b", X_OAUTH1_ACCESS_TOKEN: "42-x", X_OAUTH1_ACCESS_TOKEN_SECRET: "d" },
      store,
      fetch,
      now: clock.now,
      sleep: clock.sleep,
    });
    await rt.client("42").trends();
    expect(fetch.calls[1]!.url.searchParams.get("query")).toBe("custom query");
  });
});
