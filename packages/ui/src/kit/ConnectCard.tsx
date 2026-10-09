/**
 * ConnectCard: one of the two onboarding connections (X account, wallet).
 * States: disconnected / connecting / connected (collapses to a chip) / failed.
 */
import { buttonBase, buttonTone, cx, FailBanner, Heading, Label, Panel, shortKey } from "./primitives";

export type ConnectKind = "x" | "wallet";

export type ConnectCardProps =
  | { kind: ConnectKind; state: "disconnected"; onConnect: () => void }
  | { kind: ConnectKind; state: "connecting"; onCancel?: () => void }
  | {
      kind: ConnectKind;
      state: "connected";
      /** X handle (without @) or wallet public key (base58). */
      id: string;
      onDisconnect?: () => void;
    }
  | { kind: ConnectKind; state: "failed"; error: string; onRetry: () => void };

const COPY: Record<ConnectKind, { title: string; what: string; action: string }> = {
  x: { title: "X account", what: "the project's own account, OAuth, one tap", action: "Connect X" },
  wallet: { title: "Wallet", what: "mobile wallet adapter first", action: "Connect wallet" },
};

export function ConnectCard(props: ConnectCardProps) {
  const copy = COPY[props.kind];
  const testId = `connect-${props.kind}`;

  if (props.state === "connected") {
    const label = props.kind === "x" ? `@${props.id.replace(/^@/, "")}` : shortKey(props.id);
    return (
      <div
        data-testid={testId}
        data-state="connected"
        className="inline-flex min-h-hit items-center gap-2 rounded-full border border-border bg-panel pl-3 pr-1 font-mono text-sm text-text"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-worker-trader" aria-hidden />
        <span className="text-muted">{copy.title}</span>
        <span className="text-tunnel" title={props.id}>
          {label}
        </span>
        {props.onDisconnect ? (
          <button
            type="button"
            onClick={props.onDisconnect}
            aria-label={`Disconnect ${copy.title}`}
            className="ml-1 inline-flex min-h-hit min-w-hit items-center justify-center rounded-full text-muted active:text-text"
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <Panel data-testid={testId} data-state={props.state} tone={props.state === "failed" ? "failed" : "panel"} className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Heading>{copy.title}</Heading>
          <Label className="mt-1 normal-case tracking-normal">{copy.what}</Label>
        </div>
      </div>

      {props.state === "disconnected" ? (
        <button type="button" onClick={props.onConnect} className={cx(buttonBase, buttonTone.primary, "w-full")}>
          {copy.action}
        </button>
      ) : null}

      {props.state === "connecting" ? (
        <div className="flex items-center gap-3">
          <button type="button" disabled aria-busy="true" className={cx(buttonBase, buttonTone.ghost, "flex-1")}>
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-probability" aria-hidden />
            Connecting…
          </button>
          {props.onCancel ? (
            <button type="button" onClick={props.onCancel} className={cx(buttonBase, buttonTone.ghost)}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {props.state === "failed" ? (
        <>
          <FailBanner>{props.error}</FailBanner>
          <button type="button" onClick={props.onRetry} className={cx(buttonBase, buttonTone.ghost, "w-full")}>
            Try again
          </button>
        </>
      ) : null}
    </Panel>
  );
}
