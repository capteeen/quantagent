/**
 * Superposition geometry, SPEC §6.4: on Worker.candidates(N) the tube splits into N ghost
 * tubes (radius 0.012, opacity 0.35, slight random curvature) spreading near the anchor,
 * each ending in a glass bead. Pure and seeded: the same worker and candidates always fan
 * the same way, so a recorded stream reproduces.
 */
import { CatmullRomCurve3, Vector3 } from "three";
import type { Candidate, WorkerName } from "@quantagent/core/types";
import { anchorNormal, strandCurve, workerIndex } from "../layout";
import { hashString, seeded } from "../perf/dispose";

/** Where along the strand the ghosts leave the tube. */
export const FAN_SPLIT_T = 0.72;
export const FAN_SPREAD_MIN = 0.28;
export const FAN_SPREAD_MAX = 0.5;
export const GHOST_SEGMENTS = 32;
export const GHOST_RADIAL = 6;
export const BEAD_RADIUS = 0.035;

export interface Ghost {
  candidate: Candidate;
  curve: CatmullRomCurve3;
  /** Bead position (the curve's end). */
  bead: Vector3;
}

export function fanGhosts(worker: WorkerName, candidates: readonly Candidate[]): Ghost[] {
  const main = strandCurve(worker);
  const split = main.getPointAt(FAN_SPLIT_T);
  const mid = main.getPointAt((FAN_SPLIT_T + 1) / 2);
  const anchor = main.getPointAt(1);
  const normal = anchorNormal(workerIndex(worker));
  // tangent plane at the anchor: up and a sideways vector
  const up = new Vector3(0, 1, 0);
  const side = new Vector3().crossVectors(up, normal).normalize();
  const n = candidates.length;
  return candidates.map((candidate, i) => {
    const rnd = seeded(hashString(`${worker}:${candidate.id}:${i}`));
    // spread angle across ±70° around "up", ordered so neighbours sit beside each other
    const spreadAngle = n === 1 ? 0 : (-70 + (140 * i) / (n - 1)) * (Math.PI / 180);
    const radius = FAN_SPREAD_MIN + (FAN_SPREAD_MAX - FAN_SPREAD_MIN) * rnd();
    const offset = new Vector3()
      .addScaledVector(up, Math.cos(spreadAngle) * radius)
      .addScaledVector(side, Math.sin(spreadAngle) * radius)
      .addScaledVector(normal, -0.2 - 0.25 * rnd());
    const bead = anchor.clone().add(offset);
    // slight random curvature through a displaced midpoint
    const bend = new Vector3((rnd() - 0.5) * 0.18, (rnd() - 0.5) * 0.18, (rnd() - 0.5) * 0.18);
    const midPoint = mid.clone().lerp(bead, 0.35).add(bend);
    const curve = new CatmullRomCurve3([split.clone(), midPoint, bead.clone()], false, "catmullrom", 0.5);
    return { candidate, curve, bead };
  });
}
