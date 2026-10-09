"use client";
/**
 * THE SCREEN. Chamber on top; the two connections; the prompt; the launch
 * button with the cost line. After the tap the same screen shows the eight
 * ThreadStrip chips, ApprovalCards as they arrive, the WorkerSheet on tap and
 * the CoinCard once the coin is live. /launch/[id] renders it deep-linked.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import type { ApprovalDecision, Candidate, QuantumProof, WorkerName } from "@quantagent/core/types";
import type { ChamberMode } from "@quantagent/ui/chamber";
import { ApprovalCard, CoinCard, EmptyState, LaunchButton, PromptBox, ProofViewer, ThreadStrip, WorkerSheet } from "@quantagent/ui/kit";
import { api, errorNeeds, errorText } from "@/lib/api";
import { approvalsOf, collapseUnavailableReason, useLaunchStore } from "@/lib/launchStore";
import { useUiStore } from "@/lib/uiStore";
import { useLaunchStream } from "@/lib/useLaunchStream";
import { ChamberMount } from "./ChamberMount";
import { WalletConnect, XConnect } from "./ConnectCards";
import { EventLog } from "./EventLog";
import { MetaPanel } from "./LaunchMeta";
import { coinView } from "./coinData";

export interface LaunchScreenProps {
  launchId: string | null;
  /** The X account id from the session cookie, read on the server. */
  accountId: string | null;
  /** From /api/x/oauth/callback when the connection failed. */
  xError?: string | null | undefined;
  /** Open the full event log by default (the /launch/[id] deep link). */
  logOpen?: boolean | undefined;
}

export const SURPRISE_PROMPT = "surprise me";

function chamberMode(status: string | undefined): ChamberMode {
  if (!status || status === "created") return "idle";
  if (status === "running") return "launch";
  return "live";
}

export function LaunchScreen({ launchId, accountId, xError, logOpen = false }: LaunchScreenProps) {
  const qc = useQueryClient();
  const [currentId, setCurrentId] = useState<string | null>(launchId);
  const entry = useLaunchStream(currentId);
  const reset = useLaunchStore((s) => s.reset);
  const { publicKey, connected } = useWallet();
  const sound = useUiStore((s) => s.sound);
  const setSound = useUiStore((s) => s.setSound);

  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 30_000 });

  const [prompt, setPrompt] = useState("");
  // The CoinCard slides in when the chamber says so (Launch.live + 1800ms). A page opened after the
  // launch went live, or a chamber that cannot render, must still show the card: fall back 3.3s after live.
  const [cardIn, setCardIn] = useState(false);
  const [surprise, setSurprise] = useState(false);
  const [selected, setSelected] = useState<WorkerName | null>(null);
  const [proof, setProof] = useState<{ worker: WorkerName | "core"; proof: QuantumProof } | null>(null);
  const [approvalBusy, setApprovalBusy] = useState<Record<string, boolean>>({});
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});
  const [pickError, setPickError] = useState<string | null>(null);

  const xConnected = Boolean(me.data?.account) || (Boolean(accountId) && !me.isSuccess);
  const ownerWallet = connected && publicKey ? publicKey.toBase58() : null;

  const launchMutation = useMutation({
    mutationFn: (input: { prompt: string; ownerWallet: string }) => api.createLaunch(input),
    onSuccess: ({ id }) => {
      reset(id);
      setCurrentId(id);
      if (typeof window !== "undefined") window.history.replaceState(null, "", `/launch/${id}`);
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const state = entry?.state;
  const liveStatus = state?.status;
  const liveAtMount = useRef<boolean | null>(null);
  useEffect(() => {
    if (!liveStatus) return;
    if (liveAtMount.current === null) liveAtMount.current = liveStatus === "live";
    if (liveStatus !== "live") return;
    if (liveAtMount.current) {
      setCardIn(true);
      return;
    }
    const t = setTimeout(() => setCardIn(true), 3300);
    return () => clearTimeout(t);
  }, [liveStatus]);
  const events = entry?.events ?? [];
  const launched = Boolean(currentId);
  const effectivePrompt = surprise ? SURPRISE_PROMPT : prompt.trim();

  const launchButton = (() => {
    if (launchMutation.isPending) return { state: "launching" as const };
    if (!xConnected) return { state: "disabled" as const, reason: "connect the project's X account first" };
    if (!ownerWallet) return { state: "disabled" as const, reason: "connect a wallet" };
    if (!effectivePrompt) return { state: "disabled" as const, reason: "type what the coin is about, or tap surprise me" };
    return { state: "idle" as const, onLaunch: () => launchMutation.mutate({ prompt: effectivePrompt, ownerWallet }) };
  })();

  const approvals = useMemo(() => approvalsOf(events), [events]);
  const openApprovals = approvals.filter((a) => !a.resolved);
  const view = useMemo(() => (state ? coinView(state, events) : null), [state, events]);
  const cluster = state?.cluster ?? status.data?.cluster ?? "devnet";

  const decide = useCallback(
    async (approvalId: string, decision: ApprovalDecision, draft?: Record<string, unknown>) => {
      if (!currentId) return;
      setApprovalBusy((b) => ({ ...b, [approvalId]: true }));
      setApprovalErrors((e) => {
        const { [approvalId]: _drop, ...rest } = e;
        return rest;
      });
      try {
        await api.approve(currentId, approvalId, decision, draft);
      } catch (err) {
        setApprovalErrors((e) => ({ ...e, [approvalId]: errorText(err) }));
      } finally {
        setApprovalBusy((b) => ({ ...b, [approvalId]: false }));
      }
    },
    [currentId],
  );

  const pick = useCallback(
    async (worker: WorkerName, candidate: Candidate) => {
      if (!currentId) return;
      setPickError(null);
      try {
        await api.pick(currentId, worker, candidate.id);
      } catch (err) {
        setPickError(errorText(err));
      }
    },
    [currentId],
  );

  useEffect(() => {
    if (!launched) return;
    setSurprise(false);
  }, [launched]);

  const cost = status.data?.cost;
  const selectedReason = selected ? collapseUnavailableReason(events, selected) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <ChamberMount
        mode={chamberMode(state?.status)}
        events={events}
        onTapWorker={(w) => setSelected(w)}
        onTapProof={(worker, p) => setProof({ worker, proof: p })}
        onLive={() => setCardIn(true)}
        sound={sound}
      />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{entry ? `stream: ${entry.connection}${entry.connectionError ? ` · ${entry.connectionError}` : ""}` : "no launch yet"}</span>
        <button type="button" onClick={() => setSound(!sound)} aria-pressed={sound} className="inline-flex min-h-hit items-center px-2">
          sound {sound ? "on" : "off"}
        </button>
      </div>

      <section aria-label="Connections" className="flex flex-wrap gap-2">
        <XConnect me={me.data} meError={me.error} xError={xError} />
        <WalletConnect />
      </section>

      <section aria-label="Prompt" className="flex flex-col gap-3">
        <PromptBox
          value={launched && state?.prompt ? state.prompt : prompt}
          onChange={(v) => {
            setPrompt(v);
            if (surprise) setSurprise(false);
          }}
          onSurprise={() => setSurprise((s) => !s)}
          surprise={surprise}
          {...(launchButton.state === "idle" ? { onSubmit: launchButton.onLaunch } : {})}
          disabled={launched || launchMutation.isPending}
        />
        {!launched ? (
          <>
            <LaunchButton {...launchButton} />
            <div data-testid="cost-line" className="text-center text-xs text-muted">
              {cost ? (
                <>
                  launch {cost.launchSol} · dev buy {cost.devBuySol} · agent budget {cost.agentBudgetSol} · you pay {cost.youPaySol} SOL · {cost.cluster}
                </>
              ) : status.error ? (
                <span className="text-worker-shield">cost unavailable: {errorText(status.error)}</span>
              ) : (
                "computing cost…"
              )}
            </div>
            {launchMutation.error ? (
              <EmptyState
                failed
                title="Launch could not start."
                detail={[errorText(launchMutation.error), ...(errorNeeds(launchMutation.error).length ? [`needs: ${errorNeeds(launchMutation.error).join(", ")}`] : [])].join(" · ")}
              />
            ) : null}
          </>
        ) : null}
      </section>

      {launched ? (
        <section aria-label="Launch" className="flex flex-col gap-3">
          <ThreadStrip workers={state && state.status !== "created" ? state.workers : undefined} selected={selected} onSelect={(w) => setSelected(w)} />
          <MetaPanel meta={entry?.meta ?? null} />

          {openApprovals.length ? (
            <div data-testid="approvals" className="flex flex-col gap-2">
              {openApprovals.map(({ approval }) => (
                <div key={approval.id} className="animate-sheet-in">
                  <ApprovalCard
                    approval={approval}
                    onDecide={(d, draft) => void decide(approval.id, d, draft)}
                    submitting={Boolean(approvalBusy[approval.id])}
                    error={approvalErrors[approval.id]}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {state && !state.coinCa && state.status === "running" ? (
            <div data-testid="pending-launch" className="text-xs text-decay">
              pending launch · no contract address yet; it appears here the moment the Launcher confirms the deploy
            </div>
          ) : null}
          {state && view && (cardIn || state.status === "partial" || state.status === "failed") ? (
            <div className="animate-sheet-in" data-testid="coin-card-slot">
              <CoinCard launch={state} name={view.name} ticker={view.ticker} logo={view.logo} xThread={view.xThread} shield={view.shield} walletBalance={{ status: "none" }} />
              {state.coinCa ? (
                <a href={`/coin/${state.coinCa}`} className="mt-2 inline-flex min-h-hit items-center text-sm text-probability underline decoration-dotted underline-offset-2">
                  open the coin page →
                </a>
              ) : null}
            </div>
          ) : null}

          {pickError ? <EmptyState failed title="Pick failed." detail={pickError} /> : null}

          <EventLog events={events} cluster={cluster} open={logOpen} />
        </section>
      ) : null}

      {selected ? (
        <WorkerSheet
          worker={selected}
          state={state && state.status !== "created" ? state.workers[selected] : undefined}
          events={events}
          open
          onClose={() => setSelected(null)}
          collapseUnavailableReason={selectedReason}
          {...(selectedReason ? { onPick: (c: Candidate) => void pick(selected, c) } : {})}
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
