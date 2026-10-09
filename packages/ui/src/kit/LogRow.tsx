/**
 * LogRow: one event. Time, worker colour dot, type, the one-line reason,
 * and every external id in the payload as a link.
 */
import type { QuantagentEvent, WorkerName } from "@quantagent/core/types";
import { WORKER_NAMES } from "@quantagent/core/types";
import { colors } from "../tokens";
import { cx, explorerTxUrl, ExternalLink, fmtTime, pumpFunUrl, shortKey, workerColor, xPostUrl } from "./primitives";

export type Cluster = "devnet" | "mainnet-beta";

/** The worker an event belongs to, if any: explicit `worker`, `payload.worker`, or the type prefix. */
export function workerOfEvent(event: QuantagentEvent): WorkerName | null {
  if ("worker" in event && typeof event.worker === "string") return event.worker;
  const p = event.payload as { worker?: unknown };
  if (typeof p?.worker === "string" && (WORKER_NAMES as readonly string[]).includes(p.worker)) return p.worker as WorkerName;
  const prefix = event.type.split(".")[0];
  return (WORKER_NAMES as readonly string[]).includes(prefix ?? "") ? (prefix as WorkerName) : null;
}

export interface ExternalRef {
  label: string;
  value: string;
  href?: string;
}

/** Every external id the payload carries, with a link when one exists. */
export function externalRefsOf(event: QuantagentEvent, cluster: Cluster = "devnet"): ExternalRef[] {
  const refs: ExternalRef[] = [];
  const p = event.payload as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof p[k] === "string" ? (p[k] as string) : undefined);

  const tx = str("txSignature");
  if (tx) refs.push({ label: "tx", value: shortKey(tx, 6, 6), href: explorerTxUrl(tx, cluster) });
  const ca = str("coinCa") ?? str("daughterCa");
  if (ca) refs.push({ label: "ca", value: shortKey(ca, 6, 6), href: pumpFunUrl(ca) });
  const postId = str("postId");
  const url = str("url");
  if (postId) refs.push({ label: "post", value: postId, href: url ?? xPostUrl(postId) });
  else if (url) refs.push({ label: "url", value: url.replace(/^https?:\/\//, ""), href: url });
  const deployId = str("deployId");
  if (deployId) refs.push({ label: "deploy", value: deployId });
  const asset = p["asset"] as { url?: unknown; externalId?: unknown } | undefined;
  if (asset && typeof asset.url === "string") refs.push({ label: "image", value: asset.url.replace(/^https?:\/\//, ""), href: asset.url });
  const approval = p["approval"] as { id?: unknown } | undefined;
  if (approval && typeof approval.id === "string") refs.push({ label: "approval", value: approval.id });
  const approvalId = str("approvalId");
  if (approvalId) refs.push({ label: "approval", value: approvalId });
  const proof = p["proof"] as { drawHash?: unknown } | undefined;
  if (proof && typeof proof.drawHash === "string") refs.push({ label: "draw", value: shortKey(proof.drawHash, 8, 8) });
  const copycat = p["copycat"] as { url?: unknown; externalId?: unknown } | undefined;
  if (copycat && typeof copycat.url === "string") refs.push({ label: "copycat", value: String(copycat.externalId ?? copycat.url), href: copycat.url });
  const flag = p["flag"] as { txSignatures?: unknown } | undefined;
  if (flag && Array.isArray(flag.txSignatures)) {
    for (const s of flag.txSignatures) if (typeof s === "string") refs.push({ label: "tx", value: shortKey(s, 6, 6), href: explorerTxUrl(s, cluster) });
  }
  return refs;
}

export interface LogRowProps {
  event: QuantagentEvent;
  cluster?: Cluster;
  className?: string;
}

export function LogRow({ event, cluster = "devnet", className }: LogRowProps) {
  const worker = workerOfEvent(event);
  const failed = /failed|rejected|Exceeded|Unavailable/.test(event.type);
  const dot = worker ? workerColor(worker) : event.type.startsWith("Launch.") ? colors.tunnel : colors.muted;
  const refs = externalRefsOf(event, cluster);
  return (
    <div
      data-testid="log-row"
      data-event-type={event.type}
      className={cx("grid grid-cols-[auto_auto_1fr] items-start gap-x-2 gap-y-0.5 border-b border-border py-2 font-mono text-xs", className)}
    >
      <time dateTime={event.at} title={event.at} className="tabular-nums text-muted">
        {fmtTime(event.at)}
      </time>
      <span aria-hidden className="mt-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />
      <div className="min-w-0">
        <div className={cx("truncate", failed ? "text-worker-shield" : "text-tunnel")}>
          {worker ? <span className="sr-only">{worker} </span> : null}
          {event.type}
        </div>
        <div className="whitespace-pre-wrap break-words text-text">{event.reason}</div>
        {refs.length ? (
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0">
            {refs.map((r, i) =>
              r.href ? (
                <ExternalLink key={`${r.label}-${i}`} href={r.href} className="min-h-0 text-[11px]">
                  {r.label}:{r.value}
                </ExternalLink>
              ) : (
                <span key={`${r.label}-${i}`} className="text-[11px] text-muted">
                  {r.label}:{r.value}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
