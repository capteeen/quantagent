/**
 * A STRAND, SPEC §6.3: one worker as a tube of light (TubeGeometry on a CatmullRom curve,
 * radius 0.025, 64 segments) spiralling from the core to its anchor on the outermost cylinder.
 *
 *   ignition   Launch.started: grows core→anchor over 900ms (drawRange), bright head, 30 sparks
 *   pulses     one bright packet core→anchor at 1.5 units/s per Worker.progress event
 *   looks      running / awaiting approval (amber breathe 0.8s) / candidates (fan) /
 *              done (locks solid) / failed (desaturates to #3A4049 over 1.2s, one red
 *              pulse anchor→core, the anchor cracks)
 *   tap        44px hit area; this strand brightens 1.5×, the others dim to 0.6×
 */
import { useEffect, useMemo, useRef } from "react";
import { Color, Mesh, TubeGeometry } from "three";
import { useFrame } from "@react-three/fiber";
import { useStore } from "zustand";
import { WORKER_COLORS, type WorkerName } from "@quantagent/core/types";
import { useChamberContext } from "../scene/context";
import { Label } from "../scene/Label";
import { AMBER, FAILED, makeLight } from "../scene/glass";
import { useChamber } from "../store";
import { useDisposable } from "../perf/dispose";
import { STRAND_RADIAL_SEGMENTS, STRAND_RADIUS, STRAND_SEGMENTS, strandCurve } from "../layout";
import { MS, ease } from "../motion";
import { CONVERGENCE } from "../convergence/timeline";
import { FAN_SPLIT_T } from "../collapse/fan";
import { CandidateFan } from "../collapse/CandidateFan";
import { Anchor } from "./Anchor";
import { Ignition } from "./Ignition";
import { PulseStream } from "./Pulses";

const INTENSITY = { running: 1.6, candidates: 1.4, done: 1.5, awaiting: 1.1, failed: 0.5, relaxed: 1.0 } as const;

export interface StrandProps {
  worker: WorkerName;
}

export function Strand({ worker }: StrandProps) {
  const { store, runtime, reducedMotion, onTapWorker, onTapProof, sequences } = useChamberContext();
  const strand = useChamber(store, (s) => s.strands[worker]);
  const collapsing = useStore(sequences, (s) => s.collapses[worker] !== undefined);
  const color = WORKER_COLORS[worker];
  const curve = useMemo(() => strandCurve(worker), [worker]);
  const length = useMemo(() => curve.getLength(), [curve]);

  const geometry = useDisposable(() => new TubeGeometry(curve, STRAND_SEGMENTS, STRAND_RADIUS, STRAND_RADIAL_SEGMENTS, false), [curve]);
  const material = useDisposable(() => makeLight(color, INTENSITY.running), [color]);
  const hitGeometry = useDisposable(() => new TubeGeometry(curve, 32, 0.14, 6, false), [curve]);
  const hitMaterial = useDisposable(() => {
    const m = makeLight("#000000", 0, { transparent: true, opacity: 0 });
    m.colorWrite = false;
    m.depthWrite = false;
    return m;
  }, []);
  const mesh = useRef<Mesh>(null);
  const tmpColor = useMemo(() => new Color(), []);
  const lastNow = useRef<number | null>(null);

  // the runtime mirrors event-driven moments the looks need (done / failed times)
  useEffect(() => {
    const rt = runtime.current;
    const s = rt.strands[worker];
    if (strand.sealed && s.doneAt === undefined) s.doneAt = rt.now();
    if (strand.failed && s.failedAt === undefined) s.failedAt = rt.now();
  }, [runtime, worker, strand.sealed, strand.failed]);

  const fanOpen = strand.status === "candidates" || strand.collapseUnavailable !== undefined || collapsing;

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const s = rt.strands[worker];
    const m = mesh.current;
    if (!m) return;
    const dt = lastNow.current === null ? 0 : Math.min(0.1, (now - lastNow.current) / 1000);
    lastNow.current = now;

    // selection factor eases over 700ms
    const selected = store.getState().selected;
    const target = selected === undefined ? 1 : selected === worker ? 1.5 : 0.6;
    s.selectFactor += (target - s.selectFactor) * Math.min(1, dt * (1000 / MS.min) * 3);

    // ignition: grow core→anchor over 900ms
    if (s.ignitedAt === undefined) {
      m.visible = false;
      return;
    }
    m.visible = true;
    const grow = ease(Math.min(1, (now - s.ignitedAt) / MS.ignite));
    const total = geometry.index ? geometry.index.count : 0;
    const perSeg = Math.max(1, Math.floor(total / STRAND_SEGMENTS));
    // while a fan is open the tube stops at the split point; the snap restores the full tube
    let visibleT = grow;
    const c = s.collapse;
    if (fanOpen && !(c && c.snapFrame !== undefined)) visibleT = Math.min(grow, FAN_SPLIT_T);
    geometry.setDrawRange(0, Math.min(total, Math.ceil(visibleT * STRAND_SEGMENTS) * perSeg));

    // the look
    let intensity: number = INTENSITY.running;
    let hex: string = color;
    switch (strand.status) {
      case "awaitingApproval": {
        const breathe = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin((now / MS.approvalBreathe) * Math.PI * 2);
        tmpColor.set(color).lerp(new Color(AMBER), 0.7);
        intensity = INTENSITY.awaiting + 0.6 * breathe;
        hex = "#" + tmpColor.getHexString();
        break;
      }
      case "candidates":
        intensity = INTENSITY.candidates;
        break;
      case "done":
        intensity = INTENSITY.done;
        break;
      case "failed": {
        const t = s.failedAt === undefined ? 1 : ease(Math.min(1, (now - s.failedAt) / MS.fail));
        tmpColor.set(color).lerp(new Color(FAILED), t);
        hex = "#" + tmpColor.getHexString();
        intensity = INTENSITY.running + (INTENSITY.failed - INTENSITY.running) * t;
        break;
      }
      default:
        intensity = INTENSITY.running;
    }
    if (s.relaxed && strand.status !== "failed") {
      intensity = INTENSITY.relaxed + (reducedMotion ? 0 : 0.3 * Math.sin((now / MS.corePulse) * Math.PI * 2));
    }
    if (c && c.snapFrame !== undefined && rt.frame - c.snapFrame < 6) intensity *= 1.6;
    material.color.set(hex).multiplyScalar(intensity * rt.fx.brightness * s.selectFactor);

    // Launch.live relaxation starts at +1500ms
    if (rt.core.convergenceAt !== undefined && now - rt.core.convergenceAt >= CONVERGENCE.typeStart) s.relaxed = true;
  });

  const tap = () => {
    store.select(store.getState().selected === worker ? undefined : worker);
    onTapWorker?.(worker);
  };
  const proof = strand.proof;
  const proofTap = proof && onTapProof ? () => onTapProof(worker, proof) : undefined;
  const anchorPoint = useMemo(() => curve.getPointAt(1), [curve]);

  return (
    <group name={`strand-${worker}`}>
      <mesh ref={mesh} geometry={geometry} material={material} renderOrder={24} frustumCulled={false} />
      <mesh
        geometry={hitGeometry}
        material={hitMaterial}
        onClick={(e) => {
          e.stopPropagation();
          tap();
        }}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      />
      <Ignition worker={worker} curve={curve} />
      <PulseStream worker={worker} curve={curve} length={length} />
      <Anchor worker={worker} strand={strand} onTap={tap} />
      {fanOpen ? <CandidateFan worker={worker} candidates={strand.candidates} unavailable={strand.collapseUnavailable} onTapCandidate={tap} /> : null}
      {proof && !collapsing && !fanOpen ? (
        <Label position={[anchorPoint.x, anchorPoint.y - 0.16, anchorPoint.z]} color="#4DD0E1" size={11} interactive={!!proofTap} onClick={proofTap} title="quantum proof bundle" testId={`proof-${worker}`}>
          {proof.drawHash.slice(0, 12)}
        </Label>
      ) : null}
    </group>
  );
}
