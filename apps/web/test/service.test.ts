import { describe, expect, it } from "vitest";
import { makeHandlers } from "@/server/handlers";
import { signSession, SESSION_COOKIE } from "@/server/session";
import { buildSharedClients } from "@/server/clients";
import type { Env } from "@/server/types";
import { AGENT_WALLET, OWNER_WALLET, REAL_CA, X_ACCOUNT, fakeShared, makeService, seen } from "./fakes";

const ENV: Env = { SESSION_SECRET: "test-secret", NODE_ENV: "test" };

function cookieFor(accountId: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(signSession(accountId, ENV))}`;
}

function post(url: string, body: unknown, cookie?: string): Request {
  return new Request(`http://app.test${url}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}

async function readSse(res: Response, untilSeq: number, abort: AbortController): Promise<{ id: string; event: string; data: string }[]> {
  const frames: { id: string; event: string; data: string }[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const id = /^id: (.+)$/m.exec(block)?.[1];
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (id && event && data) frames.push({ id, event, data });
      idx = buffer.indexOf("\n\n");
    }
    if (frames.some((f) => Number(f.id) >= untilSeq)) {
      abort.abort();
      break;
    }
  }
  return frames;
}

describe("orchestrator service", () => {
  it("creates a launch with injected fakes, reports unavailable clients with their env vars, and goes live through approve + pick", async () => {
    const svc = makeService();
    const h = makeHandlers(async () => svc, () => ENV);

    const created = await h.createLaunch(post("/api/launch", { prompt: "a coin about cats in cryostats", ownerWallet: OWNER_WALLET }, cookieFor(X_ACCOUNT)));
    expect(created.status).toBe(201);
    const { id, clients } = (await created.json()) as { id: string; clients: Record<string, { ok: boolean; needs?: string[]; message?: string }> };
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(clients["llm"]?.ok).toBe(true);
    expect(clients["x"]?.ok).toBe(true);
    expect(clients["solana"]?.ok).toBe(true);
    expect(clients["image"]?.ok).toBe(false);
    expect(clients["image"]?.needs).toContain("IMAGE_PROVIDER=openai|fal|replicate");
    expect(clients["image"]?.message).toContain("IMAGE_PROVIDER is not set");
    expect(clients["quantum"]?.needs).toEqual(["ANU_QRNG_API_KEY"]);

    // The Voice blocks on the real gate; the Recruiter's collapse has no QRNG → user pick.
    const bus = svc.eventBus;
    const awaiting = await seen(svc, id, "Worker.awaitingApproval");
    const approvalId = awaiting.payload.approval.id;
    expect(svc.pendingApprovals(id).map((a) => a.id)).toContain(approvalId);

    const bad = await h.approve(post(`/api/launch/${id}/approve`, { approvalId, decision: "maybe" }), { id });
    expect(bad.status).toBe(400);
    const missing = await h.approve(post(`/api/launch/${id}/approve`, { approvalId: "nope", decision: "approve" }), { id });
    expect(missing.status).toBe(404);
    const ok = await h.approve(post(`/api/launch/${id}/approve`, { approvalId, decision: "approve" }), { id });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ resolved: true });

    const unavailable = await seen(svc, id, "Orchestrator.collapseUnavailable");
    expect(unavailable.payload.worker).toBe("Recruiter");
    const badPick = await h.pick(post(`/api/launch/${id}/pick`, { worker: "Recruiter", candidateId: "zzz" }), { id });
    expect(badPick.status).toBe(400);
    const picked = await h.pick(post(`/api/launch/${id}/pick`, { worker: "Recruiter", candidateId: "b" }), { id });
    expect(picked.status).toBe(200);

    await seen(svc, id, "Launch.live");
    const detailRes = await h.getLaunch(new Request(`http://app.test/api/launch/${id}`), { id });
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as { state: { status: string; coinCa?: string; agentWallet: string; workers: Record<string, { status: string }> }; events: unknown[]; seq: number; meta: { postLaunch: { status: string } } };
    expect(detail.state.status).toBe("live");
    expect(detail.state.coinCa).toBe(REAL_CA);
    expect(detail.state.agentWallet).toBe(AGENT_WALLET);
    expect(detail.state.workers["Recruiter"]?.status).toBe("done");
    expect(detail.state.workers["Voice"]?.status).toBe("done");
    expect(detail.events.length).toBe(detail.seq);

    // state() is rebuild(log) and equals the live handle state exactly
    expect(await svc.state(id)).toStrictEqual(JSON.parse(JSON.stringify(await svc.state(id))));

    // autopilot
    const ap = await h.autopilot(post(`/api/launch/${id}/autopilot`, { trades: true }), { id });
    expect(ap.status).toBe(200);
    expect(((await ap.json()) as { autopilot: { trades: boolean; posts: boolean } }).autopilot).toMatchObject({ trades: true, posts: false });
    const apBad = await h.autopilot(post(`/api/launch/${id}/autopilot`, { trades: "yes" }), { id });
    expect(apBad.status).toBe(400);
    expect((await svc.state(id)).autopilot.trades).toBe(true);

    // me: launches of the connected account, wallets, no pending approvals left
    const meRes = await h.me(new Request("http://app.test/api/me", { headers: { cookie: cookieFor(X_ACCOUNT) } }));
    const me = (await meRes.json()) as { account: { accountId: string; handle?: string }; launches: { id: string; coinCa?: string }[]; wallets: { address: string }[]; pendingApprovals: unknown[] };
    expect(me.account).toEqual({ accountId: X_ACCOUNT, handle: `handle_${X_ACCOUNT}` });
    expect(me.launches.map((l) => l.id)).toEqual([id]);
    expect(me.launches[0]?.coinCa).toBe(REAL_CA);
    expect(me.wallets[0]?.address).toBe(AGENT_WALLET);
    expect(me.pendingApprovals).toEqual([]);
    expect(svc.findByCa(REAL_CA)).toBe(id);
    expect(svc.findByCa("nope")).toBeNull();

    // post-launch runtime was disabled in this process and says so
    expect(detail.meta.postLaunch.status).toBe("unavailable");
    await svc.stopAll();
  });

  it("refuses a launch without a session, a wallet or a prompt, with the real reason", async () => {
    const svc = makeService();
    const h = makeHandlers(async () => svc, () => ENV);
    const noSession = await h.createLaunch(post("/api/launch", { prompt: "x", ownerWallet: OWNER_WALLET }));
    expect(noSession.status).toBe(400);
    expect(((await noSession.json()) as { error: { message: string } }).error.message).toMatch(/no X account is connected/);
    const noWallet = await h.createLaunch(post("/api/launch", { prompt: "x" }, cookieFor(X_ACCOUNT)));
    expect(noWallet.status).toBe(400);
    const noPrompt = await h.createLaunch(post("/api/launch", { ownerWallet: OWNER_WALLET }, cookieFor(X_ACCOUNT)));
    expect(((await noPrompt.json()) as { error: { message: string } }).error.message).toMatch(/"prompt"/);
    const forged = await h.createLaunch(post("/api/launch", { prompt: "x", ownerWallet: OWNER_WALLET }, `${SESSION_COOKIE}=${X_ACCOUNT}.forged`));
    expect(forged.status).toBe(400);
  });

  it("refuses a launch on serverless hosting with a 501 that names the long-lived host it needs", async () => {
    const svc = makeService({ env: { SESSION_SECRET: "test-secret", NODE_ENV: "test", VERCEL: "1" } });
    const h = makeHandlers(async () => svc, () => ENV);
    const res = await h.createLaunch(post("/api/launch", { prompt: "cats", ownerWallet: OWNER_WALLET }, cookieFor(X_ACCOUNT)));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: { name: string; message: string; needs?: string[] } };
    expect(body.error.name).toBe("NotImplemented");
    expect(body.error.message).toMatch(/Vercel serverless/);
    expect(JSON.stringify(body.error)).toMatch(/long-lived Node server/);
    await svc.stopAll();
  });

  it("runs a launch whose X account is not connected: the Voice fails with the exact reason, the rest proceeds", async () => {
    const svc = makeService({ shared: fakeShared({ xConnected: [] }) });
    const h = makeHandlers(async () => svc, () => ENV);
    const created = await h.createLaunch(post("/api/launch", { prompt: "cats", ownerWallet: OWNER_WALLET }, cookieFor(X_ACCOUNT)));
    const { id, clients } = (await created.json()) as { id: string; clients: Record<string, { ok: boolean; message?: string }> };
    expect(clients["x"]?.ok).toBe(false);
    expect(clients["x"]?.message).toContain(`X account ${X_ACCOUNT} is not connected`);
    // The scripted Voice does not touch the client, so it still gates; approve it to let the launch settle.
    const awaiting = await seen(svc, id, "Worker.awaitingApproval");
    svc.approve(id, awaiting.payload.approval.id, "skip");
    await seen(svc, id, "Orchestrator.collapseUnavailable");
    svc.pick(id, "Recruiter", "a");
    const final = await seen(svc, id, "Launch.partial");
    expect(final.payload.failed).toEqual(["Voice"]);
    const state = await svc.state(id);
    expect(state.workers.Voice.failReason).toMatch(/skipped/);
    await svc.stopAll();
  });

  it("streams SSE from the bus and resumes from Last-Event-ID", async () => {
    const svc = makeService();
    const h = makeHandlers(async () => svc, () => ENV);
    const created = await h.createLaunch(post("/api/launch", { prompt: "cats", ownerWallet: OWNER_WALLET }, cookieFor(X_ACCOUNT)));
    const { id } = (await created.json()) as { id: string };
    const awaiting = await seen(svc, id, "Worker.awaitingApproval");
    const log = await svc.eventBus.log(id);
    const last = log[log.length - 1]!.seq;
    expect(last).toBeGreaterThan(5);

    const full = new AbortController();
    const res = await h.events(new Request(`http://app.test/api/launch/${id}/events`, { signal: full.signal }), { id });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = await readSse(res, last, full);
    expect(frames.map((f) => Number(f.id))).toEqual(log.map((e) => e.seq));
    expect(frames[0]?.event).toBe("Launch.started");
    expect(JSON.parse(frames[0]!.data)).toMatchObject({ type: "Launch.started", launchId: id, seq: 1 });

    const resumeFrom = 3;
    const partial = new AbortController();
    const res2 = await h.events(new Request(`http://app.test/api/launch/${id}/events`, { headers: { "last-event-id": String(resumeFrom) }, signal: partial.signal }), { id });
    const resumed = await readSse(res2, last, partial);
    expect(Number(resumed[0]?.id)).toBe(resumeFrom + 1);
    expect(resumed.map((f) => Number(f.id))).toEqual(log.filter((e) => e.seq > resumeFrom).map((e) => e.seq));

    // live events after the history: approve, and the frame arrives on an open stream
    const live = new AbortController();
    const res3 = await h.events(new Request(`http://app.test/api/launch/${id}/events?after=${last}`, { signal: live.signal }), { id });
    const livePromise = readSse(res3, last + 1, live);
    svc.approve(id, awaiting.payload.approval.id, "approve");
    const liveFrames = await livePromise;
    expect(liveFrames[0]?.event).toBe("Worker.approvalResolved");

    const missing = await h.events(new Request("http://app.test/api/launch/nope/events"), { id: "nope" });
    expect(missing.status).toBe(404);
    svc.pick(id, "Recruiter", "a");
    await seen(svc, id, "Launch.live");
    await svc.stopAll();
  });

  it("reports status with provider health, store kinds, X status, hosting, queue and cost", async () => {
    const svc = makeService();
    const h = makeHandlers(async () => svc, () => ENV);
    const res = await h.status();
    expect(res.status).toBe(200);
    const s = (await res.json()) as Record<string, unknown> & { providers: Record<string, { ok: boolean; needs?: string[]; detail?: string }>; cost: Record<string, number | string | string[]>; store: Record<string, string>; x: { ok: boolean }; queue: { launches: number }; hosting: { health: { ok: boolean } } };
    expect(Object.keys(s).sort()).toEqual(["at", "cluster", "cost", "hosting", "providers", "queue", "store", "x"]);
    expect(s["cluster"]).toBe("mainnet-beta");
    expect(s.providers["llm"]?.ok).toBe(true);
    expect(s.providers["image"]?.ok).toBe(false);
    expect(s.providers["hosting"]?.needs).toEqual(["HOSTING_PROVIDER=cloudflare|vercel"]);
    expect(s.providers["solana"]?.ok).toBe(false);
    expect(s.providers["solana"]?.needs).toEqual(["AGENT_WALLET_KEY"]);
    expect(s.store).toEqual({ events: "memory", stream: "memory", tokens: "memory", wallets: "memory" });
    expect(s.x.ok).toBe(true);
    expect(s.hosting.health.ok).toBe(false);
    expect(s.queue.launches).toBe(0);
    expect(s.cost["youPaySol"]).toBeCloseTo(0.03 + 0.0005 + 0.1 + 0.1, 6);
    expect(s.cost["cluster"]).toBe("mainnet-beta");
  });

  it("builds every shared client from an empty env as NotImplemented with the exact env vars", async () => {
    const shared = await buildSharedClients({});
    expect(shared.llm.ok).toBe(false);
    if (!shared.llm.ok) expect(shared.llm.error.needs[0]).toBe("LLM_PROVIDER=anthropic|openai");
    expect(shared.image.ok).toBe(false);
    expect(shared.hosting.ok).toBe(false);
    expect(shared.quantum.ok).toBe(false);
    if (!shared.quantum.ok) expect(shared.quantum.error.needs).toContain("ANU_QRNG_API_KEY");
    expect(shared.x.ok).toBe(false);
    if (!shared.x.ok) expect(shared.x.error.name).toBe("NotImplemented");
    expect(shared.webhook.ok).toBe(false);
    expect(shared.wallets.kind).toBe("memory");
    expect(shared.store).toEqual({ events: "memory", stream: "memory", tokens: "unavailable" });

    const svc = makeService({ shared });
    const h = makeHandlers(async () => svc, () => ENV);
    const start = await h.oauthStart(new Request("http://app.test/api/x/oauth/start"));
    expect(start.status).toBe(501);
    const body = (await start.json()) as { error: { needs: string[] } };
    expect(body.error.needs.length).toBeGreaterThan(0);
    const hook = await h.heliusWebhook(new Request("http://app.test/api/helius/webhook", { method: "POST", body: "[]" }));
    expect(hook.status).toBe(501);
    expect(await hook.text()).toContain("HELIUS_WEBHOOK_SECRET");
  });

  it("completes the X OAuth callback into a signed session cookie, and rejects a mismatched state", async () => {
    const svc = makeService();
    const h = makeHandlers(async () => svc, () => ENV);
    const start = await h.oauthStart(new Request("http://app.test/api/x/oauth/start", { method: "POST" }));
    expect(start.status).toBe(200);
    const stateCookie = start.headers.get("set-cookie") ?? "";
    expect(stateCookie).toContain("qa_x_state=abc");

    const mismatch = await h.oauthCallback(new Request("http://app.test/api/x/oauth/callback?code=c&state=abc", { headers: { cookie: "qa_x_state=other" } }));
    expect(mismatch.status).toBe(302);
    expect(mismatch.headers.get("location")).toContain("x_error=");

    const ok = await h.oauthCallback(new Request("http://app.test/api/x/oauth/callback?code=c&state=abc", { headers: { cookie: "qa_x_state=abc" } }));
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/?connected=x");
    const setCookies = ok.headers.get("set-cookie") ?? "";
    expect(setCookies).toContain(`${SESSION_COOKIE}=`);
    const value = decodeURIComponent(/qa_session=([^;]+)/.exec(setCookies)![1]!);
    expect(value.startsWith(`${X_ACCOUNT}.`)).toBe(true);

    const denied = await h.oauthCallback(new Request("http://app.test/api/x/oauth/callback?error=access_denied"));
    expect(denied.headers.get("location")).toContain("access_denied");
  });
});
