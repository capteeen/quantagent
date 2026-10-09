"use client";
/** /me: your launches, agent wallets, budgets, connected accounts, pending approvals. */
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApprovalDecision } from "@quantagent/core/types";
import { ApprovalCard, EmptyState, explorerAccountUrl, fmtTime, shortKey } from "@quantagent/ui/kit";
import { api, errorText } from "@/lib/api";
import { WalletConnect, XConnect } from "./ConnectCards";

export function MeScreen({ xError }: { xError?: string | null | undefined }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, refetchInterval: 10_000 });
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const decide = async (launchId: string, approvalId: string, decision: ApprovalDecision, draft?: Record<string, unknown>) => {
    setBusy((b) => ({ ...b, [approvalId]: true }));
    try {
      await api.approve(launchId, approvalId, decision, draft);
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setErrors((e) => ({ ...e, [approvalId]: errorText(err) }));
    } finally {
      setBusy((b) => ({ ...b, [approvalId]: false }));
    }
  };

  const data = me.data;
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Connected accounts" className="flex flex-col gap-2">
        <h2 className="text-sm text-tunnel">Connected</h2>
        <div className="flex flex-wrap gap-2">
          <XConnect me={data} meError={me.error} xError={xError} />
          <WalletConnect />
        </div>
      </section>

      {me.error ? <EmptyState failed title="Could not load your launches." detail={errorText(me.error)} /> : null}

      <section aria-label="Pending approvals" className="flex flex-col gap-2">
        <h2 className="text-sm text-tunnel">Pending approvals</h2>
        {!data || data.pendingApprovals.length === 0 ? (
          <EmptyState title="Nothing waiting for you." detail="Posts, trades beyond the dev buy and outreach wait here for a tap unless autopilot is on." />
        ) : (
          data.pendingApprovals.map((a) => (
            <ApprovalCard key={a.id} approval={a} onDecide={(d, draft) => void decide(a.launchId, a.id, d, draft)} submitting={Boolean(busy[a.id])} error={errors[a.id]} />
          ))
        )}
      </section>

      <section aria-label="Launches" className="flex flex-col gap-2">
        <h2 className="text-sm text-tunnel">Launches</h2>
        {!data || data.launches.length === 0 ? (
          <EmptyState title="No launches yet." detail={data?.account ? "Launches made from this X account in this process appear here." : "Connect X to see launches made from your account."} />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.launches.map((l) => (
              <li key={l.id} data-testid="launch-row" className="rounded-xl border border-border bg-panel px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <Link href={`/launch/${l.id}`} className="min-w-0 flex-1 truncate text-tunnel underline decoration-dotted underline-offset-2">
                    {l.prompt}
                  </Link>
                  <span className={l.status === "failed" ? "text-worker-shield" : l.status === "running" ? "text-probability" : l.status === "live" ? "text-worker-trader" : "text-decay"}>{l.status}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-muted">
                  <span>{fmtTime(l.createdAt)}</span>
                  <span>{l.cluster}</span>
                  {l.coinCa ? (
                    <Link href={`/coin/${l.coinCa}`} className="text-probability underline decoration-dotted">
                      coin {shortKey(l.coinCa, 6, 6)}
                    </Link>
                  ) : (
                    <span className="text-decay">pending launch</span>
                  )}
                  {l.pendingApprovals ? <span className="text-decay">{l.pendingApprovals} waiting</span> : null}
                  {l.failed.length ? <span className="text-worker-shield">failed: {l.failed.join(", ")}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Agent wallets" className="flex flex-col gap-2">
        <h2 className="text-sm text-tunnel">Agent wallets & budgets</h2>
        {!data || data.wallets.length === 0 ? (
          <EmptyState title="No agent wallets." detail="Each launch gets its own server-side wallet with a SOL cap enforced in code." />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-panel px-3">
            {data.wallets.map((w) => (
              <li key={w.launchId} className="flex items-center gap-2 py-2 text-xs">
                {w.address ? (
                  <a href={explorerAccountUrl(w.address, w.cluster)} target="_blank" rel="noopener noreferrer" className="text-probability underline decoration-dotted" title={w.address}>
                    {shortKey(w.address, 6, 6)}
                  </a>
                ) : (
                  <span className="text-worker-shield">no wallet (Solana client unavailable)</span>
                )}
                <span className="ml-auto tabular-nums text-text">
                  {w.usedSol}/{w.budgetSol} SOL
                </span>
                <span className="text-muted">{w.cluster}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
