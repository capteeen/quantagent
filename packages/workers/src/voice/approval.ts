/**
 * The human gate as the Voice uses it: every post goes through
 * ctx.requireApproval({ actionClass: "posts" }) exactly once, right before the
 * gated x.post / x.thread call that consumes the grant. "edit" hands back the
 * user's draft; "skip" (ApprovalDenied) is a normal outcome, never a failure.
 */

import { ApprovalDenied } from "@quantagent/core/types";
import type { ApprovalInput, ApprovalOutcome, WorkerContext } from "../context";

export type GateResult =
  | { skipped: false; outcome: ApprovalOutcome }
  | { skipped: true; approvalId: string };

export async function askApproval(ctx: WorkerContext, input: ApprovalInput): Promise<GateResult> {
  try {
    const outcome = await ctx.requireApproval(input);
    return { skipped: false, outcome };
  } catch (err) {
    if (err instanceof ApprovalDenied) return { skipped: true, approvalId: err.approvalId };
    throw err;
  }
}

/** The text to act on after a gate: the user's edit when it is a non-empty string, else the original. */
export function approvedText(result: Extract<GateResult, { skipped: false }>, original: string): string {
  const edited = result.outcome.draft.text;
  return typeof edited === "string" && edited.trim() ? edited.trim() : original;
}
