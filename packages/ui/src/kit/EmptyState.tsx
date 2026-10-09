/**
 * EmptyState: honest text, no illustration. Says what is missing and, when
 * known, why. Optional single action.
 */
import { buttonBase, buttonTone, cx } from "./primitives";

export interface EmptyStateProps {
  /** What is absent, e.g. "No launches yet." */
  title: string;
  /** Why, or what would fill it. */
  detail?: string;
  action?: { label: string; onClick: () => void };
  /** Renders as a failure (red edge) instead of a quiet gap. */
  failed?: boolean;
  className?: string;
}

export function EmptyState({ title, detail, action, failed = false, className }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      data-failed={failed || undefined}
      role={failed ? "alert" : undefined}
      className={cx(
        "flex flex-col items-start gap-2 rounded-xl border border-dashed px-4 py-4 font-mono text-sm",
        failed ? "border-worker-shield/60 text-worker-shield" : "border-border text-muted",
        className,
      )}
    >
      <div className={failed ? "text-worker-shield" : "text-text"}>{title}</div>
      {detail ? <div className="text-xs">{detail}</div> : null}
      {action ? (
        <button type="button" onClick={action.onClick} className={cx(buttonBase, buttonTone.ghost, "mt-1")}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
