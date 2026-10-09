/**
 * apps/web (the surface being finished by Agent F): black-box checks on the server layer that
 * stand between a browser and core. Skips with a printed reason while the app is not importable.
 *  - the session cookie is HMAC-signed and cannot name another user's X account;
 *  - the launch route derives the XClient from the SAME account id the session carries, through
 *    the real @quantagent/x runtime, and a never-connected account yields no client at all;
 *  - the Helius webhook refuses a missing/wrong Authorization header (401) and is 501 when unconfigured;
 *  - the cluster defaults to devnet and mainnet needs the explicit flag.
 */
import { describe, expect, it } from "vitest";
import { EventBus, type Worker } from "@quantagent/core";
import type { Launch } from "@quantagent/core/types";
import { MainnetRefused, MemoryKeyStore, WebhookHub, createHeliusWebhookHandler } from "@quantagent/solana";
import { createXRuntime } from "@quantagent/x";

type SessionModule = typeof import("../apps/web/src/server/session");
type ServiceModule = typeof import("../apps/web/src/server/service");

async function loadWeb(): Promise<{ session: SessionModule; service: ServiceModule } | { reason: string }> {
  try {
    const session = await import("../apps/web/src/server/session");
    const service = await import("../apps/web/src/server/service");
    return { session, service };
  } catch (err) {
    return { reason: err instanceof Error ? err.message.split("\n")[0]! : String(err) };
  }
}

const web = await loadWeb();
if ("reason" in web) console.log(`SKIP apps/web checks: ${web.reason}`);

const ENV = { NODE_ENV: "test", SESSION_SECRET: "s3cret", X_CLIENT_ID: "cid", X_REDIRECT_URI: "https://app.test/cb", X_TOKEN_KEY: "ab".repeat(32), X_TOKEN_STORE: "memory" };

describe.skipIf("reason" in web)("apps/web server layer", () => {
  const { session, service } = web as { session: SessionModule; service: ServiceModule };

  it("the session cookie is signed: tampering with the account id or the mac yields no session", () => {
    const cookie = session.signSession("acct-A", ENV);
    expect(session.verifySession(cookie, ENV)).toBe("acct-A");
    const [id, mac] = cookie.split(".") as [string, string];
    expect(session.verifySession(`acct-B.${mac}`, ENV)).toBeNull();
    expect(session.verifySession(`${id}.${mac.slice(0, -2)}xx`, ENV)).toBeNull();
    expect(session.verifySession(cookie, { ...ENV, SESSION_SECRET: "other" })).toBeNull();
    expect(session.verifySession(cookie, { NODE_ENV: "test" })).toBeNull(); // no secret → nobody is logged in
    expect(session.readSession(`foo=1; ${session.SESSION_COOKIE}=${encodeURIComponent(cookie)}`, ENV)).toBe("acct-A");
    expect(() => session.signSession("acct A", ENV)).toThrow(/url-safe/);
    expect(session.sessionSetCookie("acct-A", { ...ENV, NODE_ENV: "production" })).toMatch(/HttpOnly; SameSite=Lax; Secure$/);
  });

  it("clusterFromEnv defaults to devnet and refuses mainnet without QUANTAGENT_MAINNET=true", () => {
    expect(service.clusterFromEnv({})).toBe("devnet");
    expect(() => service.clusterFromEnv({ SOLANA_CLUSTER: "mainnet-beta" })).toThrow(MainnetRefused);
    expect(service.clusterFromEnv({ SOLANA_CLUSTER: "mainnet-beta", QUANTAGENT_MAINNET: "true" })).toBe("mainnet-beta");
  });

  async function serviceWith(opts: { connected: string[]; webhookSecret?: string }) {
    const rt = await createXRuntime({ env: ENV, fetch: async () => new Response("{}", { status: 200 }) });
    for (const id of opts.connected) {
      await rt.store.put({ accountId: id, accessToken: "at", refreshToken: "rt", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [], updatedAt: new Date().toISOString() });
    }
    const hub = new WebhookHub();
    const seen: { xAccountId: string | undefined; connections: { xAccountId: string } }[] = [];
    const unavailable = (capability: string) => ({ ok: false as const, error: { ok: false as const, name: "NotImplemented", message: `${capability} unavailable`, capability, because: "test", needs: [] } });
    const svc = new service.OrchestratorService({
      env: ENV,
      bus: new EventBus(),
      shared: {
        llm: unavailable("llm"),
        image: unavailable("image"),
        hosting: unavailable("hosting"),
        quantum: unavailable("quantum"),
        x: { ok: true, value: rt },
        wallets: { kind: "memory", keyStore: new MemoryKeyStore() },
        hub,
        webhook: opts.webhookSecret ? { ok: true, value: createHeliusWebhookHandler({ secret: opts.webhookSecret, hub }) } : unavailable("Helius webhook"),
        store: { events: "memory", stream: "memory", tokens: "memory" },
      },
      createWorkers: (): Worker[] => [],
      createSolana: async () => {
        throw new Error("no solana in this test");
      },
      startPostLaunch: null,
      // Capture what reaches core instead of running a launch.
      launch: (async (_prompt: unknown, connections: { xAccountId: string }, _options: unknown, deps: { clients: { x: { accountId: string } | null }; launchId?: string }) => {
        seen.push({ xAccountId: deps.clients.x?.accountId, connections });
        const state = { status: "failed" } as unknown as Launch;
        return { id: deps.launchId ?? "id", settled: new Promise<Launch>(() => {}), getState: () => state };
      }) as never,
    });
    return { svc, seen };
  }

  it("the launch's XClient is scoped to the session's account id and never another connected account", async () => {
    const { svc, seen } = await serviceWith({ connected: ["acct-A", "acct-B"] });
    const res = await svc.createLaunch({ prompt: "a coin about fridge cats", xAccountId: "acct-A", ownerWallet: "wallet" });
    expect(res.clients.x).toMatchObject({ ok: true, detail: "acct-A" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.xAccountId).toBe("acct-A");
    expect(seen[0]!.connections.xAccountId).toBe("acct-A");
  });

  it("a never-connected account gets no XClient at all (the launch is told, nothing is borrowed from another account)", async () => {
    const { svc, seen } = await serviceWith({ connected: ["acct-A"] });
    const res = await svc.createLaunch({ prompt: "a coin about fridge cats", xAccountId: "acct-Z", ownerWallet: "wallet" });
    expect(res.clients.x.ok).toBe(false);
    expect(JSON.stringify(res.clients.x)).toMatch(/acct-Z/);
    expect(seen[0]!.xAccountId).toBeUndefined();
    expect(seen[0]!.connections.xAccountId).toBe("acct-Z");
    await expect(svc.createLaunch({ prompt: "x", xAccountId: "", ownerWallet: "w" })).rejects.toThrow(/no X account/);
  });

  it("the Helius webhook: 401 without the exact Authorization header, 400 on a non-JSON body, 501 when not configured", async () => {
    const { svc } = await serviceWith({ connected: [], webhookSecret: "hook-secret" });
    expect(svc.webhook({ headers: {}, body: "[]" }).status).toBe(401);
    expect(svc.webhook({ headers: { authorization: "hook-secre" }, body: "[]" }).status).toBe(401);
    expect(svc.webhook({ headers: { authorization: "hook-secret " }, body: "[]" }).status).toBe(401);
    expect(svc.webhook({ headers: { authorization: "hook-secret" }, body: "not json" }).status).toBe(400);
    expect(svc.webhook({ headers: { Authorization: "hook-secret" }, body: "[]" })).toEqual({ status: 200, body: "ok 0" });
    const { svc: off } = await serviceWith({ connected: [] });
    expect(off.webhook({ headers: { authorization: "hook-secret" }, body: "[]" }).status).toBe(501);
  });
});
