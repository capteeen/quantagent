"use client";
/**
 * /coin/[ca]: the agent's ongoing life. Chamber in coin mode, Voice feed,
 * Trader log with reasons, Shield report, Recruiter outreach, site status and
 * patch log, autopilot toggles, budgets, QSD decay status and the daughter ghost.
 * Everything is a projection of the launch's event log.
 */
import { useMemo, useState } from "react";
import type { ActionClass, Candidate, QuantumProof, WorkerName } from "@quantagent/core/types";
import { WORKER_NAMES } from "@quantagent/core/types";
import { AutopilotToggle, CoinCard, EmptyState, ProofViewer, ShieldReport, WorkerSheet, fmtTime, shortKey, explorerTxUrl } from "@quantagent/ui/kit";
import { api, errorText } from "@/lib/api";
import { collapseUnavailableReason, eventsOfType, lastEventOf, useLaunchStore } from "@/lib/launchStore";
import { useUiStore } from "@/lib/uiStore";
import { useLaunchStream } from "@/lib/useLaunchStream";
import { ChamberMount } from "./ChamberMount";
import { EventLog } from "./EventLog";
import { MetaPanel } from "./LaunchMeta";
import { coinView } from "./coinData";

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-sm text-tunnel">{title}</h2>
      {children}
    </section>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-hit items-center text-probability underline decoration-dotted underline-offset-2">
      {children}
    </a>
  );
}

export function CoinScreen({ launchId, ca }: { launchId: string; ca: string }) {
  const entry = useLaunchStream(launchId);
  const sound = useUiStore((s) => s.sound);
  const [selected, setSelected] = useState<WorkerName | null>(null);
  const [proof, setProof] = useState<{ worker: WorkerName | "core"; proof: QuantumProof } | null>(null);
  const [autopilotPending, setAutopilotPending] = useState<Partial<Record<ActionClass, boolean>>>({});
  const [autopilotErrors, setAutopilotErrors] = useState<Partial<Record<ActionClass, string>>>({});
  const setMeta = useLaunchStore((s) => s.setMeta);
  void setMeta;

  const state = entry?.state;
  const events = entry?.events ?? [];
  const view = useMemo(() => (state ? coinView(state, events) : null), [state, events]);
  const cluster = state?.cluster ?? "devnet";

  if (!state || state.status === "created") {
    return <EmptyState title="Loading the launch log…" detail={entry?.connectionError ?? `stream: ${entry?.connection ?? "idle"}`} />;
  }
  if (state.coinCa && state.coinCa !== ca) {
    return <EmptyState failed title="This launch deployed a different contract address." detail={`URL: ${ca} · deployed: ${state.coinCa}`} />;
  }

  const posts = eventsOfType(events, "Voice.posted", "Voice.postFailed");
  const trades = events.filter((e) => e.type === "Trader.traded" || e.type === "Trader.rejected" || (e.type === "Worker.progress" && e.worker === "Trader"));
  const recruiter = eventsOfType(events, "Recruiter.found", "Recruiter.reached", "Recruiter.capped");
  const publishes = eventsOfType(events, "Builder.published", "Builder.patchFailed");
  const decay = eventsOfType(events, "Chain.decay", "Chain.measurement", "Chain.daughterBorn", "Chain.milestone");
  const qsdSkipped = events.some((e) => e.type === "Worker.progress" && e.worker === "Launcher" && e.payload.step === "qsd-skipped");
  const lastDecay = lastEventOf(events, "Chain.decay");
  const daughter = lastEventOf(events, "Chain.daughterBorn");

  const toggle = async (cls: ActionClass, enabled: boolean) => {
    setAutopilotPending((p) => ({ ...p, [cls]: true }));
    setAutopilotErrors((e) => ({ ...e, [cls]: undefined }));
    try {
      await api.setAutopilot(launchId, { [cls]: enabled });
    } catch (err) {
      setAutopilotErrors((e) => ({ ...e, [cls]: errorText(err) }));
    } finally {
      setAutopilotPending((p) => ({ ...p, [cls]: false }));
    }
  };

  const selectedReason = selected ? collapseUnavailableReason(events, selected) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <ChamberMount mode="coin" events={events} onTapWorker={setSelected} onTapProof={(w, p) => setProof({ worker: w, proof: p })} sound={sound} />
      <div className="text-xs text-muted">
        stream: {entry?.connection}
        {entry?.connectionError ? ` · ${entry.connectionError}` : ""}
      </div>

      {view ? <CoinCard launch={state} name={view.name} ticker={view.ticker} logo={view.logo} xThread={view.xThread} shield={view.shield} walletBalance={{ status: "none" }} /> : null}
      <MetaPanel meta={entry?.meta ?? null} />

      <Section title="Voice" testId="voice-feed">
        {posts.length === 0 ? (
          <EmptyState title="The Voice has not posted." detail={state.workers.Voice.status === "failed" ? state.workers.Voice.failReason ?? "Voice failed" : "Posts appear here with their reason once approved or on autopilot."} />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-panel px-3">
            {posts.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={e.type === "Voice.postFailed" ? "text-worker-shield" : "text-decay"}>{e.type === "Voice.posted" ? e.payload.kind : "failed"}</span>
                  <time className="ml-auto tabular-nums text-muted">{fmtTime(e.at)}</time>
                </div>
                <div className="whitespace-pre-wrap text-text">{e.payload.text}</div>
                {e.type === "Voice.posted" ? <Ext href={e.payload.url}>{e.payload.postId}</Ext> : <div className="text-worker-shield">{e.payload.error}</div>}
                <div className="text-muted">{e.reason}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Trader" testId="trader-log">
        {trades.length === 0 ? (
          <EmptyState title="The Trader has not acted." detail={state.workers.Trader.status === "failed" ? state.workers.Trader.failReason ?? "Trader failed" : "Every buy, sell and rejection appears here with its reason."} />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-panel px-3">
            {trades.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={e.type === "Trader.rejected" ? "text-worker-shield" : e.type === "Trader.traded" ? "text-worker-trader" : "text-muted"}>
                    {e.type === "Trader.traded" ? `${e.payload.side} ${e.payload.sol} SOL` : e.type === "Trader.rejected" ? `${e.payload.side} ${e.payload.sol} SOL rejected` : e.type === "Worker.progress" ? e.payload.step : e.type}
                  </span>
                  <time className="ml-auto tabular-nums text-muted">{fmtTime(e.at)}</time>
                </div>
                <div className="text-text">{e.reason}</div>
                {e.type === "Trader.traded" ? <Ext href={explorerTxUrl(e.payload.txSignature, cluster)}>tx {shortKey(e.payload.txSignature, 6, 6)}</Ext> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Shield" testId="shield">
        {view?.shield.status === "ready" ? (
          <ShieldReport state="ready" report={view.shield.value} cluster={cluster} />
        ) : view?.shield.status === "failed" ? (
          <ShieldReport state="failed" error={view.shield.error} cluster={cluster} />
        ) : view?.shield.status === "loading" ? (
          <ShieldReport state="scanning" cluster={cluster} />
        ) : (
          <ShieldReport state="none" cluster={cluster} />
        )}
      </Section>

      <Section title="Recruiter" testId="recruiter">
        {recruiter.length === 0 ? (
          <EmptyState title="No outreach yet." detail={state.workers.Recruiter.status === "failed" ? state.workers.Recruiter.failReason ?? "Recruiter failed" : "Accounts found and replies sent appear here; each reply needs a tap unless autopilot is on."} />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-panel px-3">
            {recruiter.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-worker-recruiter">{e.type.replace("Recruiter.", "")}</span>
                  <time className="ml-auto tabular-nums text-muted">{fmtTime(e.at)}</time>
                </div>
                {e.type === "Recruiter.found" ? (
                  <div className="text-text">{e.payload.accounts.map((a) => `@${a.handle} (${a.reach})`).join(", ") || "none"}</div>
                ) : e.type === "Recruiter.reached" ? (
                  <div className="text-text">{e.payload.text}</div>
                ) : (
                  <div className="text-decay">
                    capped at {e.payload.cap} per {Math.round(e.payload.windowMs / 60000)} min
                  </div>
                )}
                <div className="text-muted">{e.reason}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Site" testId="site">
        {state.siteUrl ? <Ext href={state.siteUrl}>{state.siteUrl.replace(/^https?:\/\//, "")}</Ext> : <div className="text-xs text-decay">no site published</div>}
        {publishes.length === 0 ? (
          <EmptyState title="No publishes logged." detail={state.workers.Builder.status === "failed" ? state.workers.Builder.failReason ?? "Builder failed" : "Each publish and failed patch appears here with its trigger."} />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-panel px-3">
            {publishes.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-1.5 text-xs">
                <span className={e.type === "Builder.patchFailed" ? "text-worker-shield" : "text-worker-builder"}>{e.type === "Builder.published" ? "published" : "patch failed"}</span>
                <span className="min-w-0 flex-1 truncate text-text">{e.payload.trigger}</span>
                <span className="text-muted">{e.type === "Builder.published" ? e.payload.deployId : e.payload.error}</span>
                <time className="tabular-nums text-muted">{fmtTime(e.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Autopilot" testId="autopilot">
        <AutopilotToggle autopilot={state.autopilot} onChange={(cls, on) => void toggle(cls, on)} pending={autopilotPending} errors={autopilotErrors} />
      </Section>

      <Section title="Budgets" testId="budgets">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-normal">worker</th>
              <th className="py-1 font-normal">tokens</th>
              <th className="py-1 font-normal">calls</th>
              <th className="py-1 font-normal">SOL</th>
              <th className="py-1 font-normal">deploys</th>
            </tr>
          </thead>
          <tbody>
            {WORKER_NAMES.map((w) => {
              const ws = state.workers[w];
              return (
                <tr key={w} className="border-t border-border">
                  <td className="py-1 text-text">{w}</td>
                  <td className="py-1 tabular-nums">
                    {ws.used.tokens}/{ws.budget.tokens}
                  </td>
                  <td className="py-1 tabular-nums">
                    {ws.used.apiCalls}/{ws.budget.apiCalls}
                  </td>
                  <td className="py-1 tabular-nums">
                    {ws.used.sol}/{ws.budget.sol}
                  </td>
                  <td className="py-1 tabular-nums">
                    {ws.used.deploys}/{ws.budget.deploys}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="QSD decay" testId="decay">
        {decay.length === 0 ? (
          <EmptyState
            title="No decay events."
            detail={qsdSkipped ? "The Launcher skipped the QSD sequence (qsd-market is not linked), so decay, measurement and daughter creation do not run for this coin." : "Chain.decay, Chain.measurement and Chain.daughterBorn appear here when the QSD protocol emits them."}
          />
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-panel px-3 py-2 text-xs">
            {lastDecay ? (
              <div>
                roughness {lastDecay.payload.roughness} · half-life {lastDecay.payload.halfLife}
              </div>
            ) : null}
            {daughter ? (
              <div className="text-decay">
                daughter born: <a href={`/coin/${daughter.payload.daughterCa}`} className="underline decoration-dotted">{shortKey(daughter.payload.daughterCa, 6, 6)}</a>
              </div>
            ) : null}
            <ul className="divide-y divide-border">
              {decay.map((e) => (
                <li key={e.id} className="flex items-center gap-2 py-1">
                  <span className="text-muted">{e.type.replace("Chain.", "")}</span>
                  <span className="min-w-0 flex-1 truncate text-text">{e.reason}</span>
                  <time className="tabular-nums text-muted">{fmtTime(e.at)}</time>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <EventLog events={events} cluster={cluster} title="full log" />

      {selected ? (
        <WorkerSheet
          worker={selected}
          state={state.workers[selected]}
          events={events}
          open
          onClose={() => setSelected(null)}
          collapseUnavailableReason={selectedReason}
          {...(selectedReason ? { onPick: (c: Candidate) => void api.pick(launchId, selected, c.id) } : {})}
          cluster={cluster}
        />
      ) : null}
      {proof ? (
        <div role="dialog" aria-label="Quantum proof" className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[430px] animate-sheet-in rounded-t-2xl border border-border bg-panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-tunnel">proof · {proof.worker}</span>
            <button type="button" onClick={() => setProof(null)} className="inline-flex min-h-hit min-w-hit items-center justify-center text-muted">
              ×
            </button>
          </div>
          <ProofViewer proof={proof.proof} />
        </div>
      ) : null}
    </div>
  );
}
