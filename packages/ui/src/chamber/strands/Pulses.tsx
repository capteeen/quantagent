/**
 * Pulses, SPEC §6.3: bright packets core→anchor at 1.5 units/s, exactly one per
 * Worker.progress event (the store's pulse counter is the source; this never invents one).
 * Also carries the reverse packets: the red failure pulse anchor→core (Worker.failed) and the
 * final convergence pulse anchor→core that meets at 900ms (Launch.live).
 */
import { useEffect, useMemo } from "react";
import { InstancedMesh, Matrix4, Quaternion, SphereGeometry, Vector3, type CatmullRomCurve3 } from "three";
import { useFrame } from "@react-three/fiber";
import { WORKER_COLORS, type WorkerName } from "@quantagent/core/types";
import { useChamberContext } from "../scene/context";
import { ACTIVE_EMISSIVE, makeLight } from "../scene/glass";
import { useDisposable } from "../perf/dispose";
import { SPEED, ease } from "../motion";
import { CONVERGENCE } from "../convergence/timeline";

/** Packets in flight at once per strand; a burst beyond this queues (never dropped). */
export const MAX_PACKETS = 48;
const RED = "#FF3B30";

export function PulseStream({ worker, curve, length }: { worker: WorkerName; curve: CatmullRomCurve3; length: number }) {
  const { store, runtime } = useChamberContext();
  const color = WORKER_COLORS[worker];
  const geometry = useDisposable(() => new SphereGeometry(0.045, 10, 8), []);
  const material = useDisposable(() => makeLight(color, 3), [color]);
  const redMaterial = useDisposable(() => makeLight(RED, 4), []);
  const whiteMaterial = useDisposable(() => makeLight(ACTIVE_EMISSIVE, 5), []);
  const packets = useMemo(() => {
    const im = new InstancedMesh(geometry, material, MAX_PACKETS);
    im.frustumCulled = false;
    im.count = 0;
    return im;
  }, [geometry, material]);
  const reverse = useMemo(() => {
    const im = new InstancedMesh(geometry, redMaterial, 2);
    im.frustumCulled = false;
    im.count = 0;
    return im;
  }, [geometry, redMaterial]);
  useEffect(
    () => () => {
      packets.dispose();
      reverse.dispose();
    },
    [packets, reverse],
  );
  const inFlight = useMemo<number[]>(() => [], []);
  const scratch = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), s: new Vector3(1, 1, 1), p: new Vector3() }), []);
  const travelMs = (length / SPEED.pulse) * 1000;

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const s = rt.strands[worker];
    const { m, q, p } = scratch;
    const sc = scratch.s;

    // spawn one packet per new Worker.progress (pulses counter), never more, never fewer
    const want = store.getState().strands[worker].pulses;
    while (s.consumedPulses < want) {
      s.pulseSpawns.push(now);
      s.consumedPulses++;
    }
    if (s.ignitedAt !== undefined) {
      while (inFlight.length < MAX_PACKETS && s.pulseSpawns.length > 0) inFlight.push(s.pulseSpawns.shift()!);
    }
    // advance, retire the ones that arrived (anchor glow)
    let n = 0;
    for (let i = inFlight.length - 1; i >= 0; i--) {
      const t = (now - inFlight[i]!) / travelMs;
      if (t >= 1) {
        inFlight.splice(i, 1);
        s.arrived++;
        continue;
      }
      curve.getPointAt(Math.max(0, t), p);
      sc.setScalar(1);
      m.compose(p, q, sc);
      packets.setMatrixAt(n++, m);
    }
    packets.count = n;
    if (n > 0) packets.instanceMatrix.needsUpdate = true;
    material.color.set(color).multiplyScalar(3 * rt.fx.brightness * s.selectFactor);

    // reverse packets: failure (red, 1.5 u/s) and the final convergence pulse (white, meets at 900ms)
    let r = 0;
    const failAt = rt.fx.failPulse[worker];
    if (failAt !== undefined) {
      const t = (now - failAt) / travelMs;
      if (t >= 1) delete rt.fx.failPulse[worker];
      else {
        curve.getPointAt(1 - Math.max(0, t), p);
        sc.setScalar(1.1);
        m.compose(p, q, sc);
        reverse.setMatrixAt(r++, m);
        reverse.material = redMaterial;
      }
    }
    if (s.finalPulseAt !== undefined) {
      const t = (now - s.finalPulseAt) / CONVERGENCE.finalPulseMs;
      if (t >= 1) s.finalPulseAt = undefined;
      else {
        curve.getPointAt(1 - ease(Math.max(0, t)), p);
        sc.setScalar(1.3);
        m.compose(p, q, sc);
        reverse.setMatrixAt(r++, m);
        reverse.material = whiteMaterial;
      }
    }
    reverse.count = r;
    if (r > 0) reverse.instanceMatrix.needsUpdate = true;
  });

  return (
    <group name={`pulses-${worker}`}>
      <primitive object={packets} />
      <primitive object={reverse} />
    </group>
  );
}
