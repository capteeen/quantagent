/**
 * §9 check 5: no code path creates an X account; the Voice posts only from the connected
 * account. Grep every package's source for account-creation paths, then assert on a
 * simulated launch that the XClient the Voice receives is scoped to launch.xAccountId,
 * and that no code path constructs an X client with a different account.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createXRuntime, XAccountNotConnected, X_SCOPES } from "@quantagent/x";
import { WORKER_NAMES } from "@quantagent/core/types";
import { X_ACCOUNT_ID } from "./helpers/fakes";
import { simulate, type Sim } from "./helpers/launch";
import { grepLines, packageSources } from "./helpers/scan";

let sim: Sim | undefined;
afterEach(async () => {
  await sim?.stop();
  sim = undefined;
});

describe("no account provisioning anywhere in the codebase (SPEC §5, §9)", () => {
  const files = packageSources({ includeTests: true, includeApps: true });

  it("no signup / register / createAccount / account-create paths in any package", () => {
    const re = /\b(signup|sign_up|sign-up|signUp|createAccount|create_account|users\/create|account\/create|accounts\/create|provisionAccount|bulkConnect)\b/i;
    const hits = grepLines(files, re).filter((h) => !/noProvisioning\.test|README/.test(h.path));
    expect(hits.map((h) => `${h.path}:${h.line} ${h.text}`)).toEqual([]);
  });

  it("'register' only ever means a QSD registration, a quantum provider or the Shield's canonical CA", () => {
    const hits = grepLines(files, /\bregister\w*\b/i).filter(
      (h) =>
        !/^(\/\/|\*|\/\*)/.test(h.text) &&
        !/registerQuantumProvider|unregisterQuantumProvider|registerWithQsd|canonicalRegistered|registered|qsd\.protocol\.register|register\(input: \{ coinCa|registers the canonical|registers the real|Shield registers|register the coin|registered at|registration/i.test(h.text),
    );
    expect(hits.map((h) => `${h.path}:${h.line} ${h.text}`)).toEqual([]);
  });

  it("the only X endpoints the client calls are posting/reading on an already-authorized account", () => {
    const xSrc = files.filter((f) => f.path.startsWith("packages/x/src/") && !/\.test\./.test(f.path));
    const endpoints = new Set<string>();
    for (const f of xSrc) for (const m of f.text.matchAll(/["'`](\/(?:2|1\.1)\/[A-Za-z0-9_/:.{}-]+)/g)) endpoints.add(m[1]!);
    for (const f of xSrc) for (const m of f.text.matchAll(/https:\/\/api\.x\.com(\/[A-Za-z0-9_/:.{}$-]+)/g)) endpoints.add(m[1]!);
    const list = [...endpoints].sort();
    expect(list.length).toBeGreaterThan(3);
    for (const e of list) expect(e, e).not.toMatch(/signup|sign_up|create_account|users\/create|account\/create|register/i);
  });

  it("the OAuth scopes are exactly the posting/reading scopes on the user's own account", () => {
    expect([...X_SCOPES].sort()).toEqual(["media.write", "offline.access", "tweet.read", "tweet.write", "users.read"].sort());
  });

  it("an XClient cannot act for an account that never consented: no tokens → XAccountNotConnected before any HTTP call", async () => {
    let fetches = 0;
    const rt = await createXRuntime({
      env: { X_CLIENT_ID: "cid", X_REDIRECT_URI: "https://app.test/cb", X_TOKEN_KEY: "ab".repeat(32), X_TOKEN_STORE: "memory" },
      fetch: async () => {
        fetches += 1;
        return new Response("{}", { status: 200 });
      },
    });
    const client = rt.client("never-connected-id");
    expect(client.accountId).toBe("never-connected-id");
    await expect(client.post({ text: "hello" })).rejects.toBeInstanceOf(XAccountNotConnected);
    await expect(client.mentions({})).rejects.toBeInstanceOf(XAccountNotConnected);
    expect(fetches).toBe(0);
  });
});

describe("the Voice posts only from the connected account", () => {
  it("every worker's XClient is scoped to launch.xAccountId and nobody constructs another", async () => {
    sim = await simulate({ autopilot: { posts: true } });
    expect(await sim.settledOrTimeout(25_000)).toBe("settled");
    const state = sim.handle.getState();
    expect(state.xAccountId).toBe(X_ACCOUNT_ID);
    for (const w of WORKER_NAMES) {
      const x = sim.handle.runs.get(w)!.ctx.clients.x!;
      expect(x.accountId, w).toBe(state.xAccountId);
    }
    // Everything the Voice posted carries the connected account as author.
    const posted = sim.ofType("Voice.posted");
    expect(posted.length).toBeGreaterThanOrEqual(2);
    for (const e of posted) expect(e.payload.url).toMatch(/^https:\/\/x\.com\/connected\/status\//);
    expect(sim.fakes.x.posts.length + sim.fakes.x.threads.length).toBeGreaterThanOrEqual(2);
  });

  it("FINDING: launch() must refuse an XClient scoped to a different account than connections.xAccountId", async () => {
    // Core is the enforcement layer for the gate; it should also be the enforcement layer for the
    // account. Today launch() accepts clients.x.accountId !== connections.xAccountId silently, so a
    // mis-wired app would post from the wrong account while the launch state names the right one.
    let caught: unknown = null;
    try {
      sim = await simulate({ xAccountId: "x-connected-A", x: { accountId: "x-other-B" } });
    } catch (err) {
      caught = err;
    }
    if (!caught) {
      const voiceX = sim!.handle.runs.get("Voice")!.ctx.clients.x!;
      expect(voiceX.accountId, "the Voice's XClient must be scoped to the connected account").toBe(sim!.handle.getState().xAccountId);
    } else {
      expect(String(caught)).toMatch(/xAccountId|account/i);
    }
  });
});
