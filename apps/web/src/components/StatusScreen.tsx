"use client";
/** /status: API budgets, queue depth, provider health, hosting health. Every row is what the server reported. */
import { useQuery } from "@tanstack/react-query";
import { EmptyState, fmtTime } from "@quantagent/ui/kit";
import { api, errorText } from "@/lib/api";
import type { Health } from "@/server/types";

function HealthRow({ label, health }: { label: string; health: Health }) {
  return (
    <li data-testid={`health-${label}`} data-ok={health.ok} className="flex flex-col gap-0.5 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${health.ok ? "bg-worker-trader" : "bg-worker-shield"}`} />
        <span className="text-tunnel">{label}</span>
        <span className="ml-auto text-muted">{health.ok ? (health.detail ?? "ok") : health.name}</span>
      </div>
      {health.ok ? health.notes?.map((n) => <div key={n} className="pl-4 text-muted">{n}</div>) : <div className="pl-4 text-worker-shield">{health.message}</div>}
    </li>
  );
}

export function StatusScreen() {
  const q = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 15_000 });
  if (q.error) return <EmptyState failed title="Status unavailable." detail={errorText(q.error)} />;
  const s = q.data;
  if (!s) return <EmptyState title="Loading status…" />;
  const labels: Record<keyof typeof s.providers, string> = { llm: "LLM", image: "images", x: "X", solana: "Solana", hosting: "hosting", quantum: "quantum draw" };
  return (
    <div className="flex flex-col gap-5 text-xs">
      <div className="text-muted">
        as of {fmtTime(s.at)} · cluster {s.cluster ?? "unresolved"}
        {s.clusterError ? <span className="text-worker-shield"> · {s.clusterError.message}</span> : null}
      </div>

      <section aria-label="Providers">
        <h2 className="mb-1 text-sm text-tunnel">Providers</h2>
        <ul className="divide-y divide-border rounded-xl border border-border bg-panel px-3">
          {(Object.keys(labels) as (keyof typeof labels)[]).map((k) => (
            <HealthRow key={k} label={labels[k]} health={s.providers[k]} />
          ))}
        </ul>
      </section>

      <section aria-label="Storage">
        <h2 className="mb-1 text-sm text-tunnel">Storage</h2>
        <div className="rounded-xl border border-border bg-panel px-3 py-2">
          events: {s.store.events} · stream: {s.store.stream} · X tokens: {s.store.tokens} · wallet keys: {s.store.wallets}
        </div>
      </section>

      <section aria-label="X API">
        <h2 className="mb-1 text-sm text-tunnel">X API</h2>
        {s.x.ok ? (
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-panel px-3 py-2">
            <div>
              monthly calls {s.x.status.budget.used}/{s.x.status.budget.limit} · resets {fmtTime(s.x.status.budget.resetsAt)} {s.x.status.budget.paused ? <span className="text-worker-shield">· paused</span> : null}
            </div>
            <div>
              global bucket {s.x.status.rateLimit.global.available}/{s.x.status.rateLimit.global.capacity}
            </div>
            <div>
              dead letters {s.x.status.deadLetters.count} ({s.x.status.deadLetters.failed} failed)
            </div>
            {s.x.status.deadLetters.items.slice(0, 5).map((d) => (
              <div key={d.id} className="text-worker-shield">
                {d.op} · {d.error}
              </div>
            ))}
            <div>connected accounts: {s.x.status.accounts.length ? s.x.status.accounts.map((a) => (a.handle ? `@${a.handle}` : a.accountId)).join(", ") : "none"}</div>
          </div>
        ) : (
          <EmptyState failed title="X runtime unavailable." detail={s.x.message} />
        )}
      </section>

      <section aria-label="Hosting">
        <h2 className="mb-1 text-sm text-tunnel">Hosting</h2>
        <ul className="divide-y divide-border rounded-xl border border-border bg-panel px-3">
          <HealthRow label="provider" health={s.hosting.health} />
          <li className="py-2 text-muted">
            {s.hosting.lastPublished ? `last publish ${fmtTime(s.hosting.lastPublished.at)} · ${s.hosting.lastPublished.url}` : "no publish in this process yet"}
            {s.hosting.lastFailure ? <div className="text-worker-shield">last failure {fmtTime(s.hosting.lastFailure.at)} · {s.hosting.lastFailure.error}</div> : null}
          </li>
        </ul>
      </section>

      <section aria-label="Queue">
        <h2 className="mb-1 text-sm text-tunnel">Queue</h2>
        <div className="rounded-xl border border-border bg-panel px-3 py-2">
          <div>
            launches {s.queue.launches} · running {s.queue.running}
          </div>
          {s.queue.postLaunch.length === 0 ? (
            <div className="text-muted">no post-launch runtimes</div>
          ) : (
            s.queue.postLaunch.map((p) => (
              <div key={p.launchId} className={p.status === "unavailable" || p.status === "failed" ? "text-worker-shield" : ""}>
                {p.launchId}: {p.status}
                {p.counts ? ` · ${Object.entries(p.counts).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}
                {p.error ? ` · ${p.error}` : ""}
              </div>
            ))
          )}
        </div>
      </section>

      <section aria-label="Cost">
        <h2 className="mb-1 text-sm text-tunnel">Cost per launch</h2>
        <div className="rounded-xl border border-border bg-panel px-3 py-2">
          <div>
            launch {s.cost.launchSol} · dev buy {s.cost.devBuySol} · agent budget {s.cost.agentBudgetSol} · you pay {s.cost.youPaySol} SOL
          </div>
          {s.cost.notes.map((n) => (
            <div key={n} className="text-muted">
              {n}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
