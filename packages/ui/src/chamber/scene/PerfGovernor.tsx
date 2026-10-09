/**
 * Frame-time governor, SPEC §6.7: a rolling frame-time monitor drives the degradation
 * ladder (perf/degradation.ts) and writes the tier into store.settings.perfTier.
 * It also advances runtime.frame, the frame counter the 2-frame flashes use.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useChamberContext } from "./context";
import { FrameTimeMonitor } from "../perf/frameMonitor";
import { initialLadder, stepLadder } from "../perf/degradation";

export function PerfGovernor({ enabled = true }: { enabled?: boolean }) {
  const { store, runtime } = useChamberContext();
  const monitor = useRef(new FrameTimeMonitor(120));
  const ladder = useRef(initialLadder(store.getState().settings.perfTier));
  const last = useRef<number | null>(null);
  const lastCheck = useRef(0);

  useFrame(() => {
    const rt = runtime.current;
    rt.frame++;
    const now = rt.now();
    if (last.current !== null) monitor.current.push(now - last.current);
    last.current = now;
    if (!enabled) return;
    if (now - lastCheck.current < 250) return;
    lastCheck.current = now;
    if (monitor.current.samples < 60) return;
    const next = stepLadder(ladder.current, monitor.current.fps(), now);
    if (next.tier !== ladder.current.tier) {
      store.setSettings({ perfTier: next.tier });
      monitor.current.reset();
    }
    ladder.current = next;
  });
  return null;
}
