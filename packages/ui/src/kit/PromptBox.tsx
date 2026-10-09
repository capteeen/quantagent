/**
 * PromptBox: the one line. Placeholder "a coin about…", a "surprise me" chip
 * that clears the line and tells the app to set its surprise flag.
 * Single line, phone-keyboard friendly (enterKeyHint, no autocorrect noise).
 */
import { useId, type KeyboardEvent } from "react";
import { cx } from "./primitives";

export interface PromptBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when the chip is tapped; the app sets its own surprise flag. */
  onSurprise: () => void;
  /** Whether the app's surprise flag is set; renders the chip pressed. */
  surprise?: boolean;
  /** Enter on the phone keyboard. */
  onSubmit?: () => void;
  disabled?: boolean;
  /** Shown under the line, e.g. a validation message. */
  error?: string;
  maxLength?: number;
}

export const PROMPT_PLACEHOLDER = "a coin about…";

export function PromptBox({ value, onChange, onSurprise, surprise = false, onSubmit, disabled = false, error, maxLength = 200 }: PromptBoxProps) {
  const id = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };
  return (
    <div data-testid="prompt-box" className="flex flex-col gap-2 font-mono">
      <label htmlFor={id} className="sr-only">
        What is the coin about
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          value={value}
          placeholder={PROMPT_PLACEHOLDER}
          disabled={disabled}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="go"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cx(
            "min-h-hit min-w-0 flex-1 rounded-lg border bg-panel px-3 text-base text-text placeholder:text-muted outline-none transition-colors duration-quant ease-quant",
            error ? "border-worker-shield/70" : "border-border focus:border-probability",
            disabled && "opacity-50",
          )}
        />
        <button
          type="button"
          onClick={() => {
            onChange("");
            onSurprise();
          }}
          disabled={disabled}
          aria-pressed={surprise}
          className={cx(
            "inline-flex min-h-hit shrink-0 items-center rounded-full border px-3 text-xs transition-colors duration-quant ease-quant disabled:opacity-50",
            surprise ? "border-collapse bg-collapse text-tunnel" : "border-border bg-panel text-text active:bg-border",
          )}
        >
          surprise me
        </button>
      </div>
      {error ? (
        <div id={`${id}-error`} role="alert" className="text-xs text-worker-shield">
          {error}
        </div>
      ) : null}
    </div>
  );
}
