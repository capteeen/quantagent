/**
 * The anchor of a strand, SPEC §6.3: glows with cumulative progress; a small glass ring while
 * awaiting approval; a glass cap and a soft ring flash when done; a persistent fracture decal
 * when failed. Also the 44px hit target that opens the WorkerSheet.
 */
import { useMemo, useRef } from "react";
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Mesh, SphereGeometry, TorusGeometry, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { WORKER_COLORS, type WorkerName } from "@quantagent/core/types";
import { useChamberContext } from "../scene/context";
import { AMBER, FAILED, makeGlass, makeLight, setLight } from "../scene/glass";
import { hashString, seeded, useDisposable } from "../perf/dispose";
import { anchorNormal, anchorPosition, workerIndex } from "../layout";
import { MS, ease } from "../motion";
import type { StrandState } from "../types";

const RED = "#FF3B30";
export const ANCHOR_RADIUS_VISUAL = 0.08;
/** ≥44px at 7.5 units with fov 38 on a 844px-tall viewport (1px ≈ 0.0061 units). */
export const HIT_RADIUS = 0.15;

export interface AnchorProps {
  worker: WorkerName;
  strand: StrandState;
  onTap: () => void;
}

export function Anchor({ worker, strand, onTap }: AnchorProps) {
  const { runtime, reducedMotion } = useChamberContext();
  const k = workerIndex(worker);
  const position = useMemo(() => anchorPosition(k), [k]);
  const normal = useMemo(() => anchorNormal(k), [k]);
  const color = WORKER_COLORS[worker];

  const sphereGeometry = useDisposable(() => new SphereGeometry(ANCHOR_RADIUS_VISUAL, 16, 12), []);
  const sphereMaterial = useDisposable(() => makeLight(color, 1), [color]);
  const ringGeometry = useDisposable(() => new TorusGeometry(0.14, 0.015, 8, 48), []);
  const ringMaterial = useDisposable(() => makeGlass({ thickness: 0.4, roughness: 0.05, opacity: 0, emissive: AMBER, emissiveIntensity: 0.8 }), []);
  const capGeometry = useDisposable(() => new SphereGeometry(0.12, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), []);
  const capMaterial = useDisposable(() => makeGlass({ thickness: 0.6, roughness: 0.05, opacity: 0.85, emissive: color, emissiveIntensity: 0.4 }), [color]);
  const flashGeometry = useDisposable(() => new TorusGeometry(1, 0.01, 6, 48), []);
  const flashMaterial = useDisposable(() => makeLight(color, 3, { transparent: true, opacity: 0, additive: true }), [color]);
  const hitGeometry = useDisposable(() => new SphereGeometry(HIT_RADIUS, 8, 6), []);
  const hitMaterial = useDisposable(() => {
    const m = makeLight("#000000", 0, { transparent: true, opacity: 0 });
    m.colorWrite = false;
    m.depthWrite = false;
    return m;
  }, []);

  // the crack: jagged radial fractures on the anchor, seeded per worker, drawn once and kept
  const crackGeometry = useDisposable(() => {
    const rnd = seeded(hashString(worker + ":crack"));
    const pts: number[] = [];
    const up = new Vector3(0, 1, 0);
    const side = new Vector3().crossVectors(up, normal).normalize();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rnd() * 0.5;
      let x = 0;
      let y = 0;
      const steps = 3 + Math.floor(rnd() * 3);
      for (let st = 0; st < steps; st++) {
        const nx = x + Math.cos(a + (rnd() - 0.5) * 1.2) * (0.04 + rnd() * 0.06);
        const ny = y + Math.sin(a + (rnd() - 0.5) * 1.2) * (0.04 + rnd() * 0.06);
        const p0 = new Vector3().addScaledVector(side, x).addScaledVector(up, y).addScaledVector(normal, 0.02);
        const p1 = new Vector3().addScaledVector(side, nx).addScaledVector(up, ny).addScaledVector(normal, 0.02);
        pts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        x = nx;
        y = ny;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return g;
  }, [worker, normal]);
  const crackMaterial = useDisposable(() => new LineBasicMaterial({ color: RED, transparent: true, opacity: 0, toneMapped: false }), []);
  const crackLines = useMemo(() => {
    const l = new LineSegments(crackGeometry, crackMaterial);
    l.renderOrder = 35;
    l.visible = false;
    return l;
  }, [crackGeometry, crackMaterial]);

  const ring = useRef<Mesh>(null);
  const cap = useRef<Mesh>(null);
  const flash = useRef<Mesh>(null);
  const capQuaternion = useMemo(() => {
    const m = new Mesh();
    m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal.clone().negate());
    return m.quaternion.clone();
  }, [normal]);

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const s = rt.strands[worker];
    const b = rt.fx.brightness * s.selectFactor;
    // cumulative progress glow
    const glow = strand.failed ? 0.5 : 0.8 + Math.min(3.2, 0.25 * s.arrived);
    if (strand.failed && s.failedAt !== undefined) {
      const t = ease(Math.min(1, (now - s.failedAt) / MS.fail));
      sphereMaterial.color.set(color).lerp(sphereMaterial.color.clone().set(FAILED), t).multiplyScalar(glow * b);
      crackMaterial.opacity = 0.9 * t;
      crackLines.visible = true;
    } else {
      setLight(sphereMaterial, color, glow * b);
      crackLines.visible = strand.failed;
      if (strand.failed) crackMaterial.opacity = 0.9;
    }
    // awaiting approval: amber breathe on the small glass ring
    if (ring.current) {
      const awaiting = strand.status === "awaitingApproval";
      ring.current.visible = awaiting;
      if (awaiting) {
        const breathe = reducedMotion ? 0.7 : 0.5 + 0.5 * (0.5 + 0.5 * Math.sin((now / MS.approvalBreathe) * Math.PI * 2));
        ringMaterial.opacity = 0.75 * b;
        ringMaterial.emissiveIntensity = (0.4 + 1.2 * breathe) * b;
      }
    }
    // done: glass cap seals the anchor over 700ms
    if (cap.current) {
      const sealed = strand.sealed && !strand.failed;
      cap.current.visible = sealed;
      if (sealed) {
        const t = s.doneAt === undefined ? 1 : ease(Math.min(1, (now - s.doneAt) / MS.min));
        cap.current.scale.setScalar(Math.max(0.0001, t));
        capMaterial.emissiveIntensity = 0.4 * b;
      }
    }
    // the soft ring flash on Worker.done
    if (flash.current) {
      const at = rt.fx.ringFlash[worker];
      if (at !== undefined && now - at < MS.ringFlash) {
        const t = ease((now - at) / MS.ringFlash);
        flash.current.visible = true;
        flash.current.scale.setScalar(0.1 + 0.4 * t);
        flashMaterial.opacity = (1 - t) * b;
      } else {
        flash.current.visible = false;
        if (at !== undefined && now - at >= MS.ringFlash) delete rt.fx.ringFlash[worker];
      }
    }
  });

  const faceOut = useMemo(() => {
    const m = new Mesh();
    m.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
    return m.quaternion.clone();
  }, [normal]);

  return (
    <group position={position.toArray()} name={`anchor-${worker}`}>
      <mesh geometry={sphereGeometry} material={sphereMaterial} renderOrder={25} />
      <mesh ref={ring} geometry={ringGeometry} material={ringMaterial} quaternion={faceOut} visible={false} renderOrder={26} />
      <mesh ref={cap} geometry={capGeometry} material={capMaterial} quaternion={capQuaternion} visible={false} renderOrder={26} />
      <mesh ref={flash} geometry={flashGeometry} material={flashMaterial} quaternion={faceOut} visible={false} renderOrder={27} />
      <primitive object={crackLines} />
      <mesh
        geometry={hitGeometry}
        material={hitMaterial}
        onClick={(e) => {
          e.stopPropagation();
          onTap();
        }}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      />
    </group>
  );
}
