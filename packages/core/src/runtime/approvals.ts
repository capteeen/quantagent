import { nanoid } from "nanoid";
import {
  ApprovalDenied,
  type ActionClass,
  type ApprovalDecision,
  type ApprovalRequest,
  type Autopilot,
  type WorkerName,
} from "../../types/index";
import type { EventBus } from "../bus/bus";
import type { ApprovalOutcome, PendingApproval } from "./worker";

export interface ApprovalGateOptions {
  bus: EventBus;
  /** Autopilot flags for a launch; read at request time so toggles apply immediately. */
  getAutopilot(launchId: string): Autopilot;
  now?: () => Date;
}

/**
 * The human gate. A worker's requireApproval resolves instantly when autopilot is
 * on for the action class; otherwise it blocks until resolve() is called with the
 * user's decision. Every request and decision is an event on the bus.
 */
export class ApprovalGate {
  private readonly pendingById = new Map<string, PendingApproval>();
  private readonly bus: EventBus;
  private readonly getAutopilot: (launchId: string) => Autopilot;
  private readonly now: () => Date;

  constructor(opts: ApprovalGateOptions) {
    this.bus = opts.bus;
    this.getAutopilot = opts.getAutopilot;
    this.now = opts.now ?? (() => new Date());
  }

  isAutopilot(launchId: string, actionClass: ActionClass): boolean {
    return this.getAutopilot(launchId)[actionClass] === true;
  }

  request(
    input: { launchId: string; worker: WorkerName; actionClass: ActionClass; title: string; draft: Record<string, unknown>; reason: string },
    signal?: AbortSignal,
  ): Promise<ApprovalOutcome> {
    const request: ApprovalRequest = {
      id: nanoid(10),
      launchId: input.launchId,
      worker: input.worker,
      actionClass: input.actionClass,
      title: input.title,
      draft: input.draft,
      reason: input.reason,
      createdAt: this.now().toISOString(),
    };

    if (this.isAutopilot(input.launchId, input.actionClass)) {
      this.bus.emit(input.launchId, {
        type: "Worker.approvalResolved",
        worker: input.worker,
        reason: `autopilot.${input.actionClass} is on: ${input.title}`,
        payload: { approvalId: request.id, decision: "approve" },
      });
      return Promise.resolve({
        approvalId: request.id,
        actionClass: request.actionClass,
        decision: "approve",
        draft: request.draft,
        via: "autopilot",
      });
    }

    return new Promise<ApprovalOutcome>((resolve, reject) => {
      const onAbort = () => {
        if (!this.pendingById.delete(request.id)) return;
        reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted while awaiting approval"));
      };
      const pending: PendingApproval = {
        request,
        resolve: (outcome) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(outcome);
        },
        reject: (err) => {
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        },
      };
      this.pendingById.set(request.id, pending);
      this.bus.emit(input.launchId, {
        type: "Worker.awaitingApproval",
        worker: input.worker,
        reason: input.reason,
        payload: { approval: request },
      });
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /**
   * The user's decision. Returns false when the id is unknown (already resolved).
   * "edit" requires the edited draft; "skip" rejects the worker's await with ApprovalDenied.
   */
  resolve(approvalId: string, decision: ApprovalDecision, editedDraft?: Record<string, unknown>): boolean {
    const pending = this.pendingById.get(approvalId);
    if (!pending) return false;
    if (decision === "edit" && !editedDraft) throw new Error(`approval ${approvalId}: "edit" requires editedDraft`);
    this.pendingById.delete(approvalId);
    const { request } = pending;
    this.bus.emit(request.launchId, {
      type: "Worker.approvalResolved",
      worker: request.worker,
      reason: `user tapped ${decision}: ${request.title}`,
      payload: { approvalId, decision },
    });
    if (decision === "skip") {
      pending.reject(new ApprovalDenied(approvalId));
    } else {
      pending.resolve({
        approvalId,
        actionClass: request.actionClass,
        decision,
        draft: decision === "edit" ? editedDraft! : request.draft,
        via: "tap",
      });
    }
    return true;
  }

  pending(launchId?: string): ApprovalRequest[] {
    const all = [...this.pendingById.values()].map((p) => p.request);
    return launchId ? all.filter((r) => r.launchId === launchId) : all;
  }

  get(approvalId: string): ApprovalRequest | undefined {
    return this.pendingById.get(approvalId)?.request;
  }

  /** Rejects every pending approval of a launch (used on stop). */
  cancelAll(launchId: string, reason = "launch stopped"): void {
    for (const [id, p] of [...this.pendingById]) {
      if (p.request.launchId !== launchId) continue;
      this.pendingById.delete(id);
      p.reject(new Error(reason));
    }
  }
}
