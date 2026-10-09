/**
 * THE VESSEL, SPEC §6.2: eight nested glass cylinders (radius 3.0 → 0.6, 0.08 thick)
 * hanging from a glass plate, eight glass pylons per tier. Instanced pylons (64 in one
 * draw call), one material per tier so thickness/roughness step across the chandelier.
 * Mounted first: it is the first frame.
 */
import { useLayoutEffect, useMemo } from "react";
import { CylinderGeometry, InstancedMesh, Matrix4, Quaternion, TorusGeometry, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { useChamberContext } from "./context";
import { RIM_KEY, makeGlass } from "./glass";
import { useDisposable } from "../perf/dispose";
import { PLATE_RADIUS, PLATE_THICKNESS, PLATE_Y, PYLONS_PER_TIER, TIERS, tiers } from "../layout";

const PYLON_RADIUS = 0.022;

export function Vessel() {
  const { perf } = useChamberContext();
  const ts = useMemo(() => tiers(), []);

  const geometries = useDisposable(
    () => ts.map((t) => new CylinderGeometry(t.radius, t.radius, t.height, 96, 1, true)),
    [ts],
  );
  const rims = useDisposable(() => ts.map((t) => new TorusGeometry(t.radius, t.thickness / 2, 8, 96)), [ts]);
  const materials = useDisposable(
    () =>
      ts.map((t) =>
        makeGlass({
          thickness: t.glassThickness,
          roughness: t.roughness,
          iridescence: perf.iridescence,
          opacity: 0.1 + 0.012 * t.index,
          emissive: RIM_KEY,
          emissiveIntensity: 0.05,
        }),
      ),
    [ts, perf.iridescence],
  );
  const plateGeometry = useDisposable(() => new CylinderGeometry(PLATE_RADIUS, PLATE_RADIUS, PLATE_THICKNESS, 96), []);
  const plateMaterial = useDisposable(() => makeGlass({ thickness: 1.2, roughness: 0.12, iridescence: perf.iridescence, opacity: 0.07, emissive: RIM_KEY, emissiveIntensity: 0.03 }), [perf.iridescence]);
  const pylonGeometry = useDisposable(() => new CylinderGeometry(PYLON_RADIUS, PYLON_RADIUS, 1, 6, 1), []);
  const pylonMaterial = useDisposable(() => makeGlass({ thickness: 0.4, roughness: 0.05, iridescence: perf.iridescence, opacity: 0.3, emissive: RIM_KEY, emissiveIntensity: 0.08 }), [perf.iridescence]);

  const pylons = useMemo(() => new InstancedMesh(pylonGeometry, pylonMaterial, TIERS * PYLONS_PER_TIER), [pylonGeometry, pylonMaterial]);

  useLayoutEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    let i = 0;
    for (const t of ts) {
      for (let k = 0; k < PYLONS_PER_TIER; k++) {
        const a = (k / PYLONS_PER_TIER) * Math.PI * 2 + (t.index % 2) * (Math.PI / PYLONS_PER_TIER);
        const r = t.radius - t.thickness;
        p.set(Math.cos(a) * r, t.centerY, Math.sin(a) * r);
        s.set(1, t.height, 1);
        m.compose(p, q, s);
        pylons.setMatrixAt(i++, m);
      }
    }
    pylons.instanceMatrix.needsUpdate = true;
    pylons.frustumCulled = false;
    return () => pylons.dispose();
  }, [pylons, ts]);

  // idle: a barely-there cyan edge breathing with the core (ambience, §6.2)
  useFrame(() => {
    for (const m of materials) {
      m.iridescence = perf.iridescence;
    }
  });

  return (
    <group name="vessel">
      <mesh geometry={plateGeometry} material={plateMaterial} position={[0, PLATE_Y + PLATE_THICKNESS / 2, 0]} />
      {ts.map((t) => (
        <group key={t.index}>
          <mesh geometry={geometries[t.index]!} material={materials[t.index]!} position={[0, t.centerY, 0]} renderOrder={TIERS - t.index} />
          <mesh geometry={rims[t.index]!} material={materials[t.index]!} position={[0, t.bottomY, 0]} rotation={[Math.PI / 2, 0, 0]} />
        </group>
      ))}
      <primitive object={pylons} />
    </group>
  );
}
