import { describe, expect, it } from "vitest";
import { MemoryBudgetStore, MonthlyBudget, RedisBudgetStore, budgetLimitFromEnv, monthKey, monthResetAt } from "../src/budget/budget";
import { XBudgetPaused } from "../src/errors";
import { FakeClock, buildClient, mockFetch, tweetsOk } from "./helpers";

describe("MonthlyBudget", () => {
  it("defaults to 1500 and parses X_MONTHLY_CALL_BUDGET", () => {
    expect(budgetLimitFromEnv({})).toBe(1500);
    expect(budgetLimitFromEnv({ X_MONTHLY_CALL_BUDGET: "500" })).toBe(500);
    expect(() => budgetLimitFromEnv({ X_MONTHLY_CALL_BUDGET: "lots" })).toThrow(/positive number/);
    expect(() => budgetLimitFromEnv({ X_MONTHLY_CALL_BUDGET: "0" })).toThrow(/positive number/);
  });

  it("counts calls, pauses at 100%, resets next month", async () => {
    const clock = new FakeClock(Date.UTC(2026, 9, 9));
    const b = new MonthlyBudget({ limit: 3, store: new MemoryBudgetStore(), now: clock.now });
    expect(await b.status()).toEqual({ used: 0, limit: 3, resetsAt: "2026-11-01T00:00:00.000Z", paused: false, percent: 0, month: "2026-10" });
    await b.record();
    await b.record(2);
    const s = await b.status();
    expect(s).toMatchObject({ used: 3, paused: true, percent: 100 });
    await expect(b.assertAvailable()).rejects.toBeInstanceOf(XBudgetPaused);
    clock.t = Date.UTC(2026, 10, 1, 0, 0, 1);
    expect(await b.status()).toMatchObject({ used: 0, paused: false, month: "2026-11", resetsAt: "2026-12-01T00:00:00.000Z" });
    await b.assertAvailable();
  });

  it("month helpers roll over December correctly", () => {
    const t = Date.UTC(2026, 11, 31, 23, 59);
    expect(monthKey(t)).toBe("2026-12");
    expect(monthResetAt(t)).toBe("2027-01-01T00:00:00.000Z");
  });

  it("RedisBudgetStore uses INCRBY/GET on the month key", async () => {
    const kv = new Map<string, string>();
    const store = new RedisBudgetStore({
      async get(k) {
        return kv.get(k) ?? null;
      },
      async incrby(k, n) {
        const v = Number(kv.get(k) ?? 0) + n;
        kv.set(k, String(v));
        return v;
      },
    });
    const clock = new FakeClock(Date.UTC(2026, 9, 9));
    const b = new MonthlyBudget({ limit: 10, store, now: clock.now });
    await b.record(4);
    expect(kv.get("x:budget:2026-10")).toBe("4");
    expect((await b.status()).used).toBe(4);
  });
});

describe("budget pause in the client", () => {
  it("every API call counts; at 100% posting is refused with XBudgetPaused and budget() says paused", async () => {
    const clock = new FakeClock(Date.UTC(2026, 9, 9));
    const fetch = mockFetch(tweetsOk());
    const { client, events } = buildClient({ fetch, clock, budgetLimit: 2 });
    await client.post({ text: "a" });
    expect(await client.budget()).toMatchObject({ used: 1, limit: 2, paused: false });
    await client.post({ text: "b" });
    const status = await client.budget();
    expect(status).toEqual({ used: 2, limit: 2, resetsAt: "2026-11-01T00:00:00.000Z", paused: true });

    const err = await client.post({ text: "c" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(XBudgetPaused);
    expect((err as XBudgetPaused).message).toMatch(/posting paused/);
    expect(fetch.calls.length).toBe(2); // nothing was sent
    expect(events.some((e) => e.type === "budgetPaused")).toBe(true);
    // Reads are calls too: also refused, never silently over budget.
    await expect(client.mentions({})).rejects.toBeInstanceOf(XBudgetPaused);

    // Next month it resumes.
    clock.t = Date.UTC(2026, 10, 2);
    await client.post({ text: "d" });
    expect(await client.budget()).toMatchObject({ used: 1, paused: false });
  });

  it("retries count against the budget (each HTTP call is real)", async () => {
    const clock = new FakeClock();
    const fetch = mockFetch((call, i) => (i < 2 ? { status: 503, text: "x" } : tweetsOk()(call, i)));
    const { client } = buildClient({ fetch, clock, maxAttempts: 3, budgetLimit: 100 });
    await client.post({ text: "a" });
    expect((await client.budget()).used).toBe(3);
  });
});
