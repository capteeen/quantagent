"use client";
/**
 * Subscribes a launch to its SSE stream (history then live, resumed with
 * Last-Event-ID) and keeps its meta fresh. Returns the store entry.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { connectSse } from "./sse";
import { useLaunchStore, type LaunchEntry } from "./launchStore";
import type { QuantagentEvent } from "@quantagent/core/types";

export function useLaunchStream(id: string | null): LaunchEntry | null {
  const entry = useLaunchStore((s) => (id ? (s.launches[id] ?? null) : null));
  const ensure = useLaunchStore((s) => s.ensure);
  const ingest = useLaunchStore((s) => s.ingest);
  const setConnection = useLaunchStore((s) => s.setConnection);
  const setMeta = useLaunchStore((s) => s.setMeta);

  useEffect(() => {
    if (!id) return;
    const existing = ensure(id);
    const lastEventId = existing.lastSeq > 0 ? String(existing.lastSeq) : undefined;
    const stop = connectSse(`/api/launch/${encodeURIComponent(id)}/events`, {
      lastEventId,
      onMessage: (m) => {
        if (m.event === "error") {
          try {
            const parsed = JSON.parse(m.data) as { message?: string };
            setConnection(id, "reconnecting", parsed.message ?? m.data);
          } catch {
            setConnection(id, "reconnecting", m.data);
          }
          return;
        }
        try {
          const event = JSON.parse(m.data) as QuantagentEvent;
          ingest(id, [event]);
        } catch (err) {
          setConnection(id, "open", `unreadable frame: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
      onState: (s, err) => setConnection(id, s, err ?? null),
    });
    return stop;
  }, [id, ensure, ingest, setConnection]);

  const status = entry?.state.status;
  const meta = useQuery({
    queryKey: ["launch-meta", id],
    queryFn: () => api.getLaunch(id!),
    enabled: Boolean(id),
    refetchInterval: status === "running" || status === "created" ? 5_000 : 20_000,
  });
  useEffect(() => {
    if (id && meta.data) {
      setMeta(id, meta.data.meta);
      // History from the REST snapshot covers any gap before the stream opened.
      ingest(id, meta.data.events);
    }
  }, [id, meta.data, setMeta, ingest]);

  return entry;
}
