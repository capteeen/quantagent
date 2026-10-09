/**
 * Client-side launch state: the event log of every launch this tab watches and
 * its reduction (core's pure reducer, so UI state is exactly rebuild(log)).
 */
import { create } from "zustand";
import { emptyLaunch, reduce } from "@quantagent/core-state";
import type { ApprovalDecision, ApprovalRequest, Launch, QuantagentEvent, WorkerName } from "@quantagent/core/types";
import type { SseState } from "./sse";
import type { LaunchMeta } from "@/server/types";

export interface LaunchEntry {
  id: string;
  events: QuantagentEvent[];
  state: Launch;
  lastSeq: number;
  connection: SseState | "idle";
  connectionError: string | null;
  meta: LaunchMeta | null;
}

export interface LaunchStore {
  launches: Record<string, LaunchEntry>;
  ensure(id: string): LaunchEntry;
  ingest(id: string, events: readonly QuantagentEvent[]): void;
  setConnection(id: string, connection: SseState | "idle", error?: string | null): void;
  setMeta(id: string, meta: LaunchMeta): void;
  reset(id: string): void;
}

export function newEntry(id: string): LaunchEntry {
  return { id, events: [], state: emptyLaunch(id), lastSeq: 0, connection: "idle", connectionError: null, meta: null };
}

export const useLaunchStore = create<LaunchStore>((set, get) => ({
  launches: {},
  ensure(id) {
    const existing = get().launches[id];
    if (existing) return existing;
    const entry = newEntry(id);
    set((s) => ({ launches: { ...s.launches, [id]: entry } }));
    return entry;
  },
  ingest(id, incoming) {
    set((s) => {
      const prev = s.launches[id] ?? newEntry(id);
      const fresh = incoming.filter((e) => e.launchId === id && e.seq > prev.lastSeq).sort((a, b) => a.seq - b.seq);
      if (fresh.length === 0) return s;
      let state = prev.state;
      for (const e of fresh) state = reduce(state, e);
      const last = fresh[fresh.length - 1]!;
      return { launches: { ...s.launches, [id]: { ...prev, events: [...prev.events, ...fresh], state, lastSeq: last.seq } } };
    });
  },
  setConnection(id, connection, error = null) {
    set((s) => {
      const prev = s.launches[id] ?? newEntry(id);
      return { launches: { ...s.launches, [id]: { ...prev, connection, connectionError: error } } };
    });
  },
  setMeta(id, meta) {
    set((s) => {
      const prev = s.launches[id] ?? newEntry(id);
      return { launches: { ...s.launches, [id]: { ...prev, meta } } };
    });
  },
  reset(id) {
    set((s) => ({ launches: { ...s.launches, [id]: newEntry(id) } }));
  },
}));

/* ───────────────────────── derived views (pure) ───────────────────────── */

export interface ApprovalView {
  approval: ApprovalRequest;
  resolved?: ApprovalDecision;
}

/** Approvals in log order; `resolved` is set once Worker.approvalResolved names them. */
export function approvalsOf(events: readonly QuantagentEvent[]): ApprovalView[] {
  const byId = new Map<string, ApprovalView>();
  for (const e of events) {
    if (e.type === "Worker.awaitingApproval") byId.set(e.payload.approval.id, { approval: e.payload.approval });
    else if (e.type === "Worker.approvalResolved") {
      const v = byId.get(e.payload.approvalId);
      if (v) v.resolved = e.payload.decision;
    }
  }
  return [...byId.values()];
}

export function pendingApprovalsOf(events: readonly QuantagentEvent[]): ApprovalRequest[] {
  return approvalsOf(events)
    .filter((v) => !v.resolved)
    .map((v) => v.approval);
}

/** The reason the QRNG was unreachable for a worker whose pick is still open. */
export function collapseUnavailableReason(events: readonly QuantagentEvent[], worker: WorkerName): string | undefined {
  let reason: string | undefined;
  for (const e of events) {
    if (e.type === "Orchestrator.collapseUnavailable" && e.payload.worker === worker) reason = e.payload.reason;
    else if ((e.type === "Orchestrator.userPicked" || e.type === "Orchestrator.collapsed") && e.payload.worker === worker) reason = undefined;
  }
  return reason;
}

export function lastEventOf<T extends QuantagentEvent["type"]>(events: readonly QuantagentEvent[], type: T): Extract<QuantagentEvent, { type: T }> | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === type) return e as Extract<QuantagentEvent, { type: T }>;
  }
  return undefined;
}

export function eventsOfType<T extends QuantagentEvent["type"]>(events: readonly QuantagentEvent[], ...types: T[]): Extract<QuantagentEvent, { type: T }>[] {
  const set = new Set<string>(types);
  return events.filter((e) => set.has(e.type)) as Extract<QuantagentEvent, { type: T }>[];
}
