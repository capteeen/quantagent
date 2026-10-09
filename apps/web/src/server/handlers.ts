/**
 * Route handler bodies as plain functions over Request → Response, so the
 * app/api/** route files are one-liners and tests call these directly.
 */
import type { Env } from "./types";
import type { ApprovalDecision, WorkerName } from "@quantagent/core/types";
import { BadRequest } from "./errors";
import { errorResponse, json, readJson, requireString } from "./http";
import type { OrchestratorService } from "./service";
import {
  OAUTH_STATE_COOKIE,
  oauthStateClearCookie,
  oauthStateSetCookie,
  parseCookies,
  readSession,
  sessionClearCookie,
  sessionSetCookie,
} from "./session";

export type Params = { id: string };

type Svc = () => Promise<OrchestratorService>;

function env(): Env {
  return process.env;
}

export function makeHandlers(getService: Svc, getEnv: () => Env = env) {
  const session = (req: Request): string | null => readSession(req.headers.get("cookie"), getEnv());

  return {
    /** POST /api/launch  { prompt, ownerWallet, autopilot?, devBuySol? } — xAccountId comes from the session only. */
    async createLaunch(req: Request): Promise<Response> {
      try {
        const svc = await getService();
        const body = await readJson(req);
        const prompt = requireString(body, "prompt");
        const ownerWallet = requireString(body, "ownerWallet");
        const xAccountId = session(req);
        if (!xAccountId) throw new BadRequest("no X account is connected to this session; connect X first");
        const options: { autopilot?: Partial<{ posts: boolean; trades: boolean; recruiting: boolean }>; devBuySol?: number } = {};
        if (body["autopilot"] && typeof body["autopilot"] === "object") options.autopilot = body["autopilot"] as Partial<{ posts: boolean; trades: boolean; recruiting: boolean }>;
        if (typeof body["devBuySol"] === "number") options.devBuySol = body["devBuySol"];
        const result = await svc.createLaunch({ prompt, ownerWallet, xAccountId, options });
        return json(result, { status: 201 });
      } catch (err) {
        return errorResponse(err);
      }
    },

    /** GET /api/launch/[id] — state rebuilt from the log, launch meta, pending approvals. */
    async getLaunch(_req: Request, { id }: Params): Promise<Response> {
      try {
        const svc = await getService();
        const detail = await svc.detail(id);
        const events = await svc.log(id);
        return json({ ...detail, events });
      } catch (err) {
        return errorResponse(err);
      }
    },

    /** GET /api/launch/[id]/events — text/event-stream from bus.toSSE; Last-Event-ID (or ?after=) resumes. */
    async events(req: Request, { id }: Params): Promise<Response> {
      const svc = await getService();
      if (!svc.has(id)) return errorResponse(new Error(`no launch ${id} in this process`), 404);
      const url = new URL(req.url);
      const lastId = req.headers.get("last-event-id") ?? url.searchParams.get("after");
      const afterSeq = lastId && /^\d+$/.test(lastId) ? Number(lastId) : 0;
      const abort = new AbortController();
      const onClientAbort = () => abort.abort();
      req.signal.addEventListener("abort", onClientAbort, { once: true });
      const encoder = new TextEncoder();
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode("retry: 2000\n\n"));
          heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              abort.abort();
            }
          }, 15_000);
          try {
            for await (const frame of svc.sse(id, { afterSeq, signal: abort.signal })) {
              controller.enqueue(encoder.encode(frame));
            }
          } catch (err) {
            if (!abort.signal.aborted) controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : String(err) })}\n\n`));
          } finally {
            if (heartbeat) clearInterval(heartbeat);
            req.signal.removeEventListener("abort", onClientAbort);
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        },
        cancel() {
          abort.abort();
          if (heartbeat) clearInterval(heartbeat);
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    },

    /** POST /api/launch/[id]/approve  { approvalId, decision, draft? } */
    async approve(req: Request, { id }: Params): Promise<Response> {
      try {
        const svc = await getService();
        const body = await readJson(req);
        const approvalId = requireString(body, "approvalId");
        const decision = requireString(body, "decision") as ApprovalDecision;
        const draft = body["draft"] && typeof body["draft"] === "object" ? (body["draft"] as Record<string, unknown>) : undefined;
        return json(svc.approve(id, approvalId, decision, draft));
      } catch (err) {
        return errorResponse(err);
      }
    },

    /** POST /api/launch/[id]/pick  { worker, candidateId } */
    async pick(req: Request, { id }: Params): Promise<Response> {
      try {
        const svc = await getService();
        const body = await readJson(req);
        const worker = requireString(body, "worker") as WorkerName;
        const candidateId = requireString(body, "candidateId");
        const event = svc.pick(id, worker, candidateId);
        return json({ event });
      } catch (err) {
        return errorResponse(err);
      }
    },

    /** POST /api/launch/[id]/autopilot  { posts?, trades?, recruiting? } */
    async autopilot(req: Request, { id }: Params): Promise<Response> {
      try {
        const svc = await getService();
        const body = await readJson(req);
        const autopilot = svc.setAutopilot(id, body as Partial<{ posts: boolean; trades: boolean; recruiting: boolean }>);
        return json({ autopilot });
      } catch (err) {
        return errorResponse(err);
      }
    },

    /** GET /api/me */
    async me(req: Request): Promise<Response> {
      try {
        const svc = await getService();
        return json(await svc.me(session(req)));
      } catch (err) {
        return errorResponse(err);
      }
    },

    /** GET /api/status */
    async status(): Promise<Response> {
      try {
        const svc = await getService();
        return json(await svc.status());
      } catch (err) {
        return errorResponse(err);
      }
    },

    /** GET /api/x/oauth/start → 302 to X; POST → { url }. Both set the state cookie. */
    async oauthStart(req: Request): Promise<Response> {
      try {
        const svc = await getService();
        const x = svc.sharedClients.x;
        if (!x.ok) return json({ error: x.error }, { status: 501 });
        const { url, state } = x.value.oauth.start();
        const setCookie = oauthStateSetCookie(state, getEnv());
        if (req.method === "POST") return json({ url, state }, { headers: { "set-cookie": setCookie } });
        return new Response(null, { status: 302, headers: { location: url, "set-cookie": setCookie, "cache-control": "no-store" } });
      } catch (err) {
        return errorResponse(err);
      }
    },

    /** GET /api/x/oauth/callback?code&state (or POST { code, state }) → session cookie, redirect to /. */
    async oauthCallback(req: Request): Promise<Response> {
      const e = getEnv();
      const url = new URL(req.url);
      const back = (query: Record<string, string>, headers: HeadersInit = {}): Response => {
        const q = new URLSearchParams(query).toString();
        if (req.method === "POST") return json(query, { headers });
        const h = new Headers(headers);
        h.set("location", `/${q ? `?${q}` : ""}`);
        h.set("cache-control", "no-store");
        return new Response(null, { status: 302, headers: h });
      };
      try {
        let code = url.searchParams.get("code") ?? "";
        let state = url.searchParams.get("state") ?? "";
        const denied = url.searchParams.get("error");
        if (req.method === "POST") {
          const body = await readJson(req);
          code = typeof body["code"] === "string" ? body["code"] : code;
          state = typeof body["state"] === "string" ? body["state"] : state;
        }
        if (denied) return back({ x_error: `X returned "${denied}"${url.searchParams.get("error_description") ? `: ${url.searchParams.get("error_description")}` : ""}` });
        if (!code || !state) return back({ x_error: "callback is missing code or state" });
        const expected = parseCookies(req.headers.get("cookie"))[OAUTH_STATE_COOKIE];
        if (!expected || expected !== state) return back({ x_error: "OAuth state does not match this browser's pending authorization; start again" });
        const svc = await getService();
        const x = svc.sharedClients.x;
        if (!x.ok) return back({ x_error: x.error.message });
        const tokens = await x.value.oauth.complete({ code, state });
        const headers = new Headers();
        headers.append("set-cookie", sessionSetCookie(tokens.accountId, e));
        headers.append("set-cookie", oauthStateClearCookie(e));
        return back({ connected: "x" }, headers);
      } catch (err) {
        return back({ x_error: err instanceof Error ? err.message : String(err) });
      }
    },

    /** POST /api/x/disconnect — forgets the session (and the stored tokens when ?forget=1). */
    async xDisconnect(req: Request): Promise<Response> {
      const e = getEnv();
      try {
        const accountId = session(req);
        const url = new URL(req.url);
        if (accountId && url.searchParams.get("forget") === "1") {
          const svc = await getService();
          if (svc.sharedClients.x.ok) await svc.sharedClients.x.value.oauth.disconnect(accountId);
        }
        return json({ ok: true }, { headers: { "set-cookie": sessionClearCookie(e) } });
      } catch (err) {
        return errorResponse(err);
      }
    },

    /** POST /api/helius/webhook — mounted to the solana webhookHandler. */
    async heliusWebhook(req: Request): Promise<Response> {
      const svc = await getService();
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const res = svc.webhook({ headers, body: await req.text() });
      return new Response(res.body, { status: res.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    },
  };
}

export type Handlers = ReturnType<typeof makeHandlers>;
