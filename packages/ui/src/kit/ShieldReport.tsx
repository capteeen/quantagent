/**
 * ShieldReport: what the Shield found. Canonical CA, copycats (each a link
 * to the source), bundle / dev-wallet flags (each tx a link). An empty
 * report says "clear"; no report says the Shield has not reported.
 */
import type { ShieldReport as ShieldReportData } from "@quantagent/core/types";
import { EmptyState } from "./EmptyState";
import type { Cluster } from "./LogRow";
import { cx, explorerTxUrl, ExternalLink, fmtTime, Heading, Label, Panel, pumpFunUrl, shortKey } from "./primitives";

export type ShieldReportProps =
  | { state: "none"; cluster?: Cluster }
  | { state: "scanning"; cluster?: Cluster }
  | { state: "failed"; error: string; cluster?: Cluster }
  | { state: "ready"; report: ShieldReportData; reportedAt?: string; cluster?: Cluster };

export function ShieldReport(props: ShieldReportProps) {
  const cluster = props.cluster ?? "devnet";
  if (props.state === "none") {
    return <EmptyState title="The Shield has not reported." detail="A report appears once the Shield registers the canonical CA and completes its first scan." />;
  }
  if (props.state === "scanning") {
    return (
      <EmptyState
        title="Scanning…"
        detail="Looking for name, ticker and logo matches across recent pump.fun launches and X, and for bundled or anomalous wallets."
      />
    );
  }
  if (props.state === "failed") {
    return <EmptyState failed title="Shield scan failed." detail={props.error} />;
  }

  const { report } = props;
  const clear = report.copycats.length === 0 && report.bundleFlags.length === 0;

  return (
    <Panel data-testid="shield-report" data-state={clear ? "clear" : "flagged"} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Heading as="h2">Shield</Heading>
        <span className={cx("text-xs", clear ? "text-worker-trader" : "text-decay")}>
          {clear ? "clear" : `${report.copycats.length} copycat${report.copycats.length === 1 ? "" : "s"} · ${report.bundleFlags.length} flag${report.bundleFlags.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="grid grid-cols-[72px_1fr] items-center gap-x-2">
        <Label>canonical</Label>
        {report.canonicalCa ? (
          <ExternalLink href={pumpFunUrl(report.canonicalCa)} className="min-h-0 text-tunnel">
            <span title={report.canonicalCa}>{shortKey(report.canonicalCa, 6, 6)}</span>
          </ExternalLink>
        ) : (
          <span className="text-decay">pending launch</span>
        )}
      </div>

      <section className="flex flex-col gap-1">
        <Label>copycats</Label>
        {report.copycats.length === 0 ? (
          <div className="text-xs text-muted">None found.</div>
        ) : (
          <ul className="divide-y divide-border">
            {report.copycats.map((c) => (
              <li key={`${c.source}-${c.externalId}`} data-testid="copycat" className="flex items-center gap-2 py-1.5 text-xs">
                <span className="w-16 shrink-0 text-muted">{c.source}</span>
                <span className="w-12 shrink-0 text-decay">{c.match}</span>
                <span className="w-10 shrink-0 tabular-nums text-text">{Math.round(c.score * 100)}%</span>
                <ExternalLink href={c.url} className="min-h-0 min-w-0 flex-1 truncate">
                  {c.externalId}
                </ExternalLink>
                <time dateTime={c.seenAt} title={c.seenAt} className="shrink-0 tabular-nums text-muted">
                  {fmtTime(c.seenAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <Label>flags</Label>
        {report.bundleFlags.length === 0 ? (
          <div className="text-xs text-muted">None found.</div>
        ) : (
          <ul className="divide-y divide-border">
            {report.bundleFlags.map((f, i) => (
              <li key={`${f.kind}-${i}`} data-testid="bundle-flag" className="flex flex-col gap-0.5 py-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-worker-shield">{f.kind}</span>
                  <time dateTime={f.seenAt} title={f.seenAt} className="ml-auto tabular-nums text-muted">
                    {fmtTime(f.seenAt)}
                  </time>
                </div>
                <div className="whitespace-pre-wrap break-words text-text">{f.evidence}</div>
                {f.txSignatures.length ? (
                  <div className="flex flex-wrap gap-x-3">
                    {f.txSignatures.map((s) => (
                      <ExternalLink key={s} href={explorerTxUrl(s, cluster)} className="min-h-0 text-[11px]">
                        tx:{shortKey(s, 6, 6)}
                      </ExternalLink>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {props.reportedAt ? (
        <div className="text-[11px] text-muted">
          reported <time dateTime={props.reportedAt}>{fmtTime(props.reportedAt)}</time>
        </div>
      ) : null}
    </Panel>
  );
}
