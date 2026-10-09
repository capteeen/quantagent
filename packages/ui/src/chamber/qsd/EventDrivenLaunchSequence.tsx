/**
 * EventDrivenLaunchSequence, SPEC §6.5: the six QSD stages rendered from Launcher.* events.
 *
 *   key generation   67 hash chains, 16 deep, each link a 0.05 glass cube on Launcher.chainStep,
 *                    in a cylinder around the core
 *   merkle tree      chain tips fold to leaves; 256 leaves rise; pairs fuse level by level on
 *                    Launcher.treeLevelFused to one white root
 *   superposition    a shimmering band and a rotating half-life ring around the core
 *   quantum draw     the §6.4 sequence on the core (mounted by the EffectRunner)
 *   signing          light runs down each chain to its Launcher.signChainStop depth; those 67
 *                    cubes lift out and lock into a ring; the auth path lights node by node
 *   anchoring        the signed state compacts to a packet, travels a lane to a block that
 *                    seals on Launcher.deployed; the tx signature types in beside it
 *
 * 67×16 cubes are one InstancedMesh, never degraded.
 */
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, CylinderGeometry, InstancedMesh, Matrix4, Mesh, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { useChamberContext } from "../scene/context";
import { Label } from "../scene/Label";
import { ACTIVE_EMISSIVE, RIM_KEY, makeGlass, makeLight } from "../scene/glass";
import { useDisposable } from "../perf/dispose";
import { MS, ease } from "../motion";
import { MERKLE_LEAVES, MERKLE_LEVELS, QSD_CHAINS, QSD_DEPTH, QSD_LINKS } from "../types";
import {
  ANCHOR_BLOCK_POSITION,
  CHAIN_LINK_SIZE,
  CORE_POSITION,
  HALF_LIFE_RING_RADIUS,
  SUPERPOSITION_BAND_RADIUS,
  chainLinkPosition,
  chainTopY,
  merkleNodePosition,
  merkleNodesAtLevel,
  signRingPosition,
} from "../layout";
import { QSD_STAGES, stageIndex, type LaunchSequenceAdapter, type LaunchSequenceProps } from "./LaunchSequenceAdapter";

const WHITE = "#ffffff";

export function EventDrivenLaunchSequence({ qsd, reducedMotion }: LaunchSequenceProps) {
  const { runtime } = useChamberContext();
  const stage = stageIndex(qsd.stage);
  const stageAt = useRef<number[]>(QSD_STAGES.map(() => NaN));
  useEffect(() => {
    if (stage >= 0 && Number.isNaN(stageAt.current[stage])) stageAt.current[stage] = runtime.current.now();
  }, [stage, runtime]);

  return (
    <group name="qsd">
      <Chains qsd={qsd} />
      {stage >= 1 ? <Merkle qsd={qsd} stageAt={stageAt} /> : null}
      {stage >= 2 ? <Superposition qsd={qsd} reducedMotion={reducedMotion} stageAt={stageAt} /> : null}
      {stage >= 5 ? <Anchoring qsd={qsd} stageAt={stageAt} /> : null}
    </group>
  );
}

/* ───────────────────────── key generation + signing ───────────────────────── */

function Chains({ qsd }: { qsd: QsdState }) {
  const { runtime } = useChamberContext();
  const cubeGeometry = useDisposable(() => new BoxGeometry(CHAIN_LINK_SIZE, CHAIN_LINK_SIZE, CHAIN_LINK_SIZE), []);
  const cubeMaterial = useDisposable(() => makeGlass({ transmission: 0, thickness: 0.4, roughness: 0.05, opacity: 0.3, emissive: RIM_KEY, emissiveIntensity: 0.08 }), []);
  const headGeometry = useDisposable(() => new SphereGeometry(0.03, 8, 6), []);
  const headMaterial = useDisposable(() => makeLight(ACTIVE_EMISSIVE, 3, { transparent: true, opacity: 1, additive: true }), []);
  const markerGeometry = useDisposable(() => new SphereGeometry(0.022, 8, 6), []);
  const markerMaterial = useDisposable(() => makeLight(ACTIVE_EMISSIVE, 4), []);
  const pathGeometry = useDisposable(() => new SphereGeometry(0.03, 10, 8), []);
  const pathMaterial = useDisposable(() => makeLight(WHITE, 4), []);
  const cubes = useMemo(() => {
    const im = new InstancedMesh(cubeGeometry, cubeMaterial, QSD_LINKS);
    im.frustumCulled = false;
    return im;
  }, [cubeGeometry, cubeMaterial]);
  // the newest link of every chain glows as it appears: light is computation
  const heads = useMemo(() => {
    const im = new InstancedMesh(headGeometry, headMaterial, QSD_LINKS);
    im.frustumCulled = false;
    im.count = 0;
    return im;
  }, [headGeometry, headMaterial]);
  const markers = useMemo(() => {
    const im = new InstancedMesh(markerGeometry, markerMaterial, QSD_CHAINS);
    im.frustumCulled = false;
    im.count = 0;
    return im;
  }, [markerGeometry, markerMaterial]);
  const path = useMemo(() => {
    const im = new InstancedMesh(pathGeometry, pathMaterial, MERKLE_LEVELS + 1);
    im.frustumCulled = false;
    im.count = 0;
    return im;
  }, [pathGeometry, pathMaterial]);
  useEffect(
    () => () => {
      cubes.dispose();
      heads.dispose();
      markers.dispose();
      path.dispose();
    },
    [cubes, heads, markers, path],
  );

  const appearAt = useMemo(() => new Float64Array(QSD_LINKS).fill(NaN), []);
  const signAt = useMemo(() => new Float64Array(QSD_CHAINS).fill(NaN), []);
  const pathLitAt = useMemo(() => new Float64Array(MERKLE_LEVELS + 1).fill(NaN), []);
  const scratch = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), s: new Vector3(), p: new Vector3(), a: new Vector3(), b: new Vector3() }), []);
  const signing = stageIndex(qsd.stage) >= 4;

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const { m, q, s, p, a, b } = scratch;
    const links = qsd.links;
    let hn = 0;
    // links appear on chainStep, each growing over 700ms
    for (let i = 0; i < QSD_LINKS; i++) {
      const on = links[i] === 1;
      if (on && Number.isNaN(appearAt[i])) appearAt[i] = now;
      if (!on) {
        s.setScalar(0.0001);
        m.compose(chainLinkPosition(Math.floor(i / QSD_DEPTH), i % QSD_DEPTH, p), q, s);
        cubes.setMatrixAt(i, m);
        continue;
      }
      const chain = Math.floor(i / QSD_DEPTH);
      const depth = i % QSD_DEPTH;
      const age = now - appearAt[i]!;
      const grow = ease(Math.min(1, age / MS.qsdLink));
      chainLinkPosition(chain, depth, p);
      if (age < MS.qsdLink) {
        s.setScalar(1.4 * (1 - age / MS.qsdLink) + 0.2);
        m.compose(p, q, s);
        heads.setMatrixAt(hn++, m);
      }
      // signing: the cube at the stop depth lifts into the ring over 900ms after the light reaches it
      const stop = qsd.signStops[chain] ?? -1;
      if (signing && stop === depth && !Number.isNaN(signAt[chain])) {
        const t = ease(Math.min(1, Math.max(0, (now - signAt[chain]! - MS.min) / 900)));
        signRingPosition(chain, b);
        p.lerp(b, t);
      }
      s.setScalar(Math.max(0.0001, grow));
      m.compose(p, q, s);
      cubes.setMatrixAt(i, m);
    }
    cubes.instanceMatrix.needsUpdate = true;
    heads.count = hn;
    if (hn > 0) heads.instanceMatrix.needsUpdate = true;
    headMaterial.opacity = rt.fx.brightness;
    cubeMaterial.emissiveIntensity = (0.08 + (signing ? 0.2 : 0)) * rt.fx.brightness;

    // signing markers: light runs from the chain tip down to the stop depth over 700ms
    let n = 0;
    if (signing) {
      for (let c = 0; c < QSD_CHAINS; c++) {
        const stop = qsd.signStops[c] ?? -1;
        if (stop < 0) continue;
        if (Number.isNaN(signAt[c])) signAt[c] = now;
        const t = Math.min(1, (now - signAt[c]!) / MS.min);
        if (t >= 1) continue;
        chainLinkPosition(c, QSD_DEPTH - 1, a);
        chainLinkPosition(c, stop, b);
        p.copy(a).lerp(b, ease(t));
        s.setScalar(1);
        m.compose(p, q, s);
        markers.setMatrixAt(n++, m);
      }
    }
    markers.count = n;
    if (n > 0) markers.instanceMatrix.needsUpdate = true;

    // the auth path to the root lights node by node as the chains sign
    let lit = 0;
    if (signing) {
      const want = Math.floor(((MERKLE_LEVELS + 1) * qsd.signedCount) / QSD_CHAINS);
      for (let l = 0; l <= MERKLE_LEVELS; l++) {
        if (l < want && Number.isNaN(pathLitAt[l])) pathLitAt[l] = now;
        if (Number.isNaN(pathLitAt[l])) break;
        const t = ease(Math.min(1, (now - pathLitAt[l]!) / MS.min));
        merkleNodePosition(l, 0, p);
        s.setScalar(Math.max(0.0001, t * 1.2));
        m.compose(p, q, s);
        path.setMatrixAt(lit++, m);
      }
    }
    path.count = lit;
    if (lit > 0) path.instanceMatrix.needsUpdate = true;
  });

  return (
    <group name="qsd-chains">
      <primitive object={cubes} />
      <primitive object={heads} />
      <primitive object={markers} />
      <primitive object={path} />
    </group>
  );
}

/* ───────────────────────────── merkle tree ───────────────────────────── */

function Merkle({ qsd, stageAt }: { qsd: QsdState; stageAt: { current: number[] } }) {
  const { runtime } = useChamberContext();
  const geometry = useDisposable(() => new SphereGeometry(0.012, 8, 6), []);
  const material = useDisposable(() => makeLight(RIM_KEY, 1.1), []);
  const nodes = useMemo(() => {
    const im = new InstancedMesh(geometry, material, MERKLE_LEAVES);
    im.frustumCulled = false;
    return im;
  }, [geometry, material]);
  useEffect(() => () => nodes.dispose(), [nodes]);
  const level = qsd.treeLevelsFused.length ? Math.max(...qsd.treeLevelsFused) : 0;
  const prev = useRef({ level: 0, at: NaN });
  useEffect(() => {
    if (level !== prev.current.level) prev.current = { level, at: runtime.current.now() };
  }, [level, runtime]);
  const scratch = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), s: new Vector3(), p: new Vector3(), from: new Vector3() }), []);

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const { m, q, s, p, from } = scratch;
    const rise = ease(Math.min(1, (now - (stageAt.current[1] ?? now)) / MS.min));
    const fuse = Number.isNaN(prev.current.at) ? 1 : ease(Math.min(1, (now - prev.current.at) / MS.qsdLink));
    const count = merkleNodesAtLevel(level);
    const fromLevel = Math.max(0, level - 1);
    const topY = chainTopY();
    let n = 0;
    for (let i = 0; i < count; i++) {
      merkleNodePosition(level, i, p);
      if (level > 0 && fuse < 1) {
        merkleNodePosition(fromLevel, i * 2, from);
        p.copy(from.lerp(p, fuse));
      }
      if (level === 0) p.y = topY + (p.y - topY) * rise;
      const root = level === MERKLE_LEVELS;
      s.setScalar(root ? 3 : 1 + 0.08 * level);
      m.compose(p, q, s);
      nodes.setMatrixAt(n++, m);
    }
    nodes.count = n;
    nodes.instanceMatrix.needsUpdate = true;
    material.color.set(level === MERKLE_LEVELS ? WHITE : RIM_KEY).multiplyScalar((level === MERKLE_LEVELS ? 3 : 1.1 + 0.12 * level) * rt.fx.brightness);
  });

  return <primitive object={nodes} />;
}

/* ─────────────────────── superposition band + half-life ring ─────────────────────── */

function Superposition({ qsd, reducedMotion, stageAt }: { qsd: QsdState; reducedMotion: boolean; stageAt: { current: number[] } }) {
  const { runtime } = useChamberContext();
  const bandGeometry = useDisposable(() => new TorusGeometry(SUPERPOSITION_BAND_RADIUS, 0.06, 12, 96), []);
  const bandMaterial = useDisposable(() => makeLight(RIM_KEY, 1.6, { transparent: true, opacity: 0, additive: true }), []);
  const ringGeometry = useDisposable(() => new TorusGeometry(HALF_LIFE_RING_RADIUS, 0.008, 6, 96), []);
  const ringMaterial = useDisposable(() => makeLight(ACTIVE_EMISSIVE, 2.5, { transparent: true, opacity: 0 }), []);
  const ring = useRef<Mesh>(null);
  const band = useRef<Mesh>(null);
  const anchoring = stageIndex(qsd.stage) >= 5;

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const since = now - (stageAt.current[2] ?? now);
    const fadeIn = ease(Math.min(1, since / MS.min));
    const fadeOut = anchoring ? 1 - ease(Math.min(1, (now - (stageAt.current[5] ?? now)) / MS.min)) : 1;
    const vis = fadeIn * fadeOut * rt.fx.brightness;
    const shimmer = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 320) * Math.sin(now / 95);
    bandMaterial.opacity = (0.25 + 0.2 * shimmer) * vis;
    ringMaterial.opacity = 0.9 * vis;
    if (ring.current) ring.current.rotation.y = reducedMotion ? 0 : (now / 1000) * 0.6;
    if (band.current) band.current.visible = vis > 0.001;
    if (ring.current) ring.current.visible = vis > 0.001;
  });

  return (
    <group position={CORE_POSITION.toArray()} name="qsd-superposition">
      <mesh ref={band} geometry={bandGeometry} material={bandMaterial} rotation={[Math.PI / 2, 0, 0]} renderOrder={22} />
      <mesh ref={ring} geometry={ringGeometry} material={ringMaterial} rotation={[Math.PI / 2.6, 0, 0]} renderOrder={22} />
      {qsd.halfLife !== undefined && !anchoring ? (
        <Label position={[0, -0.62, 0]} color="#FFB300" size={11} testId="qsd-half-life">
          {`half-life ${qsd.halfLife}s`}
        </Label>
      ) : null}
    </group>
  );
}

/* ───────────────────────────── anchoring ───────────────────────────── */

function Anchoring({ qsd, stageAt }: { qsd: QsdState; stageAt: { current: number[] } }) {
  const { runtime } = useChamberContext();
  const laneGeometry = useDisposable(() => new CylinderGeometry(0.006, 0.006, 1, 6, 1, true), []);
  const laneMaterial = useDisposable(() => makeLight(ACTIVE_EMISSIVE, 1.8, { transparent: true, opacity: 0.6, additive: true }), []);
  const packetGeometry = useDisposable(() => new SphereGeometry(0.06, 12, 8), []);
  const packetMaterial = useDisposable(() => makeLight(WHITE, 5), []);
  const blockGeometry = useDisposable(() => new BoxGeometry(0.22, 0.22, 0.22), []);
  const blockMaterial = useDisposable(() => makeGlass({ thickness: 0.8, roughness: 0.05, opacity: 0.85, emissive: WHITE, emissiveIntensity: 0.3 }), []);
  const packet = useRef<Mesh>(null);
  const block = useRef<Mesh>(null);
  const txRef = useRef<HTMLSpanElement>(null);
  const sealedAt = useRef(NaN);
  const tx = qsd.anchorTx ?? "";
  useEffect(() => {
    if (tx && Number.isNaN(sealedAt.current)) sealedAt.current = runtime.current.now();
  }, [tx, runtime]);

  const lane = useMemo(() => {
    const dir = ANCHOR_BLOCK_POSITION.clone().sub(CORE_POSITION);
    const len = dir.length();
    const mid = CORE_POSITION.clone().addScaledVector(dir, 0.5);
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
    return { len, mid, quat };
  }, []);

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const since = now - (stageAt.current[5] ?? now);
    const travel = ease(Math.min(1, since / MS.dolly));
    if (packet.current) {
      packet.current.visible = travel < 1;
      packet.current.position.copy(CORE_POSITION).lerp(ANCHOR_BLOCK_POSITION, travel);
    }
    if (block.current) {
      const sealed = !Number.isNaN(sealedAt.current);
      const appear = travel >= 1 ? 1 : 0;
      const seal = sealed ? ease(Math.min(1, (now - sealedAt.current) / MS.min)) : 0;
      block.current.visible = appear > 0 || sealed;
      block.current.scale.setScalar(Math.max(0.0001, Math.max(appear, seal)));
      block.current.rotation.y = seal * Math.PI * 0.25;
      blockMaterial.emissiveIntensity = (0.3 + 1.2 * seal) * rt.fx.brightness;
    }
    if (txRef.current) {
      const typed = Number.isNaN(sealedAt.current) ? 0 : Math.min(1, (now - sealedAt.current) / MS.qsdType);
      const text = tx.slice(0, Math.floor(tx.length * typed));
      if (txRef.current.textContent !== text) txRef.current.textContent = text;
    }
    laneMaterial.opacity = 0.6 * rt.fx.brightness;
  });

  return (
    <group name="qsd-anchoring">
      <mesh geometry={laneGeometry} material={laneMaterial} position={lane.mid.toArray()} quaternion={lane.quat} scale={[1, lane.len, 1]} renderOrder={21} />
      <mesh ref={packet} geometry={packetGeometry} material={packetMaterial} visible={false} renderOrder={29} />
      <mesh ref={block} geometry={blockGeometry} material={blockMaterial} position={ANCHOR_BLOCK_POSITION.toArray()} visible={false} renderOrder={23} />
      {tx ? (
        <Label position={[ANCHOR_BLOCK_POSITION.x, ANCHOR_BLOCK_POSITION.y - 0.2, ANCHOR_BLOCK_POSITION.z]} color="#4DD0E1" size={11} title="anchoring transaction" testId="qsd-tx">
          <span ref={txRef} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", display: "inline-block" }} />
        </Label>
      ) : null}
    </group>
  );
}

export const eventDrivenLaunchSequence: LaunchSequenceAdapter = {
  id: "event-driven",
  Sequence: EventDrivenLaunchSequence,
};

import type { QsdState } from "../types";
