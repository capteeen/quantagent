/**
 * The EffectRunner drains the store's transient effect queue (every entry came from one event)
 * and STARTS transitions: it stamps the runtime with start times and mounts the sequences that
 * need React (the collapse, with its DOM proof hash; the convergence, with its callbacks).
 * It also resets the per-frame fx accumulators before any sequence writes them.
 */
import { useEffect, useMemo, useState } from "react";
import { Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { WORKER_NAMES, type WorkerName } from "@quantagent/core/types";
import { useChamberContext, type ActiveCollapse } from "./context";
import { useStore } from "zustand";
import type { ChamberEffect } from "../types";
import { CAMERA_DISTANCE_FAR, CAMERA_DISTANCE_NEAR, CORE_POSITION, anchorPosition, workerIndex } from "../layout";
import { MS } from "../motion";
import { CollapseSequence } from "../collapse/CollapseSequence";
import { fanGhosts } from "../collapse/fan";
import { ConvergenceSequence } from "../convergence/Convergence";

export interface EffectRunnerProps {
  onLive?: (() => void) | undefined;
}

export function EffectRunner({ onLive }: EffectRunnerProps) {
  const { store, runtime, sequences, sound } = useChamberContext();
  const [, bump] = useState(0);
  const collapses = useStore(sequences, (s) => s.collapses);
  const coreCollapse = useStore(sequences, (s) => s.coreCollapse);
  const convergence = useStore(sequences, (s) => s.convergence);

  useEffect(() => {
    const start = (e: ChamberEffect) => {
      const rt = runtime.current;
      const now = rt.now();
      const state = store.getState();
      switch (e.kind) {
        case "ignition": {
          // all eight within 100ms: the same instant
          for (const w of WORKER_NAMES) {
            if (state.strands[w].ignited && rt.strands[w].ignitedAt === undefined) rt.strands[w].ignitedAt = now;
          }
          break;
        }
        case "ringFlash":
          if (e.worker) {
            rt.fx.ringFlash[e.worker] = now;
            rt.strands[e.worker].doneAt = now;
          }
          break;
        case "failPulse":
          if (e.worker) {
            rt.fx.failPulse[e.worker] = now;
            rt.strands[e.worker].failedAt = now;
          }
          break;
        case "dollyIn":
          rt.fx.dolly = { from: rt.fx.distance, to: CAMERA_DISTANCE_NEAR, start: now, duration: MS.dolly };
          break;
        case "dollyOut":
          rt.fx.dolly = { from: rt.fx.distance, to: CAMERA_DISTANCE_FAR, start: now, duration: MS.dolly };
          break;
        case "collapse": {
          if (!e.worker) break;
          const active: ActiveCollapse = { id: e.id, start: now, shower: e.shower, framesSinceSnap: 0, ...(e.chosen ? { chosen: e.chosen } : {}), ...(e.proof ? { proof: e.proof } : {}) };
          rt.strands[e.worker].collapse = active;
          const s = sequences.getState();
          s.set({ collapses: { ...s.collapses, [e.worker]: active } });
          break;
        }
        case "coreCollapse": {
          const active: ActiveCollapse = { id: e.id, start: now, shower: e.shower, framesSinceSnap: 0, ...(e.proof ? { proof: e.proof } : {}) };
          rt.core.collapse = active;
          sequences.getState().set({ coreCollapse: active });
          break;
        }
        case "convergence": {
          rt.core.convergenceAt = now;
          for (const w of WORKER_NAMES) {
            if (state.strands[w].sealed && !state.strands[w].failed) rt.strands[w].finalPulseAt = now;
          }
          sequences.getState().set({ convergence: { id: e.id, start: now } });
          break;
        }
      }
    };
    const drain = () => {
      const pending = store.takeEffects();
      if (pending.length === 0) return;
      for (const e of pending) start(e);
      bump((n) => n + 1);
    };
    drain();
    const unsub = store.subscribe((s, prev) => {
      if (s.effects !== prev.effects && s.effects.length > 0) drain();
    });
    return unsub;
  }, [store, runtime, sequences]);

  // per-frame reset of the accumulators the sequences write, and the sound's activity level
  useFrame(() => {
    const rt = runtime.current;
    rt.fx.brightness = 1;
    rt.fx.aberration = 0;
    if (sound && rt.frame % 30 === 0) {
      const st = store.getState();
      let active = 0;
      for (const w of WORKER_NAMES) {
        const s = st.strands[w];
        if (s.status === "running" || s.status === "candidates") active++;
      }
      sound.setActivity(active / WORKER_NAMES.length);
    }
  }, -10);

  const focusFor = useMemo(() => {
    return (worker: WorkerName, active: ActiveCollapse): Vector3 => {
      const strand = store.getState().strands[worker];
      const chosenId = active.chosen?.id;
      if (chosenId && strand.candidates.length) {
        const ghost = fanGhosts(worker, strand.candidates).find((g) => g.candidate.id === chosenId);
        if (ghost) return ghost.bead.clone();
      }
      return anchorPosition(workerIndex(worker));
    };
  }, [store]);

  const endCollapse = (worker: WorkerName) => (id: number) => {
    const s = sequences.getState();
    if (s.collapses[worker]?.id !== id) return;
    const next = { ...s.collapses };
    delete next[worker];
    runtime.current.strands[worker].collapse = undefined;
    s.set({ collapses: next });
  };
  const endCore = (id: number) => {
    const s = sequences.getState();
    if (s.coreCollapse?.id !== id) return;
    runtime.current.core.collapse = undefined;
    s.set({ coreCollapse: undefined });
  };
  const endConvergence = (id: number) => {
    const s = sequences.getState();
    if (s.convergence?.id !== id) return;
    s.set({ convergence: undefined });
  };

  return (
    <group name="effects">
      {(Object.keys(collapses) as WorkerName[]).map((w) => {
        const active = collapses[w];
        if (!active) return null;
        return <CollapseSequence key={active.id} target={w} active={active} focus={focusFor(w, active)} onDone={endCollapse(w)} />;
      })}
      {coreCollapse ? <CollapseSequence key={coreCollapse.id} target="core" active={coreCollapse} focus={CORE_POSITION} onDone={endCore} /> : null}
      {convergence ? <ConvergenceSequence key={convergence.id} id={convergence.id} start={convergence.start} onLive={onLive} onDone={endConvergence} /> : null}
    </group>
  );
}
