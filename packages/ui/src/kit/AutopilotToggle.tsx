/**
 * AutopilotToggle: per-coin, per-action-class opt-in. Enabling asks for a
 * confirming tap and says exactly what the agent may then do without one.
 * Disabling is immediate. Honest pending / failed states per class.
 */
import { useState } from "react";
import type { ActionClass, Autopilot } from "@quantagent/core/types";
import { buttonBase, buttonTone, cx, FailBanner, Heading, Label, Panel } from "./primitives";

export const ACTION_CLASSES: readonly ActionClass[] = ["posts", "trades", "recruiting"];

export const AUTOPILOT_COPY: Record<ActionClass, { title: string; allows: string; confirm: string }> = {
  posts: {
    title: "Posts",
    allows: "The Voice posts from your X account without a tap.",
    confirm: "Every post still logs its reason. Nothing is deleted for you.",
  },
  trades: {
    title: "Trades",
    allows: "The Trader buys and sells from the agent wallet within its SOL budget without a tap.",
    confirm: "The budget is enforced in code; it cannot exceed it.",
  },
  recruiting: {
    title: "Recruiting",
    allows: "The Recruiter replies to accounts from your X account without a tap.",
    confirm: "Outreach stays under the per-window cap.",
  },
};

export interface AutopilotToggleProps {
  autopilot: Autopilot;
  onChange: (actionClass: ActionClass, enabled: boolean) => void;
  /** Classes whose change is in flight. */
  pending?: Partial<Record<ActionClass, boolean>> | undefined;
  /** Classes whose last change failed, with the reason. */
  errors?: Partial<Record<ActionClass, string>> | undefined;
  /** Only render some classes (the coin page shows all three). */
  classes?: readonly ActionClass[];
  disabled?: boolean;
}

export function AutopilotToggle({ autopilot, onChange, pending, errors, classes = ACTION_CLASSES, disabled = false }: AutopilotToggleProps) {
  const [confirming, setConfirming] = useState<ActionClass | null>(null);

  return (
    <Panel data-testid="autopilot-toggle" className="flex flex-col gap-3">
      <div>
        <Heading as="h2">Autopilot</Heading>
        <div className="mt-1 text-xs text-muted">Off by default. Each class is a separate opt-in for this coin only.</div>
      </div>
      <ul className="divide-y divide-border">
        {classes.map((cls) => {
          const on = autopilot[cls];
          const busy = Boolean(pending?.[cls]);
          const err = errors?.[cls];
          const copy = AUTOPILOT_COPY[cls];
          const isConfirming = confirming === cls;
          return (
            <li key={cls} data-testid={`autopilot-${cls}`} data-enabled={on} data-pending={busy || undefined} className="flex flex-col gap-2 py-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Label className="normal-case tracking-normal text-tunnel">{copy.title}</Label>
                  <div className="text-xs text-muted">{copy.allows}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${copy.title} autopilot`}
                  aria-busy={busy || undefined}
                  disabled={disabled || busy}
                  onClick={() => {
                    if (on) {
                      setConfirming(null);
                      onChange(cls, false);
                    } else {
                      setConfirming(isConfirming ? null : cls);
                    }
                  }}
                  className={cx(
                    "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-quant ease-quant disabled:opacity-50",
                    on ? "border-decay bg-decay" : "border-border bg-void",
                  )}
                  style={{ minHeight: 44, minWidth: 48, paddingBlock: 8 }}
                >
                  <span
                    aria-hidden
                    className={cx(
                      "absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-transform duration-quant ease-quant",
                      on ? "translate-x-6 bg-void" : "translate-x-1 bg-muted",
                    )}
                  />
                </button>
              </div>

              {isConfirming && !on ? (
                <div data-testid={`autopilot-confirm-${cls}`} role="alertdialog" aria-label={`Enable ${copy.title} autopilot?`} className="flex flex-col gap-2 rounded-lg border border-decay/60 bg-void px-3 py-2 text-xs">
                  <div className="text-decay">Enable {copy.title.toLowerCase()} autopilot for this coin?</div>
                  <div className="text-text">{copy.allows}</div>
                  <div className="text-muted">{copy.confirm}</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(null);
                        onChange(cls, true);
                      }}
                      className={cx(buttonBase, buttonTone.amber, "flex-1")}
                    >
                      Enable
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className={cx(buttonBase, buttonTone.ghost)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {busy ? <div className="text-[11px] text-muted">saving…</div> : null}
              {err ? <FailBanner>{err}</FailBanner> : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
