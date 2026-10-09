/**
 * ApprovalCard: the human gate. approve / edit / skip as buttons, and as
 * gestures: swipe right = approve, swipe left = skip, tap = edit.
 * States: pending / editing / submitting / failed / resolved.
 */
import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ApprovalDecision, ApprovalRequest } from "@quantagent/core/types";
import { colors } from "../tokens";
import { buttonBase, buttonTone, cx, FailBanner, fmtTime, Heading, Label, Panel, workerColor } from "./primitives";

export const SWIPE_THRESHOLD_PX = 80;
const TAP_SLOP_PX = 8;

export interface ApprovalCardProps {
  approval: ApprovalRequest;
  /** Called once with the decision; `draft` is set only for "edit". */
  onDecide: (decision: ApprovalDecision, draft?: Record<string, unknown>) => void;
  /** The decision was sent and the app is waiting for the bus to confirm. */
  submitting?: boolean;
  /** The decision could not be submitted. */
  error?: string | undefined;
  /** Already resolved (from Worker.approvalResolved); renders read-only. */
  resolved?: ApprovalDecision | undefined;
}

const CLASS_LABEL: Record<ApprovalRequest["actionClass"], string> = {
  posts: "post",
  trades: "trade",
  recruiting: "outreach",
};

const DECISION_LABEL: Record<ApprovalDecision, string> = {
  approve: "approved",
  edit: "edited and approved",
  skip: "skipped",
};

function draftLines(draft: Record<string, unknown>): Array<{ key: string; text: string; editable: boolean }> {
  return Object.entries(draft).map(([key, v]) => ({
    key,
    text: typeof v === "string" ? v : JSON.stringify(v),
    editable: typeof v === "string",
  }));
}

export function ApprovalCard({ approval, onDecide, submitting = false, error, resolved }: ApprovalCardProps) {
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const titleId = useId();
  const locked = submitting || Boolean(resolved);
  const colour = workerColor(approval.worker);

  const decide = (d: ApprovalDecision) => {
    if (locked) return;
    if (d === "edit") {
      const next: Record<string, unknown> = { ...approval.draft };
      for (const [k, v] of Object.entries(edited)) next[k] = v;
      onDecide("edit", next);
    } else {
      onDecide(d);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (locked || editing) return;
    if ((e.target as HTMLElement).closest("button, textarea, input, a")) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    setDx(e.clientX - start.current.x);
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const moved = e.clientX - start.current.x;
    const movedY = Math.abs(e.clientY - start.current.y);
    start.current = null;
    setDx(0);
    if (e.type === "pointercancel") return;
    if (moved >= SWIPE_THRESHOLD_PX && movedY < SWIPE_THRESHOLD_PX) decide("approve");
    else if (moved <= -SWIPE_THRESHOLD_PX && movedY < SWIPE_THRESHOLD_PX) decide("skip");
    else if (Math.abs(moved) < TAP_SLOP_PX && movedY < TAP_SLOP_PX) setEditing(true);
  };

  const hint = dx >= SWIPE_THRESHOLD_PX ? "approve" : dx <= -SWIPE_THRESHOLD_PX ? "skip" : null;
  const lines = draftLines(approval.draft);

  return (
    <Panel
      data-testid="approval-card"
      data-approval-id={approval.id}
      data-state={resolved ? "resolved" : submitting ? "submitting" : error ? "failed" : editing ? "editing" : "pending"}
      role="group"
      aria-labelledby={titleId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      className={cx("relative select-none touch-pan-y", !locked && !editing && "cursor-grab")}
      style={{
        transform: dx ? `translateX(${dx}px)` : undefined,
        transition: dx ? "none" : "transform 700ms cubic-bezier(0.4,0,0.2,1)",
        borderColor: hint === "approve" ? colors.probability : hint === "skip" ? colors.failed : undefined,
      }}
    >
      {hint ? (
        <div
          data-testid="swipe-hint"
          className={cx("absolute inset-y-0 flex items-center px-3 text-xs", hint === "approve" ? "left-0 text-probability" : "right-0 text-muted")}
          aria-hidden
        >
          {hint}
        </div>
      ) : null}

      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colour }} />
        <div className="min-w-0 flex-1">
          <Label>
            {approval.worker} · {CLASS_LABEL[approval.actionClass]} · {fmtTime(approval.createdAt)}
          </Label>
          <Heading className="mt-1" as="h3">
            <span id={titleId}>{approval.title}</span>
          </Heading>
          <div className="mt-1 text-xs text-muted">{approval.reason}</div>
        </div>
      </div>

      <div data-testid="approval-draft" className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-void px-3 py-2 text-xs">
        {lines.length === 0 ? (
          <div className="text-muted">Empty draft.</div>
        ) : (
          lines.map((l) =>
            editing && l.editable ? (
              <label key={l.key} className="flex flex-col gap-1">
                <span className="text-muted">{l.key}</span>
                <textarea
                  value={edited[l.key] ?? l.text}
                  onChange={(e) => setEdited((prev) => ({ ...prev, [l.key]: e.target.value }))}
                  rows={Math.min(8, Math.max(2, Math.ceil((edited[l.key] ?? l.text).length / 40)))}
                  className="min-h-hit w-full rounded border border-border bg-panel px-2 py-1 font-mono text-sm text-text outline-none focus:border-probability"
                />
              </label>
            ) : (
              <div key={l.key} className="grid grid-cols-[auto_1fr] gap-x-2">
                <span className="text-muted">{l.key}</span>
                <span className="whitespace-pre-wrap break-words text-text">{edited[l.key] ?? l.text}</span>
              </div>
            ),
          )
        )}
      </div>

      {error ? <FailBanner className="mt-2">{error}</FailBanner> : null}

      {resolved ? (
        <div data-testid="approval-resolved" className="mt-3 text-xs text-muted">
          {DECISION_LABEL[resolved]}
        </div>
      ) : editing ? (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={locked} onClick={() => decide("edit")} className={cx(buttonBase, buttonTone.primary, "flex-1")}>
            Approve edit
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              setEditing(false);
              setEdited({});
            }}
            className={cx(buttonBase, buttonTone.ghost)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={locked} aria-busy={submitting || undefined} onClick={() => decide("approve")} className={cx(buttonBase, buttonTone.primary, "flex-1")}>
            {submitting ? "Sending…" : "Approve"}
          </button>
          <button type="button" disabled={locked} onClick={() => setEditing(true)} className={cx(buttonBase, buttonTone.ghost)}>
            Edit
          </button>
          <button type="button" disabled={locked} onClick={() => decide("skip")} className={cx(buttonBase, buttonTone.ghost, "text-muted")}>
            Skip
          </button>
        </div>
      )}
      <div className="sr-only">Swipe right to approve, left to skip, tap to edit.</div>
    </Panel>
  );
}
