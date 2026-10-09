/**
 * Procedural layout of the chamber: vessel tiers, the core, the eight anchors, strand
 * curves, QSD chain/merkle/ring positions. Pure three.js math, no rendering, so tests can
 * count what the scene will draw (8 strands, 8 anchors at 45°, 67×16 links, 256 leaves).
 */
import { CatmullRomCurve3, PerspectiveCamera, Vector3 } from "three";
import { WORKER_NAMES, type WorkerName } from "@quantagent/core/types";
import { MERKLE_LEAVES, MERKLE_LEVELS, QSD_CHAINS, QSD_DEPTH } from "./types";

/** SPEC §6.2: eight nested glass cylinders, radius 3.0 → 0.6, 0.08 thick. */
export const TIERS = 8;
export const TIER_OUTER_RADIUS = 3.0;
export const TIER_INNER_RADIUS = 0.6;
export const TIER_THICKNESS = 0.08;
export const PYLONS_PER_TIER = 8;
/** The glass plate everything hangs from. */
export const PLATE_Y = 2.6;
export const PLATE_RADIUS = 3.25;
export const PLATE_THICKNESS = 0.08;
/** The core: a sphere of radius 0.35 at the camera's look-at point. */
export const CORE_RADIUS = 0.35;
export const CORE_POSITION = new Vector3(0, 0.4, 0);
/** Camera, SPEC §6.2. */
export const CAMERA_POSITION = new Vector3(0, 1.2, 7.5);
export const CAMERA_TARGET = new Vector3(0, 0.4, 0);
export const CAMERA_FOV = 38;
export const CAMERA_DISTANCE_FAR = 7.5;
export const CAMERA_DISTANCE_NEAR = 4.2;
/**
 * "fit" framing: the spec camera looks at the core (y 0.4) from y 1.2, which crops the plate
 * and the outer tier on every aspect. Fit keeps the spec fov and elevation, aims at the middle
 * of the vessel, and pulls back until the plate, the anchor ring and the core are all in frame.
 * It never comes closer than the spec distance, so wider viewports widen the frame only.
 */
export interface Framing {
  /** Multiplier on the camera distance (≥ 1). */
  distanceScale: number;
  /** y of the look-at point at the far (7.5) distance; the dolly to 4.2 eases it back to the core. */
  targetY: number;
}

const FIT_MARGIN_X = 0.06;
const FIT_MARGIN_Y = 0.1;

export function fitFraming(aspect: number): Framing {
  const elev = Math.atan2(CAMERA_POSITION.y - CAMERA_TARGET.y, CAMERA_POSITION.z);
  const bottom = CORE_POSITION.y - CORE_RADIUS;
  const top = PLATE_Y + PLATE_THICKNESS;
  const targetY = (bottom + top) / 2;
  const pts: Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(new Vector3(Math.cos(a) * PLATE_RADIUS, top, Math.sin(a) * PLATE_RADIUS));
    pts.push(new Vector3(Math.cos(a) * TIER_OUTER_RADIUS, ANCHOR_Y, Math.sin(a) * TIER_OUTER_RADIUS));
  }
  pts.push(new Vector3(0, bottom, 0));
  const cam = new PerspectiveCamera(CAMERA_FOV, Math.max(0.05, aspect), 0.1, 200);
  const target = new Vector3(0, targetY, 0);
  const v = new Vector3();
  for (let d = CAMERA_DISTANCE_FAR; d < 60; d += 0.05) {
    cam.position.set(0, targetY + Math.sin(elev) * d, Math.cos(elev) * d);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    const fits = pts.every((p) => {
      v.copy(p).project(cam);
      return Math.abs(v.x) <= 1 - FIT_MARGIN_X && Math.abs(v.y) <= 1 - FIT_MARGIN_Y;
    });
    if (fits) return { distanceScale: d / CAMERA_DISTANCE_FAR, targetY };
  }
  return { distanceScale: 60 / CAMERA_DISTANCE_FAR, targetY };
}

/** Fog, SPEC §6.1. */
export const FOG_NEAR = 8;
export const FOG_FAR = 40;

export interface Tier {
  index: number;
  radius: number;
  /** Cylinder height; inner tiers hang deeper, like the stages of a dilution refrigerator. */
  height: number;
  /** y of the cylinder centre. */
  centerY: number;
  bottomY: number;
  thickness: number;
  /** Glass thickness parameter 0.4 → 1.2 across the tiers. */
  glassThickness: number;
  /** Roughness 0.05 → 0.15 across the tiers. */
  roughness: number;
}

export function tiers(): Tier[] {
  const out: Tier[] = [];
  for (let i = 0; i < TIERS; i++) {
    const t = i / (TIERS - 1);
    const radius = TIER_OUTER_RADIUS + (TIER_INNER_RADIUS - TIER_OUTER_RADIUS) * t;
    const height = 1.0 + 0.2 * i;
    const bottomY = PLATE_Y - height;
    out.push({
      index: i,
      radius,
      height,
      centerY: PLATE_Y - height / 2,
      bottomY,
      thickness: TIER_THICKNESS,
      glassThickness: 0.4 + 0.8 * t,
      roughness: 0.05 + 0.1 * t,
    });
  }
  return out;
}

/** Anchor angle for worker k: 45° spacing, SPEC §6.3. */
export function anchorAngle(index: number): number {
  return (index * Math.PI) / 4;
}

export const ANCHOR_Y = 1.95;
export const ANCHOR_RADIUS = TIER_OUTER_RADIUS;

export function anchorPosition(index: number): Vector3 {
  const a = anchorAngle(index);
  return new Vector3(Math.cos(a) * ANCHOR_RADIUS, ANCHOR_Y, Math.sin(a) * ANCHOR_RADIUS);
}

export function workerIndex(worker: WorkerName): number {
  return WORKER_NAMES.indexOf(worker);
}

/** Outward unit normal at an anchor (for the cap, the ring and the crack decal). */
export function anchorNormal(index: number): Vector3 {
  const a = anchorAngle(index);
  return new Vector3(Math.cos(a), 0, Math.sin(a));
}

/**
 * The strand curve: core → anchor, spiralling outward through the tiers (SPEC §6.3).
 * Deterministic per worker so a recorded stream reproduces exactly.
 */
export function strandCurve(worker: WorkerName): CatmullRomCurve3 {
  const k = workerIndex(worker);
  const a0 = anchorAngle(k);
  const pts: Vector3[] = [];
  const ts = tiers();
  // a third of a turn of spiral from the core to the anchor
  const twist = -Math.PI / 3;
  for (let i = TIERS - 1; i >= 1; i--) {
    const tier = ts[i]!;
    const f = (TIERS - 1 - i) / (TIERS - 1); // 0 at innermost, →1 at outermost
    const ang = a0 + twist * (1 - f);
    const r = tier.radius - tier.thickness * 1.5;
    const y = CORE_POSITION.y + (ANCHOR_Y - CORE_POSITION.y) * (f * f * 0.7 + f * 0.3) - 0.15 * Math.sin(f * Math.PI);
    pts.push(new Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
  }
  pts.push(anchorPosition(k));
  // leave from the core's surface, not its centre, so eight strands never pile up inside it
  const first = pts[0]!;
  const surface = first.clone().sub(CORE_POSITION).normalize().multiplyScalar(CORE_RADIUS * 0.92).add(CORE_POSITION);
  pts.unshift(surface);
  return new CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

export const STRAND_RADIUS = 0.025;
export const STRAND_SEGMENTS = 64;
export const STRAND_RADIAL_SEGMENTS = 8;

/** All eight strand curves. */
export function strandCurves(): Record<WorkerName, CatmullRomCurve3> {
  const out = {} as Record<WorkerName, CatmullRomCurve3>;
  for (const w of WORKER_NAMES) out[w] = strandCurve(w);
  return out;
}

/* ───────────────────────── QSD layout (§6.5) ───────────────────────── */

export const CHAIN_RING_RADIUS = 0.95;
export const CHAIN_LINK_SIZE = 0.05;
export const CHAIN_LINK_PITCH = 0.058;
export const CHAIN_BASE_Y = CORE_POSITION.y - 0.42;

/** Position of link `depth` of chain `chain`: vertical columns on a cylinder around the core. */
export function chainLinkPosition(chain: number, depth: number, out = new Vector3()): Vector3 {
  const a = (chain / QSD_CHAINS) * Math.PI * 2;
  return out.set(Math.cos(a) * CHAIN_RING_RADIUS, CHAIN_BASE_Y + depth * CHAIN_LINK_PITCH, Math.sin(a) * CHAIN_RING_RADIUS);
}

export function chainTopY(): number {
  return CHAIN_BASE_Y + (QSD_DEPTH - 1) * CHAIN_LINK_PITCH;
}

/** Number of merkle nodes at fused level L (0 = 256 leaves, 8 = one root). */
export function merkleNodesAtLevel(level: number): number {
  return MERKLE_LEAVES >> Math.max(0, Math.min(MERKLE_LEVELS, level));
}

export const MERKLE_LEAF_Y = chainTopY() + 0.25;
export const MERKLE_ROOT_Y = MERKLE_LEAF_Y + 0.5;

/** Position of node i at level L: rings shrinking and rising toward the single white root. */
export function merkleNodePosition(level: number, i: number, out = new Vector3()): Vector3 {
  const n = merkleNodesAtLevel(level);
  if (n <= 1) return out.set(0, MERKLE_ROOT_Y, 0);
  const t = level / MERKLE_LEVELS;
  const r = 1.15 * (1 - t) + 0.08 * t;
  const a = (i / n) * Math.PI * 2;
  const y = MERKLE_LEAF_Y + (MERKLE_ROOT_Y - MERKLE_LEAF_Y) * t;
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

/** The ring the 67 signing cubes lift into. */
export const SIGN_RING_RADIUS = 1.3;
export const SIGN_RING_Y = CORE_POSITION.y + 0.55;

export function signRingPosition(chain: number, out = new Vector3()): Vector3 {
  const a = (chain / QSD_CHAINS) * Math.PI * 2;
  return out.set(Math.cos(a) * SIGN_RING_RADIUS, SIGN_RING_Y, Math.sin(a) * SIGN_RING_RADIUS);
}

/** Where the anchoring block seals, on a lane of light from the core. */
export const ANCHOR_BLOCK_POSITION = new Vector3(1.35, CORE_POSITION.y + 0.1, 0.4);

/** The superposition band and half-life ring. */
export const SUPERPOSITION_BAND_RADIUS = 0.5;
export const HALF_LIFE_RING_RADIUS = 0.72;
