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
import { RIM_KEY, makeGlass, makeLight } from "./glass";
import { useDisposable } from "../perf/dispose";
import { PLATE_RADIUS, PLATE_THICKNESS, PLATE_Y, PYLONS_PER_TIER, TIERS, tiers } from "../layout";

const PYLON_RADIUS = 0.018;
/** Edge rings of light at each stage: "dim glass, cyan edges" (§6.2), kept under the bloom threshold. */
const EDGE_TUBE = 0.011;
const EDGE_INTENSITY = 0.85;

export function Vessel() {
  const { perf } = useChamberContext();
  const ts = useMemo(() => tiers(), []);

  const geometries = useDisposable(
    () => ts.map((t) => new CylinderGeometry(t.radius, t.radius, t.height, 96, 1, true)),
    [ts],
  );
  const rims = useDisposable(() => ts.map((t) => new TorusGeometry(t.radius, EDGE_TUBE, 6, 128)), [ts]);
  // outer stages a touch brighter than inner ones: depth reads even without DOF
  const edgeMaterials = useDisposable(() => ts.map((t) => makeLight(RIM_KEY, EDGE_INTENSITY * (1 - 0.35 * (t.index / (TIERS - 1))))), [ts]);
  const plateEdge = useDisposable(() => new TorusGeometry(PLATE_RADIUS, EDGE_TUBE * 1.2, 6, 160), []);
  const materials = useDisposable(
    () =>
      ts.map((t) =>
        makeGlass({
          thickness: t.glassThickness,
          roughness: t.roughness,
          iridescence: perf.iridescence,
          opacity: 0.32 + 0.02 * t.index,
          emissive: RIM_KEY,
          emissiveIntensity: 0.02,
          envMapIntensity: 1.4,
        }),
      ),
    [ts, perf.iridescence],
  );
  const plateGeometry = useDisposable(() => new CylinderGeometry(PLATE_RADIUS, PLATE_RADIUS, PLATE_THICKNESS, 96), []);
  const plateMaterial = useDisposable(() => makeGlass({ thickness: 1.2, roughness: 0.12, iridescence: perf.iridescence, opacity: 0.3, emissive: RIM_KEY, emissiveIntensity: 0.02, envMapIntensity: 1.2 }), [perf.iridescence]);
  const pylonGeometry = useDisposable(() => new CylinderGeometry(PYLON_RADIUS, PYLON_RADIUS, 1, 6, 1), []);
  const pylonMaterial = useDisposable(() => makeGlass({ thickness: 0.4, roughness: 0.05, iridescence: perf.iridescence, opacity: 0.45, emissive: RIM_KEY, emissiveIntensity: 0.05, envMapIntensity: 1.6 }), [perf.iridescence]);

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
      <mesh geometry={plateEdge} material={edgeMaterials[0]!} position={[0, PLATE_Y, 0]} rotation={[Math.PI / 2, 0, 0]} />
      {ts.map((t) => (
        <group key={t.index}>
          <mesh geometry={geometries[t.index]!} material={materials[t.index]!} position={[0, t.centerY, 0]} renderOrder={TIERS - t.index} />
          <mesh geometry={rims[t.index]!} material={edgeMaterials[t.index]!} position={[0, t.bottomY, 0]} rotation={[Math.PI / 2, 0, 0]} />
        </group>
      ))}
      <primitive object={pylons} />
    </group>
  );
}
