/**
 * WorkerSheet: the bottom sheet behind a tapped strand.
 * Sections: status, event log, candidates (chosen highlighted), proof
 * viewer (drawHash + attestation), outputs, failReason.
 * Every section renders its own honest empty state.
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { Candidate, QuantagentEvent, QuantumProof, WorkerName, WorkerState } from "@quantagent/core/types";
import { colors } from "../tokens";
import { EmptyState } from "./EmptyState";
import { LogRow, workerOfEvent, type Cluster } from "./LogRow";
import { buttonBase, buttonTone, cx, FailBanner, Heading, Label, shortKey, workerColor } from "./primitives";
import { STATUS_LABEL } from "./ThreadStrip";

export interface WorkerSheetProps {
  worker: WorkerName;
  /** `launch.workers[worker]`; omit when the launch has not started. */
  state?: WorkerState | undefined;
  /** The launch log; rows belonging to other workers are filtered out. */
  events?: QuantagentEvent[];
  open: boolean;
  onClose: () => void;
  /**
   * When the QRNG was unreachable (Orchestrator.collapseUnavailable) the
   * candidates are shown and the user picks. The sheet says why.
   */
  collapseUnavailableReason?: string | undefined;
  onPick?: (candidate: Candidate) => void;
  cluster?: Cluster;
}

function candidateLabel(c: Candidate): string {
  if (c.label) return c.label;
  if (typeof c.value === "string") return c.value;
  if (c.value && typeof c.value === "object" && "name" in c.value && typeof (c.value as { name: unknown }).name === "string") {
    return (c.value as { name: string }).name;
  }
  return c.id;
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section data-testid={testId} className="flex flex-col gap-2">
      <Label>{title}</Label>
      {children}
    </section>
  );
}

export function ProofViewer({ proof }: { proof: QuantumProof }) {
  return (
    <dl data-testid="proof-viewer" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-void px-3 py-2 font-mono text-[11px]">
      <dt className="text-muted">provider</dt>
      <dd className="text-text">{proof.provider}</dd>
      <dt className="text-muted">draw</dt>
      <dd className="break-all text-probability" title={proof.drawHash}>
        {proof.drawHash}
      </dd>
      <dt className="text-muted">entropy</dt>
      <dd className="break-all text-text">{proof.entropyHex}</dd>
      <dt className="text-muted">selected</dt>
      <dd className="text-text">#{proof.selectedIndex}</dd>
      <dt className="text-muted">requested</dt>
      <dd className="text-text">{proof.requestedAt}</dd>
      <dt className="text-muted">received</dt>
      <dd className="text-text">{proof.receivedAt}</dd>
      <dt className="text-muted">attestation</dt>
      <dd>
        <details>
          <summary className="min-h-hit cursor-pointer list-none text-probability underline decoration-dotted underline-offset-2 [&::-webkit-details-marker]:hidden">
            {shortKey(proof.attestation, 10, 10)}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-text">{proof.attestation}</pre>
        </details>
      </dd>
    </dl>
  );
}

export function WorkerSheet({
  worker,
  state,
  events = [],
  open,
  onClose,
  collapseUnavailableReason,
  onPick,
  cluster = "devnet",
}: WorkerSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    sheetRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const colour = workerColor(worker);
  const status = state?.status ?? "idle";
  const failed = status === "failed";
  const rows = events.filter((e) => workerOfEvent(e) === worker || (e.type === "Orchestrator.collapsed" && (e.payload as { worker?: string }).worker === worker));
  const candidates = state?.candidates ?? [];
  const chosen = state?.chosen;
  const outputs = state?.outputs ?? {};
  const outputKeys = Object.keys(outputs);
  const userMustPick = Boolean(collapseUnavailableReason) && candidates.length > 0 && !chosen;

  return (
    <div data-testid="worker-sheet-backdrop" className="fixed inset-0 z-40 bg-void/70 animate-fade-in motion-reduce:animate-none" onClick={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${worker} worker`}
        tabIndex={-1}
        data-testid="worker-sheet"
        data-worker={worker}
        data-status={status}
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border border-b-0 border-border bg-panel font-mono text-sm text-text outline-none animate-sheet-in motion-reduce:animate-none"
        style={{ boxShadow: `0 -1px 0 0 ${failed ? colors.failed : colour}` }}
      >
        <div className="flex items-center gap-3 px-4 pb-2 pt-3">
          <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: failed ? colors.failed : colour }} />
          <Heading as="h2" className="flex-1">
            {worker}
          </Heading>
          <span
            data-testid="worker-sheet-status"
            className={cx("text-xs", failed ? "text-worker-shield" : status === "awaitingApproval" ? "text-decay" : "text-muted")}
          >
            {STATUS_LABEL[status]}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sheet"
            className="inline-flex min-h-hit min-w-hit items-center justify-center rounded-full text-muted active:text-text"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-6">
          {state?.failReason ? <FailBanner>{state.failReason}</FailBanner> : null}

          {userMustPick ? (
            <div role="status" className="rounded-lg border border-decay/60 bg-void px-3 py-2 text-xs text-decay">
              Quantum draw unavailable: {collapseUnavailableReason}. Pick one yourself; the log will say you did.
            </div>
          ) : null}

          <Section title="Candidates" testId="worker-sheet-candidates">
            {candidates.length === 0 ? (
              <EmptyState title="No candidates." detail={status === "idle" ? "This worker has not started." : "This worker produced a single result or none yet."} />
            ) : (
              <ul className="flex flex-col gap-1">
                {candidates.map((c, i) => {
                  const isChosen = chosen?.id === c.id;
                  const pickable = userMustPick && Boolean(onPick);
                  const body = (
                    <>
                      {c.thumbnailUrl ? (
                        <img src={c.thumbnailUrl} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded object-cover" />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className={cx("truncate", isChosen ? "text-tunnel" : "text-text")}>
                          <span className="text-muted">#{i} </span>
                          {candidateLabel(c)}
                        </div>
                        <div className="truncate text-[11px] text-muted">{c.reason}</div>
                      </div>
                      {isChosen ? <span className="shrink-0 text-[11px] text-collapse">chosen</span> : null}
                    </>
                  );
                  return (
                    <li
                      key={c.id}
                      data-testid="candidate"
                      data-candidate-id={c.id}
                      data-chosen={isChosen || undefined}
                      className={cx(
                        "rounded-lg border",
                        isChosen ? "border-collapse bg-void" : "border-border",
                      )}
                      style={isChosen ? { boxShadow: `0 0 0 1px ${colors.collapse}` } : undefined}
                    >
                      {pickable ? (
                        <button type="button" onClick={() => onPick?.(c)} className="flex min-h-hit w-full items-center gap-3 px-3 py-2 text-left active:bg-border">
                          {body}
                        </button>
                      ) : (
                        <div className="flex min-h-hit items-center gap-3 px-3 py-2">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Proof" testId="worker-sheet-proof">
            {state?.proof ? (
              <ProofViewer proof={state.proof} />
            ) : (
              <EmptyState
                title={chosen && collapseUnavailableReason ? "No quantum proof: the user picked." : "No draw yet."}
                detail={chosen && collapseUnavailableReason ? collapseUnavailableReason : "A proof appears when a quantum draw collapses this worker's candidates."}
              />
            )}
          </Section>

          <Section title="Outputs" testId="worker-sheet-outputs">
            {outputKeys.length === 0 ? (
              <EmptyState title="No outputs." detail={failed ? "The worker failed before producing anything." : "Outputs appear when the worker finishes."} failed={failed} />
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-void px-3 py-2 text-[11px]">
                {outputKeys.map((k) => {
                  const v = outputs[k];
                  const text = typeof v === "string" ? v : JSON.stringify(v, null, 0);
                  const isUrl = typeof v === "string" && /^https?:\/\//.test(v);
                  return (
                    <div key={k} className="contents">
                      <dt className="text-muted">{k}</dt>
                      <dd className="break-all text-text">
                        {isUrl ? (
                          <a href={v} target="_blank" rel="noopener noreferrer" className="text-probability underline decoration-dotted underline-offset-2">
                            {text}
                          </a>
                        ) : (
                          text
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </Section>

          <Section title="Log" testId="worker-sheet-log">
            {rows.length === 0 ? (
              <EmptyState title="No events." detail="Nothing has happened for this worker yet." />
            ) : (
              <div>
                {rows.map((e) => (
                  <LogRow key={e.id} event={e} cluster={cluster} />
                ))}
              </div>
            )}
          </Section>

          <button type="button" onClick={onClose} className={cx(buttonBase, buttonTone.ghost, "w-full")}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
