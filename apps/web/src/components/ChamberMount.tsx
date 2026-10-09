"use client";
/**
 * Mounts THE CHAMBER from @quantagent/ui/chamber behind a dynamic import (three
 * and r3f are browser-only). Its store is fed only from the launch's event log:
 * events already known at mount are folded silently, later ones play as effects.
 * If the module or WebGL fails, the real error is shown; nothing is animated.
 */
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type { QuantagentEvent, QuantumProof, WorkerName } from "@quantagent/core/types";
import type { ChamberMode, ChamberStore } from "@quantagent/ui/chamber";
import { EmptyState } from "@quantagent/ui/kit";

type ChamberModule = typeof import("@quantagent/ui/chamber");

export interface ChamberMountProps {
  mode: ChamberMode;
  events: readonly QuantagentEvent[];
  onTapWorker?: ((worker: WorkerName) => void) | undefined;
  onTapProof?: ((worker: WorkerName | "core", proof: QuantumProof) => void) | undefined;
  onLive?: (() => void) | undefined;
  sound?: boolean | undefined;
}

class Boundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  override componentDidCatch(err: unknown, _info: ErrorInfo) {
    this.props.onError(err instanceof Error ? err.message : String(err));
  }
  override render() {
    if (this.state.error) return <EmptyState failed title="The chamber failed to render." detail={this.state.error} />;
    return this.props.children;
  }
}

export function ChamberMount({ mode, events, onTapWorker, onTapProof, onLive, sound }: ChamberMountProps) {
  const [mod, setMod] = useState<ChamberModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const primed = useRef(false);

  useEffect(() => {
    let alive = true;
    import("@quantagent/ui/chamber")
      .then((m) => {
        if (alive) setMod(m);
      })
      .catch((err: unknown) => {
        if (alive) setError(`chamber unavailable: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  const store: ChamberStore | null = useMemo(() => (mod ? mod.createChamberStore() : null), [mod]);

  useEffect(() => {
    if (!store) return;
    const applied = store.getState().lastSeq;
    const fresh = events.filter((e) => e.seq > applied);
    if (fresh.length === 0) {
      primed.current = true;
      return;
    }
    store.applyMany(fresh, { silent: !primed.current });
    primed.current = true;
  }, [store, events]);

  return (
    <div data-testid="chamber" data-mode={mode} className="relative h-[46vh] min-h-[300px] w-full overflow-hidden rounded-2xl border border-border bg-void-radial">
      {error ? (
        <div className="p-3">
          <EmptyState failed title="The chamber is unavailable." detail={error} />
        </div>
      ) : !mod || !store ? (
        <div className="flex h-full items-center justify-center text-xs text-muted" aria-busy="true">
          loading the chamber…
        </div>
      ) : (
        <Boundary onError={setError}>
          <mod.Chamber mode={mode} store={store} framing="fit" onTapWorker={onTapWorker} onTapProof={onTapProof} onLive={onLive} sound={sound} className="h-full w-full" />
        </Boundary>
      )}
    </div>
  );
}
