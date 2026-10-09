/**
 * Launch.live, SPEC §6.6. ConvergenceSequence runs the timeline (final pulses, core expansion,
 * strand relaxation, onLive at 1800ms); CoreLabels is the persistent CA and site URL beneath
 * the core, typed in from t=1500ms and kept for the life of the coin page.
 */
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useChamberContext } from "../scene/context";
import { Label } from "../scene/Label";
import { useChamber } from "../store";
import { CORE_POSITION } from "../layout";
import { convergenceFrame } from "./timeline";

export interface ConvergenceSequenceProps {
  id: number;
  start: number;
  onLive?: (() => void) | undefined;
  onDone: (id: number) => void;
}

export function ConvergenceSequence({ id, start, onLive, onDone }: ConvergenceSequenceProps) {
  const { runtime } = useChamberContext();
  const lived = useRef(false);
  const finished = useRef(false);
  useFrame(() => {
    const rt = runtime.current;
    const f = convergenceFrame(rt.now() - start);
    if (f.met && rt.core.flashUntilFrame < rt.frame && !lived.current && f.coreRadius < 0.36) rt.core.flashUntilFrame = rt.frame + 1;
    if (f.live && !lived.current) {
      lived.current = true;
      onLive?.();
    }
    if (f.done && !finished.current) {
      finished.current = true;
      onDone(id);
    }
  });
  return null;
}

/** The CA and the site URL beneath the core: typed in by the convergence, then kept. */
export function CoreLabels() {
  const { store, runtime } = useChamberContext();
  const ca = useChamber(store, (s) => (s.core.live ? s.core.ca : undefined));
  const url = useChamber(store, (s) => (s.core.live ? s.core.siteUrl : undefined));
  const caRef = useRef<HTMLSpanElement>(null);
  const urlRef = useRef<HTMLSpanElement>(null);
  const copied = useRef(false);
  useEffect(() => {
    copied.current = false;
  }, [ca]);

  useFrame(() => {
    const rt = runtime.current;
    const at = rt.core.convergenceAt;
    const f = at === undefined ? null : convergenceFrame(rt.now() - at);
    const caTyped = f ? f.caTyped : 1;
    const urlTyped = f ? f.urlTyped : 1;
    if (caRef.current && ca) {
      const t = ca.slice(0, Math.floor(ca.length * caTyped));
      if (caRef.current.textContent !== t) caRef.current.textContent = t;
    }
    if (urlRef.current && url) {
      const t = url.slice(0, Math.floor(url.length * urlTyped));
      if (urlRef.current.textContent !== t) urlRef.current.textContent = t;
    }
  });

  if (!ca) return null;
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(ca);
    } catch {
      /* clipboard unavailable: the text is still selectable in the WorkerSheet / CoinCard */
    }
  };
  return (
    <group name="core-labels">
      <Label position={[CORE_POSITION.x, CORE_POSITION.y - 0.78, CORE_POSITION.z]} color="#F0F4F8" size={11} interactive onClick={copy} title="contract address (tap to copy)" testId="core-ca">
        <span ref={caRef} />
      </Label>
      {url ? (
        <Label position={[CORE_POSITION.x, CORE_POSITION.y - 0.98, CORE_POSITION.z]} color="#4DD0E1" size={11} interactive onClick={() => window.open(url, "_blank", "noopener")} title="site" testId="core-url">
          <span ref={urlRef} />
        </Label>
      ) : null}
    </group>
  );
}
