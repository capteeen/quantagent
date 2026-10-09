/**
 * The fan, SPEC §6.4: N ghost tubes growing over 600ms from the split point, each ending in
 * a glass bead with a billboard label (name, or a 48px thumbnail). The fan drifts. While a
 * collapse sequence runs on this strand it flickers, jitters and finally snaps to the chosen
 * ghost. Orchestrator.collapseUnavailable keeps it open with "QRNG unreachable, pick one".
 */
import { useEffect, useMemo, useRef } from "react";
import { Color, Group, InstancedMesh, Matrix4, Mesh, Quaternion, SphereGeometry, TubeGeometry, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { WORKER_COLORS, type Candidate, type WorkerName } from "@quantagent/core/types";
import { useChamberContext } from "../scene/context";
import { Label } from "../scene/Label";
import { makeGlass, makeLight } from "../scene/glass";
import { candidateLabel } from "../store";
import { hashString, seeded, useDisposable } from "../perf/dispose";
import { ease } from "../motion";
import { COLLAPSE, collapseFrame } from "./timeline";
import { BEAD_RADIUS, GHOST_RADIAL, GHOST_SEGMENTS, fanGhosts, type Ghost } from "./fan";

export interface CandidateFanProps {
  worker: WorkerName;
  candidates: Candidate[];
  /** Orchestrator.collapseUnavailable reason, if any. */
  unavailable?: string | undefined;
  /** Tapping a candidate label opens the WorkerSheet, where the user picks. */
  onTapCandidate?: (() => void) | undefined;
}

export function CandidateFan({ worker, candidates, unavailable, onTapCandidate }: CandidateFanProps) {
  const { runtime, reducedMotion } = useChamberContext();
  const ghosts = useMemo(() => fanGhosts(worker, candidates), [worker, candidates]);
  const color = WORKER_COLORS[worker];

  const geometries = useDisposable(
    () => ghosts.map((g) => new TubeGeometry(g.curve, GHOST_SEGMENTS, COLLAPSE.ghostRadius, GHOST_RADIAL, false)),
    [ghosts],
  );
  const material = useDisposable(() => makeLight(color, 1.4, { transparent: true, opacity: COLLAPSE.ghostOpacity }), [color]);
  const chosenMaterial = useDisposable(() => makeLight(color, 2.4, { transparent: true, opacity: 1 }), [color]);
  const beadGeometry = useDisposable(() => new SphereGeometry(BEAD_RADIUS, 12, 8), []);
  const beadMaterial = useDisposable(() => makeGlass({ thickness: 0.4, roughness: 0.05, opacity: 0.8, emissive: color, emissiveIntensity: 0.6 }), [color]);
  const beads = useMemo(() => new InstancedMesh(beadGeometry, beadMaterial, Math.max(1, ghosts.length)), [beadGeometry, beadMaterial, ghosts.length]);
  useEffect(() => () => beads.dispose(), [beads]);

  const meshes = useRef<(Mesh | null)[]>([]);
  const group = useRef<Group>(null);
  const jitterSeed = useMemo(() => seeded(hashString(worker + ":jitter")), [worker]);

  useEffect(() => {
    const rt = runtime.current;
    const s = rt.strands[worker];
    if (s.fanAt === undefined) s.fanAt = rt.now();
    return () => {
      delete rt.strands[worker].fanAt;
    };
  }, [runtime, worker]);

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const s = rt.strands[worker];
    const fanAt = s.fanAt ?? now;
    const grow = ease(Math.min(1, (now - fanAt) / COLLAPSE.fanMs));
    const c = s.collapse;
    const frame = c ? collapseFrame(now - c.start, { reducedMotion, shower: c.shower, framesSinceSnap: c.framesSinceSnap }) : null;
    const chosenId = c?.chosen?.id;

    // drift: the fan breathes very slowly around the anchor (ambience on a state)
    if (group.current) group.current.rotation.y = reducedMotion ? 0 : Math.sin(now / 12500) * 0.035;

    const m = new Matrix4();
    const q = new Quaternion();
    const sc = new Vector3(1, 1, 1);
    const p = new Vector3();
    ghosts.forEach((g, i) => {
      const mesh = meshes.current[i];
      const isChosen = chosenId !== undefined && g.candidate.id === chosenId;
      const vanished = frame?.snapped === true && !isChosen;
      if (mesh) {
        const geom = geometries[i]!;
        const total = geom.index ? geom.index.count : geom.attributes["position"]!.count;
        const per = Math.max(1, Math.floor(total / GHOST_SEGMENTS));
        geom.setDrawRange(0, Math.min(total, Math.ceil(grow * GHOST_SEGMENTS) * per));
        mesh.visible = !vanished;
        mesh.material = frame?.snapped && isChosen ? chosenMaterial : material;
      }
      p.copy(g.bead);
      if (frame && frame.beadJitter > 0) {
        p.x += (jitterSeed() - 0.5) * 2 * frame.beadJitter;
        p.y += (jitterSeed() - 0.5) * 2 * frame.beadJitter;
        p.z += (jitterSeed() - 0.5) * 2 * frame.beadJitter;
      }
      const visibleScale = vanished ? 0 : grow;
      sc.setScalar(Math.max(0.0001, visibleScale * (frame?.snapped && isChosen ? 1.6 : 1)));
      m.compose(p, q, sc);
      beads.setMatrixAt(i, m);
    });
    beads.instanceMatrix.needsUpdate = true;
    material.opacity = (frame?.flickerOpacity ?? COLLAPSE.ghostOpacity) * grow * rt.fx.brightness;
    const base = new Color(color);
    material.color.copy(base).multiplyScalar(1.4 * rt.fx.brightness);
    chosenMaterial.color.copy(base).multiplyScalar(2.4);
    beadMaterial.emissiveIntensity = 0.6 * rt.fx.brightness;
  });

  return (
    <group ref={group} name={`fan-${worker}`}>
      {ghosts.map((g, i) => (
        <mesh key={g.candidate.id} ref={(el) => {
            meshes.current[i] = el;
          }} geometry={geometries[i]!} material={material} renderOrder={30} />
      ))}
      <primitive object={beads} />
      {ghosts.map((g, i) => (
        <GhostLabel key={g.candidate.id} ghost={g} index={i} worker={worker} onTap={onTapCandidate} />
      ))}
      {unavailable ? (
        <Label position={[ghosts[0]?.bead.x ?? 0, (ghosts[0]?.bead.y ?? 0) + 0.45, ghosts[0]?.bead.z ?? 0]} color="#FFB300" size={11} interactive onClick={onTapCandidate} testId={`fan-unavailable-${worker}`}>
          QRNG unreachable, pick one
        </Label>
      ) : null}
    </group>
  );
}

function GhostLabel({ ghost, index, worker, onTap }: { ghost: Ghost; index: number; worker: WorkerName; onTap: (() => void) | undefined }) {
  const { runtime } = useChamberContext();
  const ref = useRef<Group>(null);
  useFrame(() => {
    const c = runtime.current.strands[worker].collapse;
    const chosen = c?.chosen?.id;
    const vanish = c !== undefined && c.snapFrame !== undefined && chosen !== ghost.candidate.id;
    if (ref.current && ref.current.visible === vanish) ref.current.visible = !vanish;
  });
  const text = candidateLabel(ghost.candidate);
  const thumb = ghost.candidate.thumbnailUrl;
  // labels sit above or below their bead, alternating, so neighbours do not overlap on a phone
  const dy = (index % 2 === 0 ? 1 : -1) * (0.09 + 0.05 * Math.floor(index / 2));
  const offset: [number, number, number] = [ghost.bead.x, ghost.bead.y + dy, ghost.bead.z];
  return (
    <group ref={ref}>
      <Label position={offset} size={11} interactive={!!onTap} onClick={onTap} color="#D7DEE6" title={ghost.candidate.reason}>
        {thumb ? (
          <img src={thumb} alt={text} width={48} height={48} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #1C2430", background: "#0D1117" }} />
        ) : (
          text
        )}
      </Label>
    </group>
  );
}
