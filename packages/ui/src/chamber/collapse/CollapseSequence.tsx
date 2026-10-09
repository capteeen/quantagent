/**
 * The collapse sequence, SPEC §6.4, mounted by the EffectRunner for each Orchestrator.collapsed
 * (on a strand's fan) or for a QSD draw / Chain.measurement (on the core). It samples the pure
 * timeline each frame and writes brightness, aberration, the core flash and the snap into the
 * runtime; it draws the beam, the 120 photon sprites, the torus ring and the typed proof hash.
 * It is the only animation that snaps. Nothing else may use these effects.
 */
import { useEffect, useMemo, useRef } from "react";
import { CylinderGeometry, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, TorusGeometry, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import type { WorkerName } from "@quantagent/core/types";
import { useChamberContext, type ActiveCollapse } from "../scene/context";
import { Label } from "../scene/Label";
import { makeLight } from "../scene/glass";
import { seeded, useDisposable } from "../perf/dispose";
import { CORE_POSITION, PLATE_Y } from "../layout";
import { COLLAPSE, collapseFrame, ringAt } from "./timeline";

const PROBABILITY = "#4DD0E1";

export interface CollapseSequenceProps {
  target: WorkerName | "core";
  active: ActiveCollapse;
  /** Where the fan's chosen bead (or the core) is: beam origin is always the core. */
  focus: Vector3;
  onDone: (id: number) => void;
}

export function CollapseSequence({ target, active, focus, onDone }: CollapseSequenceProps) {
  const { runtime, reducedMotion, sound, onTapProof } = useChamberContext();

  const beamGeometry = useDisposable(() => new CylinderGeometry(0.03, 0.05, 1, 8, 1, true), []);
  const beamMaterial = useDisposable(() => makeLight("#ffffff", 3, { transparent: true, opacity: 0, additive: true }), []);
  const photonGeometry = useDisposable(() => new PlaneGeometry(0.012, 0.012 * 5), []);
  const photonMaterial = useDisposable(() => makeLight("#ffffff", 2.5, { transparent: true, opacity: 0, additive: true }), []);
  const ringGeometry = useDisposable(() => new TorusGeometry(1, 0.012, 8, 72), []);
  const ringMaterial = useDisposable(() => makeLight("#ffffff", 3, { transparent: true, opacity: 0, additive: true }), []);
  const photons = useMemo(() => {
    const im = new InstancedMesh(photonGeometry, photonMaterial, COLLAPSE.photonCount);
    im.frustumCulled = false;
    return im;
  }, [photonGeometry, photonMaterial]);
  useEffect(() => () => photons.dispose(), [photons]);

  // seeded start offsets for the 120 photons: a cloud above the vessel converging on the focus
  const offsets = useMemo(() => {
    const rnd = seeded(0x9e3779b9 ^ active.id);
    const arr: { x: number; z: number; delay: number }[] = [];
    for (let i = 0; i < COLLAPSE.photonCount; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.4 + rnd() * 1.4;
      arr.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, delay: rnd() * 0.25 });
    }
    return arr;
  }, [active.id]);

  const beam = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const hashRef = useRef<HTMLSpanElement>(null);
  const toneDone = useRef(false);
  const finished = useRef(false);
  const hash = active.proof?.drawHash ?? "";

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    if (active.snapFrame !== undefined) active.framesSinceSnap = rt.frame - active.snapFrame;
    const f = collapseFrame(now - active.start, { reducedMotion, shower: active.shower, framesSinceSnap: active.framesSinceSnap });

    rt.fx.brightness = Math.min(rt.fx.brightness, f.brightness);
    rt.fx.aberration = Math.max(rt.fx.aberration, f.aberration);

    // the snap: one frame, core flash for two, the C6 tone
    if (f.snapped && active.snapFrame === undefined) {
      active.snapFrame = rt.frame;
      active.framesSinceSnap = 0;
      rt.core.flashUntilFrame = rt.frame + COLLAPSE.coreFlashFrames - 1;
      if (!toneDone.current) {
        toneDone.current = true;
        sound?.collapse();
      }
    }

    // beam: leaves the core upward and out of frame
    if (beam.current) {
      if (f.beam !== null) {
        const len = PLATE_Y + 6;
        beam.current.visible = true;
        beam.current.position.set(CORE_POSITION.x, CORE_POSITION.y + (len / 2) * Math.min(1, f.beam * 1.4), CORE_POSITION.z);
        beam.current.scale.set(1, len * Math.min(1, f.beam * 1.4), 1);
        beamMaterial.opacity = 0.9 * (1 - f.beam * f.beam);
      } else beam.current.visible = false;
    }

    // photon shower: 120 sprites, short additive trails, falling onto the focus
    if (f.shower !== null) {
      photons.visible = true;
      photonMaterial.opacity = 1;
      const m = new Matrix4();
      const q = new Quaternion();
      const s = new Vector3(1, 1, 1);
      const p = new Vector3();
      const top = PLATE_Y + 1.5;
      for (let i = 0; i < COLLAPSE.photonCount; i++) {
        const o = offsets[i]!;
        const t = Math.max(0, Math.min(1, (f.shower - o.delay) / (1 - o.delay)));
        const tt = t * t;
        p.set(focus.x + o.x * (1 - tt), top + (focus.y - top) * tt, focus.z + o.z * (1 - tt));
        s.set(1, 1 + 3 * (1 - t), 1);
        m.compose(p, q, s);
        photons.setMatrixAt(i, m);
      }
      photons.instanceMatrix.needsUpdate = true;
    } else {
      photons.visible = false;
    }

    // the ring from the bead
    if (ring.current) {
      if (f.ring !== null) {
        const r = ringAt(f.ring);
        ring.current.visible = true;
        ring.current.position.copy(focus);
        ring.current.scale.setScalar(r.radius);
        ringMaterial.opacity = r.opacity;
      } else ring.current.visible = false;
    }

    // the hash types in character by character
    if (hashRef.current) {
      const n = Math.floor(hash.length * f.hashTyped);
      const text = hash.slice(0, n);
      if (hashRef.current.textContent !== text) hashRef.current.textContent = text;
    }

    if (f.done && !finished.current) {
      finished.current = true;
      onDone(active.id);
    }
  });

  const labelPos: [number, number, number] = [focus.x, focus.y - (target === "core" ? 0.5 : 0.11), focus.z];
  const proof = active.proof;
  const tap = proof && onTapProof ? () => onTapProof(target, proof) : undefined;

  return (
    <group name={`collapse-${target}`}>
      <mesh ref={beam} geometry={beamGeometry} material={beamMaterial} visible={false} renderOrder={40} />
      <primitive object={photons} />
      <mesh ref={ring} geometry={ringGeometry} material={ringMaterial} visible={false} rotation={[Math.PI / 2, 0, 0]} renderOrder={41} />
      {proof ? (
        <Label position={labelPos} color={PROBABILITY} size={11} interactive={!!tap} onClick={tap} title="quantum proof bundle" testId={`proof-${target}`}>
          <span ref={hashRef} />
        </Label>
      ) : null}
    </group>
  );
}
