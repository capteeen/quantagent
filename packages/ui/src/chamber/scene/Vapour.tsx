/**
 * COLD, SPEC §6.1: 200 additive points, size 0.02, drifting 0.05 units/s. Cryogenic vapour.
 * Always on, always subtle. The particle count is the first rung of the degradation ladder.
 * Positions are seeded so a recorded stream looks the same every time.
 */
import { useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, PointsMaterial } from "three";
import { useFrame } from "@react-three/fiber";
import { useChamberContext } from "./context";
import { RIM_KEY } from "./glass";
import { seeded, useDisposable } from "../perf/dispose";
import { SPEED } from "../motion";
import { PLATE_Y, TIER_OUTER_RADIUS } from "../layout";

const Y_MIN = -1.2;
const Y_MAX = PLATE_Y + 0.4;

export function Vapour() {
  const { runtime, perf } = useChamberContext();
  const count = perf.vapourCount;

  const geometry = useDisposable(() => {
    const g = new BufferGeometry();
    const pos = new Float32Array(count * 3);
    const rnd = seeded(0xc01d);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * (TIER_OUTER_RADIUS + 0.4);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Y_MIN + rnd() * (Y_MAX - Y_MIN);
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    g.setAttribute("position", new BufferAttribute(pos, 3));
    return g;
  }, [count]);

  const material = useDisposable(
    () =>
      new PointsMaterial({
        size: 0.02,
        sizeAttenuation: true,
        color: RIM_KEY,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  const points = useMemo(() => {
    const p = new Points(geometry, material);
    p.frustumCulled = false;
    return p;
  }, [geometry, material]);

  const last = useRef<number | null>(null);
  useFrame(() => {
    const now = runtime.current.now();
    const dt = last.current === null ? 0 : Math.min(0.1, (now - last.current) / 1000);
    last.current = now;
    const attr = geometry.getAttribute("position") as BufferAttribute;
    const arr = attr.array as Float32Array;
    const rise = SPEED.vapour * dt;
    for (let i = 0; i < count; i++) {
      let y = arr[i * 3 + 1]! + rise;
      if (y > Y_MAX) y = Y_MIN;
      arr[i * 3 + 1] = y;
    }
    attr.needsUpdate = true;
    material.opacity = 0.55 * runtime.current.fx.brightness;
  });

  return <primitive object={points} />;
}
