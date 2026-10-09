/**
 * <Chamber />, SPEC §6: the 3D view of eight workers computing at once. The store is its only
 * input; every visual below is started by an event folded into that store.
 *
 *   mode   idle    vessel, core, vapour, camera drift: the connect / prompt screen
 *          launch  everything: strands, QSD handoff, collapses, convergence
 *          live    same, settled after Launch.live (CA and site URL under the core)
 *          coin    the coin page: long-lived workers pulse on their post-launch progress,
 *                  Chain.decay clouds the core, Chain.measurement replays the collapse
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ACESFilmicToneMapping } from "three";
import { Canvas } from "@react-three/fiber";
import type { QuantumProof, WorkerName } from "@quantagent/core/types";
import type { ChamberStore } from "./store";
import { useChamber } from "./store";
import { ChamberContext, createRuntime, createSequenceStore, type ChamberContextValue } from "./scene/context";
import { SceneFog } from "./scene/Fog";
import { Background } from "./scene/Background";
import { Lights } from "./scene/Lights";
import { Reflections } from "./scene/Reflections";
import { Vessel } from "./scene/Vessel";
import { Core } from "./scene/Core";
import { Vapour } from "./scene/Vapour";
import { CameraRig } from "./scene/CameraRig";
import { PerfGovernor } from "./scene/PerfGovernor";
import { EffectRunner } from "./scene/EffectRunner";
import { VOID, VOID_EDGE } from "./scene/glass";
import { CoreLabels } from "./convergence/Convergence";
import { ChamberSound } from "./sound";
import { perfSettings } from "./perf/degradation";
import { usePrefersReducedMotion } from "./perf/reducedMotion";
import { CAMERA_FOV, CAMERA_POSITION } from "./layout";
import type { LaunchSequenceAdapter } from "./qsd/LaunchSequenceAdapter";
import { eventDrivenLaunchSequence } from "./qsd/EventDrivenLaunchSequence";

const StrandField = lazy(() => import("./strands/StrandField"));
const PostFX = lazy(() => import("./scene/PostFX"));

export type ChamberMode = "idle" | "launch" | "live" | "coin";

export interface ChamberProps {
  mode: ChamberMode;
  store: ChamberStore;
  /** A strand or anchor was tapped (44px hit area): open its WorkerSheet. */
  onTapWorker?: ((worker: WorkerName) => void) | undefined;
  /** The proof hash beside a bead (or the core) was tapped: open the proof bundle. */
  onTapProof?: ((worker: WorkerName | "core", proof: QuantumProof) => void) | undefined;
  /** Launch.live + 1800ms: slide the CoinCard up. */
  onLive?: (() => void) | undefined;
  /** Procedural Web Audio. Off by default; enabling needs a user gesture, which the chamber takes from its first tap. */
  sound?: boolean | undefined;
  /** Override prefers-reduced-motion. */
  reducedMotion?: boolean | undefined;
  /** The QSD launch sequence to host inside the render loop (default: event-driven, see qsd/). */
  launchSequence?: LaunchSequenceAdapter | undefined;
  /** Disable the frame-time governor (tests, Storybook). */
  governor?: boolean | undefined;
  /**
   * "spec" (default): camera (0,1.2,7.5) looking at (0,0.4,0), fov 38, verbatim from SPEC §6.2; on a
   * 390px-wide portrait frame the outer tier and six of the eight anchors sit outside the frame.
   * "fit": keep fov and elevation, aim at the vessel's middle and pull back until the plate, the
   * anchor ring and the core are all in frame (layout.fitFraming).
   */
  framing?: "spec" | "fit" | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

export function Chamber({ mode, store, onTapWorker, onTapProof, onLive, sound = false, reducedMotion, launchSequence, governor = true, framing = "spec", className, style }: ChamberProps) {
  const prefersReduced = usePrefersReducedMotion(reducedMotion);
  const perfTier = useChamber(store, (s) => s.settings.perfTier);
  const perf = useMemo(() => perfSettings(perfTier), [perfTier]);
  const runtime = useRef(createRuntime());
  const sequences = useMemo(() => createSequenceStore(), []);
  const soundRef = useRef<ChamberSound | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [strandsReady, setStrandsReady] = useState(mode !== "idle");
  const [postReady, setPostReady] = useState(false);

  useEffect(() => {
    store.setSettings({ reducedMotion: prefersReduced });
  }, [store, prefersReduced]);

  // strands and post-processing stream in behind the first frame (vessel + core first)
  useEffect(() => {
    if (mode === "idle") return;
    let raf = 0;
    let t = 0;
    raf = requestAnimationFrame(() => {
      setStrandsReady(true);
      t = window.setTimeout(() => setPostReady(true), 400);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [mode]);
  useEffect(() => {
    if (mode !== "idle") return;
    const t = window.setTimeout(() => setPostReady(true), 600);
    return () => window.clearTimeout(t);
  }, [mode]);

  // sound: created on demand, enabled from the first gesture, disposed on unmount
  useEffect(() => {
    if (!sound) {
      soundRef.current?.disable();
      setSoundOn(false);
      return;
    }
    soundRef.current ??= new ChamberSound();
    return () => {
      soundRef.current?.disable();
    };
  }, [sound]);
  const onFirstGesture = () => {
    if (sound && soundRef.current && !soundRef.current.enabled) {
      soundRef.current.enable();
      setSoundOn(soundRef.current.enabled);
    }
  };

  const Sequence = (launchSequence ?? eventDrivenLaunchSequence).Sequence;
  const qsd = useChamber(store, (s) => s.qsd);
  const showQsd = mode !== "idle" && qsd.stage !== undefined && !qsd.skipped;

  const ctx: ChamberContextValue = useMemo(
    () => ({
      store,
      runtime,
      perf,
      reducedMotion: prefersReduced,
      framing,
      sound: sound && soundOn ? soundRef.current : null,
      sequences,
      onTapWorker,
      onTapProof,
    }),
    [store, perf, prefersReduced, framing, sound, soundOn, sequences, onTapWorker, onTapProof],
  );

  // a full-width desktop hero at 2× is four times the pixels of a phone; 1.5× keeps the glass
  // sharp there without pushing the frame-time governor into stripping the look
  const maxDpr = typeof window !== "undefined" && window.innerWidth > 900 ? 1.5 : 2;
  const background = `radial-gradient(ellipse at 50% 45%, ${VOID} 0%, ${VOID} 40%, ${VOID_EDGE} 100%)`;

  return (
    <div
      className={className}
      data-chamber-mode={mode}
      data-perf-tier={perf.tier}
      data-reduced-motion={prefersReduced ? "true" : "false"}
      data-framing={framing}
      onPointerDown={onFirstGesture}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 320, overflow: "hidden", background, touchAction: "manipulation", ...style }}
    >
      <ChamberContext.Provider value={ctx}>
        <Canvas
          gl={{ antialias: false, alpha: false, powerPreference: "high-performance", stencil: false, depth: true }}
          dpr={[1, maxDpr]}
          camera={{ fov: CAMERA_FOV, position: CAMERA_POSITION.toArray(), near: 0.1, far: 60 }}
          frameloop="always"
          flat={false}
          onCreated={({ gl }) => {
            gl.transmissionResolutionScale = 0.5;
            gl.toneMapping = ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
            gl.setClearColor(VOID, 1);
          }}
          style={{ position: "absolute", inset: 0 }}
        >
          <ChamberContext.Provider value={ctx}>
            <SceneFog />
            <Background />
            <Lights />
            <Suspense fallback={null}>
              <Reflections />
            </Suspense>
            <CameraRig />
            <PerfGovernor enabled={governor} />
            <Vessel />
            <Core />
            <Vapour />
            <EffectRunner onLive={onLive} />
            <CoreLabels />
            {strandsReady ? (
              <Suspense fallback={null}>
                <StrandField />
              </Suspense>
            ) : null}
            {showQsd ? <Sequence qsd={qsd} reducedMotion={prefersReduced} /> : null}
            {postReady ? (
              <Suspense fallback={null}>
                <PostFX />
              </Suspense>
            ) : null}
          </ChamberContext.Provider>
        </Canvas>
      </ChamberContext.Provider>
      <ChamberStatus store={store} />
    </div>
  );
}

/** Visually hidden, honest text for assistive tech: what the chamber is showing right now. */
function ChamberStatus({ store }: { store: ChamberStore }) {
  const phase = useChamber(store, (s) => s.phase);
  const running = useChamber(store, (s) => Object.values(s.strands).filter((x) => x.status === "running" || x.status === "candidates").length);
  const done = useChamber(store, (s) => Object.values(s.strands).filter((x) => x.status === "done").length);
  const failed = useChamber(store, (s) => Object.values(s.strands).filter((x) => x.status === "failed").length);
  const text =
    phase === "idle"
      ? "Chamber idle: nothing is computing."
      : `Chamber ${phase}: ${running} workers running, ${done} done, ${failed} failed.`;
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="chamber-status"
      style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}
    >
      {text}
    </span>
  );
}
