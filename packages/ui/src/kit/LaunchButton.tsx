/**
 * LaunchButton: the tap. idle / disabled (always with the reason) / launching.
 */
import { useId } from "react";
import { buttonBase, buttonTone, cx } from "./primitives";

export type LaunchButtonProps =
  | { state: "idle"; onLaunch: () => void; label?: string }
  | { state: "disabled"; reason: string; label?: string }
  | { state: "launching"; label?: string };

export function LaunchButton(props: LaunchButtonProps) {
  const label = props.label ?? "Launch";
  const reasonId = useId();
  return (
    <div data-testid="launch-button" data-state={props.state} className="flex flex-col gap-2 font-mono">
      <button
        type="button"
        disabled={props.state !== "idle"}
        aria-busy={props.state === "launching" ? true : undefined}
        aria-describedby={props.state === "disabled" ? reasonId : undefined}
        onClick={props.state === "idle" ? props.onLaunch : undefined}
        className={cx(
          buttonBase,
          "h-14 w-full text-base font-heading font-heading tracking-wide",
          props.state === "idle" && buttonTone.primary,
          props.state === "disabled" && "border-border bg-panel text-muted",
          props.state === "launching" && "border-probability bg-panel text-probability",
        )}
      >
        {props.state === "launching" ? (
          <>
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-probability" aria-hidden />
            Launching…
          </>
        ) : (
          label
        )}
      </button>
      {props.state === "disabled" ? (
        <div id={reasonId} className="text-center text-xs text-muted">
          {props.reason}
        </div>
      ) : null}
    </div>
  );
}
