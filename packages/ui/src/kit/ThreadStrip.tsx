/**
 * ThreadStrip: eight tappable chips, one per worker, with live WorkerStatus
 * from Launch.workers. Colours from WORKER_COLORS. 44px hit area each.
 */
import { WORKER_NAMES, type Launch, type WorkerName, type WorkerStatus } from "@quantagent/core/types";
import { colors } from "../tokens";
import { cx, workerColor } from "./primitives";

export interface ThreadStripProps {
  /** `launch.workers`; omit before a launch exists. */
  workers?: Launch["workers"] | undefined;
  selected?: WorkerName | null;
  onSelect?: (worker: WorkerName) => void;
}

export const STATUS_LABEL: Record<WorkerStatus | "idle", string> = {
  idle: "idle",
  pending: "pending",
  running: "running",
  candidates: "candidates",
  awaitingApproval: "needs you",
  done: "done",
  failed: "failed",
};

export function ThreadStrip({ workers, selected = null, onSelect }: ThreadStripProps) {
  return (
    <div
      role="tablist"
      aria-label="Workers"
      data-testid="thread-strip"
      className="flex gap-2 overflow-x-auto py-1 font-mono [scrollbar-width:none]"
    >
      {WORKER_NAMES.map((name) => {
        const state = workers?.[name];
        const status: WorkerStatus | "idle" = state?.status ?? "idle";
        const live = status !== "idle";
        const failed = status === "failed";
        const colour = failed ? colors.failed : workerColor(name);
        const isSelected = selected === name;
        return (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-label={`${name}: ${STATUS_LABEL[status]}`}
            data-worker={name}
            data-status={status}
            disabled={!onSelect}
            onClick={() => onSelect?.(name)}
            className={cx(
              "flex min-h-hit min-w-hit shrink-0 flex-col items-start justify-center rounded-lg border px-3 py-1 text-left transition-colors duration-quant ease-quant",
              isSelected ? "border-tunnel bg-border" : "border-border bg-panel",
              !live && "opacity-60",
            )}
            style={{ boxShadow: live && !failed ? `inset 0 -2px 0 0 ${colour}` : undefined }}
          >
            <span className="flex items-center gap-1.5 text-xs text-tunnel">
              <span
                aria-hidden
                className={cx("inline-block h-2 w-2 rounded-full", status === "running" && "animate-pulse")}
                style={{ backgroundColor: colour }}
              />
              {name}
            </span>
            <span
              className={cx(
                "text-[10px] leading-tight",
                failed ? "text-worker-shield" : status === "awaitingApproval" ? "text-decay" : status === "done" ? "text-tunnel" : "text-muted",
              )}
            >
              {STATUS_LABEL[status]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
