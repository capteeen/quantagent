"use client";
import type { QuantagentEvent } from "@quantagent/core/types";
import { EmptyState, LogRow } from "@quantagent/ui/kit";

export function EventLog({ events, cluster, open = false, title = "log" }: { events: readonly QuantagentEvent[]; cluster: "devnet" | "mainnet-beta"; open?: boolean; title?: string }) {
  if (events.length === 0) return <EmptyState title="No events yet." detail="Every worker action appears here with its reason as it happens." />;
  return (
    <details data-testid="event-log" open={open} className="rounded-xl border border-border bg-panel">
      <summary className="flex min-h-hit cursor-pointer list-none items-center justify-between px-3 text-sm text-tunnel [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="text-xs text-muted">{events.length} events</span>
      </summary>
      <div className="max-h-[60vh] overflow-y-auto px-3 pb-2">
        {events.map((e) => (
          <LogRow key={e.id} event={e} cluster={cluster} />
        ))}
      </div>
    </details>
  );
}
