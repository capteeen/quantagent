/**
 * Ignition, SPEC §6.3: on Launch.started each strand grows core→anchor over 900ms with a
 * bright head particle and 30 instanced trailing sparks. Simultaneous ignition is the thesis.
 */
import { useEffect, useMemo, useRef } from "react";
import { InstancedMesh, Matrix4, Mesh, Quaternion, SphereGeometry, Vector3, type CatmullRomCurve3 } from "three";
import { useFrame } from "@react-three/fiber";
import { WORKER_COLORS, type WorkerName } from "@quantagent/core/types";
import { useChamberContext } from "../scene/context";
import { ACTIVE_EMISSIVE, makeLight } from "../scene/glass";
import { hashString, seeded, useDisposable } from "../perf/dispose";
import { MS, ease } from "../motion";

export const SPARKS = 30;
const SPARK_TAIL = 0.14;

export function Ignition({ worker, curve }: { worker: WorkerName; curve: CatmullRomCurve3 }) {
  const { runtime, perf } = useChamberContext();
  const color = WORKER_COLORS[worker];
  const headGeometry = useDisposable(() => new SphereGeometry(0.05, 12, 8), []);
  const headMaterial = useDisposable(() => makeLight(ACTIVE_EMISSIVE, 3), []);
  const sparkGeometry = useDisposable(() => new SphereGeometry(0.012, 6, 4), []);
  const sparkMaterial = useDisposable(() => makeLight(color, 2, { transparent: true, opacity: 1, additive: true }), [color]);
  const sparks = useMemo(() => {
    const im = new InstancedMesh(sparkGeometry, sparkMaterial, perf.sparkCount);
    im.frustumCulled = false;
    im.visible = false;
    return im;
  }, [sparkGeometry, sparkMaterial, perf.sparkCount]);
  useEffect(() => () => sparks.dispose(), [sparks]);
  const offsets = useMemo(() => {
    const rnd = seeded(hashString(worker + ":sparks"));
    return Array.from({ length: perf.sparkCount }, () => ({ back: rnd() * SPARK_TAIL, jx: (rnd() - 0.5) * 0.08, jy: (rnd() - 0.5) * 0.08, jz: (rnd() - 0.5) * 0.08 }));
  }, [worker, perf.sparkCount]);
  const head = useRef<Mesh>(null);
  const scratch = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), s: new Vector3(), p: new Vector3() }), []);

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const at = rt.strands[worker].ignitedAt;
    const h = head.current;
    if (!h) return;
    const elapsed = at === undefined ? Infinity : now - at;
    const active = elapsed <= MS.ignite + 250;
    h.visible = active;
    sparks.visible = active;
    if (!active) return;
    const t = ease(Math.min(1, elapsed / MS.ignite));
    curve.getPointAt(t, h.position);
    const fade = elapsed > MS.ignite ? 1 - (elapsed - MS.ignite) / 250 : 1;
    h.scale.setScalar(Math.max(0.0001, fade));
    const { m, q, s, p } = scratch;
    for (let i = 0; i < perf.sparkCount; i++) {
      const o = offsets[i]!;
      const tt = Math.max(0, t - o.back);
      curve.getPointAt(tt, p);
      p.x += o.jx;
      p.y += o.jy;
      p.z += o.jz;
      s.setScalar(Math.max(0.0001, fade * (1 - o.back / SPARK_TAIL) * 1.2));
      m.compose(p, q, s);
      sparks.setMatrixAt(i, m);
    }
    sparks.instanceMatrix.needsUpdate = true;
    sparkMaterial.opacity = fade * rt.fx.brightness;
  });

  return (
    <group name={`ignition-${worker}`}>
      <mesh ref={head} geometry={headGeometry} material={headMaterial} visible={false} renderOrder={28} />
      <primitive object={sparks} />
    </group>
  );
}
