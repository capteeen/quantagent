/**
 * Typed fetch wrappers over the app's own API. Every failure becomes an ApiError
 * carrying the server's exact message and `needs` so screens show it verbatim.
 */
import type { ApprovalDecision, Autopilot, QuantagentEvent, WorkerName } from "@quantagent/core/types";
import type { ClientHealth, LaunchDetail, MeReport, StatusReport, Unavailable } from "@/server/types";

export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    public readonly status: number,
    public readonly detail: Unavailable,
  ) {
    super(detail.message);
  }
  get needs(): string[] {
    return this.detail.needs;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }, credentials: "same-origin" });
  } catch (err) {
    throw new ApiError(0, { ok: false, name: "NetworkError", message: `${path}: ${err instanceof Error ? err.message : String(err)}`, needs: [] });
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const detail = (body as { error?: Unavailable } | null)?.error;
    throw new ApiError(res.status, detail ?? { ok: false, name: "HttpError", message: `${path}: HTTP ${res.status}${text ? ` ${text.slice(0, 300)}` : ""}`, needs: [] });
  }
  return body as T;
}

export type LaunchDetailWithEvents = LaunchDetail & { events: QuantagentEvent[] };

export const api = {
  createLaunch: (input: { prompt: string; ownerWallet: string; autopilot?: Partial<Autopilot>; devBuySol?: number }) =>
    request<{ id: string; clients: ClientHealth }>("/api/launch", { method: "POST", body: JSON.stringify(input) }),
  getLaunch: (id: string) => request<LaunchDetailWithEvents>(`/api/launch/${encodeURIComponent(id)}`),
  approve: (id: string, approvalId: string, decision: ApprovalDecision, draft?: Record<string, unknown>) =>
    request<{ resolved: boolean }>(`/api/launch/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ approvalId, decision, draft }) }),
  pick: (id: string, worker: WorkerName, candidateId: string) =>
    request<{ event: QuantagentEvent }>(`/api/launch/${encodeURIComponent(id)}/pick`, { method: "POST", body: JSON.stringify({ worker, candidateId }) }),
  setAutopilot: (id: string, patch: Partial<Autopilot>) =>
    request<{ autopilot: Autopilot }>(`/api/launch/${encodeURIComponent(id)}/autopilot`, { method: "POST", body: JSON.stringify(patch) }),
  me: () => request<MeReport>("/api/me"),
  status: () => request<StatusReport>("/api/status"),
  disconnectX: (forget = false) => request<{ ok: true }>(`/api/x/disconnect${forget ? "?forget=1" : ""}`, { method: "POST" }),
};

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.needs.length ? `${err.message}` : err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function errorNeeds(err: unknown): string[] {
  return err instanceof ApiError ? err.needs : [];
}
