/**
 * CoinCard: the coin as it stands. CA (copy), site URL, logo, X thread link,
 * agent wallet balance, shield status. "Pending launch" until the CA exists;
 * every other field says "none yet" or shows its own failure. Never invents.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { ImageAsset, Launch, ShieldReport as ShieldReportData } from "@quantagent/core/types";
import { buttonBase, buttonTone, copyText, cx, explorerAccountUrl, ExternalLink, FailBanner, Heading, Label, Panel, pumpFunUrl, shortKey } from "./primitives";

/** A value the app has, is still fetching, or failed to get. The card never guesses. */
export type Fetched<T> = { status: "ready"; value: T } | { status: "loading" } | { status: "failed"; error: string } | { status: "none" };

export interface CoinCardProps {
  launch: Pick<Launch, "status" | "coinCa" | "siteUrl" | "agentWallet" | "cluster">;
  name?: string | undefined;
  ticker?: string | undefined;
  logo?: Fetched<ImageAsset> | undefined;
  /** The announcement thread posted from the project's own X account. */
  xThread?: Fetched<{ url: string; postId: string }> | undefined;
  /** Agent wallet balance in SOL. */
  walletBalance?: Fetched<number> | undefined;
  shield?: Fetched<ShieldReportData> | undefined;
  onOpenShield?: () => void;
  /** Override the copy transport (tests). */
  copy?: (text: string) => Promise<boolean>;
}

type CopyState = "idle" | "copied" | "failed";

function shieldSummary(s: Fetched<ShieldReportData> | undefined): { text: string; tone: "muted" | "ok" | "warn" | "fail" } {
  if (!s || s.status === "none") return { text: "not scanning", tone: "muted" };
  if (s.status === "loading") return { text: "scanning…", tone: "muted" };
  if (s.status === "failed") return { text: s.error, tone: "fail" };
  const n = s.value.copycats.length;
  const f = s.value.bundleFlags.length;
  if (n === 0 && f === 0) return { text: "clear", tone: "ok" };
  const parts: string[] = [];
  if (n) parts.push(`${n} copycat${n === 1 ? "" : "s"}`);
  if (f) parts.push(`${f} flag${f === 1 ? "" : "s"}`);
  return { text: parts.join(" · "), tone: "warn" };
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div data-testid={testId} className="grid grid-cols-[72px_1fr] items-center gap-x-2 py-1.5">
      <Label>{label}</Label>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

export function CoinCard({ launch, name, ticker, logo, xThread, walletBalance, shield, onOpenShield, copy = copyText }: CoinCardProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  useEffect(() => {
    if (copyState === "idle") return;
    const t = setTimeout(() => setCopyState("idle"), 1800);
    return () => clearTimeout(t);
  }, [copyState]);

  const ca = launch.coinCa;
  const live = Boolean(ca);
  const failed = launch.status === "failed";
  const sh = shieldSummary(shield);

  return (
    <Panel data-testid="coin-card" data-state={failed ? "failed" : live ? "live" : "pending"} tone={failed ? "failed" : "panel"} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div data-testid="coin-logo" className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-void">
          {logo?.status === "ready" ? (
            <img src={logo.value.url} alt={name ? `${name} logo` : "coin logo"} width={56} height={56} className="h-full w-full object-cover" />
          ) : logo?.status === "failed" ? (
            <span className="px-1 text-center text-[10px] leading-tight text-worker-shield" title={logo.error}>
              no logo
            </span>
          ) : logo?.status === "loading" ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-probability" aria-label="logo generating" />
          ) : (
            <span className="text-[10px] text-muted">no logo</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Heading as="h2" className="truncate">
            {name ?? <span className="text-muted">unnamed</span>}
            {ticker ? <span className="ml-2 text-sm text-muted">${ticker}</span> : null}
          </Heading>
          <div className={cx("text-xs", failed ? "text-worker-shield" : live ? "text-probability" : "text-decay")}>
            {failed ? "launch failed" : live ? `live · ${launch.cluster}` : "pending launch"}
          </div>
        </div>
      </div>

      {logo?.status === "failed" ? <FailBanner>logo: {logo.error}</FailBanner> : null}

      <div className="divide-y divide-border">
        <Row label="CA" testId="coin-ca">
          {ca ? (
            <div className="flex items-center gap-2">
              <ExternalLink href={pumpFunUrl(ca)} className="min-h-0 truncate text-tunnel no-underline">
                <span className="truncate" title={ca}>
                  {shortKey(ca, 6, 6)}
                </span>
              </ExternalLink>
              <button
                type="button"
                onClick={async () => setCopyState((await copy(ca)) ? "copied" : "failed")}
                aria-label="Copy contract address"
                className={cx(buttonBase, buttonTone.ghost, "h-8 min-h-0 px-2 text-xs", copyState === "failed" && "text-worker-shield")}
              >
                {copyState === "copied" ? "copied" : copyState === "failed" ? "copy failed" : "copy"}
              </button>
            </div>
          ) : (
            <span className="text-decay">pending launch</span>
          )}
        </Row>

        <Row label="site" testId="coin-site">
          {launch.siteUrl ? (
            <ExternalLink href={launch.siteUrl} className="min-h-0 truncate">
              {launch.siteUrl.replace(/^https?:\/\//, "")}
            </ExternalLink>
          ) : (
            <span className="text-muted">not deployed</span>
          )}
        </Row>

        <Row label="X" testId="coin-x">
          {xThread?.status === "ready" ? (
            <ExternalLink href={xThread.value.url} className="min-h-0 truncate">
              thread {xThread.value.postId}
            </ExternalLink>
          ) : xThread?.status === "failed" ? (
            <span className="text-worker-shield">{xThread.error}</span>
          ) : xThread?.status === "loading" ? (
            <span className="text-muted">posting…</span>
          ) : (
            <span className="text-muted">not posted</span>
          )}
        </Row>

        <Row label="wallet" testId="coin-wallet">
          <div className="flex items-center gap-2">
            <ExternalLink href={explorerAccountUrl(launch.agentWallet, launch.cluster)} className="min-h-0" >
              <span title={launch.agentWallet}>{shortKey(launch.agentWallet)}</span>
            </ExternalLink>
            {walletBalance?.status === "ready" ? (
              <span className="tabular-nums text-tunnel">{walletBalance.value.toFixed(3)} SOL</span>
            ) : walletBalance?.status === "failed" ? (
              <span className="text-worker-shield">{walletBalance.error}</span>
            ) : walletBalance?.status === "loading" ? (
              <span className="text-muted">…</span>
            ) : (
              <span className="text-muted">balance unknown</span>
            )}
          </div>
        </Row>

        <Row label="shield" testId="coin-shield">
          <button
            type="button"
            onClick={onOpenShield}
            disabled={!onOpenShield}
            className={cx(
              "inline-flex min-h-hit items-center text-left disabled:cursor-default",
              sh.tone === "ok" && "text-worker-trader",
              sh.tone === "warn" && "text-decay",
              sh.tone === "fail" && "text-worker-shield",
              sh.tone === "muted" && "text-muted",
            )}
          >
            {sh.text}
          </button>
        </Row>
      </div>
    </Panel>
  );
}
