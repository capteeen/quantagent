import { describe, expect, it } from "vitest";
import { WORKER_NAMES } from "@quantagent/core/types";
import { PerspectiveCamera, Vector3 } from "three";
import {
  CAMERA_DISTANCE_FAR,
  CAMERA_FOV,
  CAMERA_POSITION,
  CAMERA_TARGET,
  CORE_POSITION,
  CORE_RADIUS,
  FOG_FAR,
  FOG_NEAR,
  PLATE_RADIUS,
  PLATE_THICKNESS,
  PLATE_Y,
  anchorAngle,
  anchorPosition,
  fitFraming,
  chainLinkPosition,
  merkleNodePosition,
  merkleNodesAtLevel,
  strandCurve,
  strandCurves,
  tiers,
  CHAIN_LINK_SIZE,
  STRAND_RADIUS,
  STRAND_SEGMENTS,
  TIER_THICKNESS,
} from "../src/chamber/layout";
import { QSD_CHAINS, QSD_DEPTH, QSD_LINKS, MERKLE_LEAVES, MERKLE_LEVELS } from "../src/chamber/types";

describe("vessel layout (SPEC §6.2)", () => {
  it("eight nested glass cylinders, radius 3.0 → 0.6, 0.08 thick, glass 0.4–1.2, roughness 0.05–0.15", () => {
    const t = tiers();
    expect(t).toHaveLength(8);
    expect(t[0]!.radius).toBe(3.0);
    expect(t[7]!.radius).toBeCloseTo(0.6);
    for (let i = 1; i < 8; i++) expect(t[i]!.radius).toBeLessThan(t[i - 1]!.radius);
    for (const tier of t) {
      expect(tier.thickness).toBe(TIER_THICKNESS);
      expect(tier.glassThickness).toBeGreaterThanOrEqual(0.4);
      expect(tier.glassThickness).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(tier.roughness).toBeGreaterThanOrEqual(0.05);
      expect(tier.roughness).toBeLessThanOrEqual(0.15 + 1e-9);
    }
    expect(CORE_RADIUS).toBe(0.35);
    expect(CAMERA_POSITION.toArray()).toEqual([0, 1.2, 7.5]);
    expect(CAMERA_TARGET.toArray()).toEqual([0, 0.4, 0]);
    expect(CAMERA_FOV).toBe(38);
    expect(FOG_NEAR).toBe(8);
    expect(FOG_FAR).toBe(40);
  });
});

describe("strands (SPEC §6.3)", () => {
  it("eight strands, eight anchors at 45° on the outermost cylinder, radius 0.025, 64 segments", () => {
    const curves = strandCurves();
    expect(Object.keys(curves)).toHaveLength(8);
    expect(STRAND_RADIUS).toBe(0.025);
    expect(STRAND_SEGMENTS).toBe(64);
    for (let k = 0; k < 8; k++) {
      expect(anchorAngle(k)).toBeCloseTo((k * Math.PI) / 4);
      const p = anchorPosition(k);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(3.0);
    }
    for (const w of WORKER_NAMES) {
      const c = strandCurve(w);
      // leaves from the core's surface (radius 0.35), heading outward
      expect(c.getPoint(0).distanceTo(CORE_POSITION)).toBeCloseTo(0.35 * 0.92);
      const end = c.getPoint(1);
      expect(Math.hypot(end.x, end.z)).toBeCloseTo(3.0);
      // deterministic: the same worker gives the same curve
      expect(strandCurve(w).getPoint(0.5).toArray()).toEqual(c.getPoint(0.5).toArray());
      expect(c.getLength()).toBeGreaterThan(3);
    }
  });
});

describe("QSD layout (SPEC §6.5)", () => {
  it("67 chains × 16 links = 1072 glass cubes of 0.05, in a cylinder around the core", () => {
    expect(QSD_CHAINS).toBe(67);
    expect(QSD_DEPTH).toBe(16);
    expect(QSD_LINKS).toBe(1072);
    expect(CHAIN_LINK_SIZE).toBe(0.05);
    const seen = new Set<string>();
    for (let c = 0; c < QSD_CHAINS; c++) {
      for (let d = 0; d < QSD_DEPTH; d++) {
        const p = chainLinkPosition(c, d);
        expect(Math.hypot(p.x, p.z)).toBeCloseTo(0.95);
        seen.add(p.toArray().map((v) => v.toFixed(4)).join(","));
      }
    }
    expect(seen.size).toBe(1072);
  });

  it("256 leaves fuse pairwise over 8 levels to one white root", () => {
    expect(MERKLE_LEAVES).toBe(256);
    expect(MERKLE_LEVELS).toBe(8);
    expect(merkleNodesAtLevel(0)).toBe(256);
    expect(merkleNodesAtLevel(1)).toBe(128);
    expect(merkleNodesAtLevel(8)).toBe(1);
    const root = merkleNodePosition(8, 0);
    expect(root.x).toBe(0);
    expect(root.z).toBe(0);
    expect(root.y).toBeGreaterThan(merkleNodePosition(0, 0).y);
  });
});

describe("fit framing", () => {
  const corners = (aspect: number) => {
    const f = fitFraming(aspect);
    const elev = Math.atan2(CAMERA_POSITION.y - CAMERA_TARGET.y, CAMERA_POSITION.z);
    const d = CAMERA_DISTANCE_FAR * f.distanceScale;
    const cam = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 200);
    cam.position.set(0, f.targetY + Math.sin(elev) * d, Math.cos(elev) * d);
    cam.lookAt(new Vector3(0, f.targetY, 0));
    cam.updateMatrixWorld();
    const pts = [new Vector3(PLATE_RADIUS, PLATE_Y + PLATE_THICKNESS, 0), new Vector3(0, PLATE_Y + PLATE_THICKNESS, PLATE_RADIUS), new Vector3(0, CORE_POSITION.y - CORE_RADIUS, 0), ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => anchorPosition(k))];
    return { f, ndc: pts.map((p) => p.clone().project(cam)) };
  };

  it.each([390 / 844, 552 / 456, 1440 / 576])("keeps the plate, every anchor and the core in frame at aspect %f", (aspect) => {
    const { ndc } = corners(aspect);
    for (const p of ndc) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
  });

  it("never comes closer than the spec distance, and pulls back further on a phone than on a desktop", () => {
    const phone = fitFraming(390 / 844);
    const desk = fitFraming(1440 / 576);
    expect(desk.distanceScale).toBeGreaterThanOrEqual(1);
    expect(phone.distanceScale).toBeGreaterThan(desk.distanceScale);
    expect(phone.targetY).toBeGreaterThan(CAMERA_TARGET.y);
  });
});
