import { describe, expect, it } from "vitest";
import { COLLAPSE, collapseFrame, ringAt } from "../src/chamber/collapse/timeline";
import { CONVERGENCE, convergenceFrame } from "../src/chamber/convergence/timeline";
import { MS, SPEED, ease, motionDurations } from "../src/chamber/motion";

describe("motion (SPEC §6.1)", () => {
  it("eases with cubic-bezier(0.4,0,0.2,1): monotonic, 0→1, slow in, fast out", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = ease(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(ease(0.5)).toBeGreaterThan(0.6);
    expect(ease(0.2)).toBeLessThan(0.2);
  });

  it("nothing but a collapse is shorter than 700ms", () => {
    for (const [k, v] of Object.entries(MS)) {
      // the fan (600ms) belongs to the §6.4 collapse family, the only exception
      if (k === "reducedFade" || k === "igniteStagger" || k === "min" || k === "fan") continue;
      expect(v, k).toBeGreaterThanOrEqual(700);
    }
    expect(SPEED.pulse).toBe(1.5);
    expect(SPEED.orbitDegPerSec).toBe(0.3);
    expect(SPEED.breatheAmplitude).toBe(0.02);
    expect(SPEED.vapour).toBe(0.05);
  });

  it("reduced motion replaces shower, flicker and aberration with a 200ms fade and stops the orbit", () => {
    const full = motionDurations(false);
    expect(full).toEqual({ showerMs: 500, flickerMs: 400, aberrationMs: 120, fadeMs: 0, orbitDegPerSec: 0.3 });
    const reduced = motionDurations(true);
    expect(reduced).toEqual({ showerMs: 0, flickerMs: 0, aberrationMs: 0, fadeMs: 200, orbitDegPerSec: 0 });
  });
});

describe("the collapse (SPEC §6.4), exactly", () => {
  const opts = { reducedMotion: false, shower: true };

  it("t=0: chamber dims to 40% and the white beam starts (200ms)", () => {
    const f = collapseFrame(0, opts);
    expect(f.brightness).toBe(0.4);
    expect(f.beam).toBe(0);
    expect(collapseFrame(199, opts).beam).not.toBeNull();
    expect(collapseFrame(200, opts).beam).toBeNull();
    expect(f.shower).toBeNull();
    expect(f.snapped).toBe(false);
  });

  it("t=300: 120 photon sprites fall for 500ms", () => {
    expect(COLLAPSE.photonCount).toBe(120);
    expect(collapseFrame(299, opts).shower).toBeNull();
    expect(collapseFrame(300, opts).shower).toBe(0);
    expect(collapseFrame(550, opts).shower).toBeCloseTo(0.5);
    expect(collapseFrame(800, opts).shower).toBeNull();
  });

  it("t=800: ghosts flicker 0.2↔0.6 at 24Hz for 400ms, beads jitter ±0.02", () => {
    expect(collapseFrame(799, opts).flickerOpacity).toBeNull();
    const period = 1000 / 24;
    const a = collapseFrame(800, opts);
    const b = collapseFrame(800 + period / 2, opts);
    expect(a.flickerOpacity).toBe(0.6);
    expect(b.flickerOpacity).toBe(0.2);
    expect(collapseFrame(800 + period, opts).flickerOpacity).toBe(0.6);
    expect(a.beadJitter).toBe(0.02);
    expect(collapseFrame(1199, opts).flickerOpacity).not.toBeNull();
    expect(collapseFrame(1200, opts).flickerOpacity).toBeNull();
    expect(collapseFrame(1200, opts).beadJitter).toBe(0);
  });

  it("t=1200: the snap. ring 0.1→1.4 over 450ms, core flash 2 frames, aberration 0.004 for 120ms then decays", () => {
    expect(collapseFrame(1199, opts).snapped).toBe(false);
    const s = collapseFrame(1200, { ...opts, framesSinceSnap: 0 });
    expect(s.snapped).toBe(true);
    expect(s.ring).toBe(0);
    expect(ringAt(0)).toEqual({ radius: 0.1, opacity: 1 });
    expect(ringAt(1).radius).toBeCloseTo(1.4);
    expect(ringAt(1).opacity).toBeCloseTo(0);
    expect(collapseFrame(1650, opts).ring).toBeNull();
    expect(s.coreFlash).toBe(true);
    expect(collapseFrame(1210, { ...opts, framesSinceSnap: 1 }).coreFlash).toBe(true);
    expect(collapseFrame(1220, { ...opts, framesSinceSnap: 2 }).coreFlash).toBe(false);
    expect(s.aberration).toBe(0.004);
    expect(collapseFrame(1319, opts).aberration).toBe(0.004);
    expect(collapseFrame(1320 + 150, opts).aberration).toBeCloseTo(0.002);
    expect(collapseFrame(1620, opts).aberration).toBe(0);
    expect(COLLAPSE.toneHz).toBe(1046.5);
    expect(COLLAPSE.toneMs).toBe(300);
  });

  it("t=1250: the proof hash types in over 300ms; t=1700: brightness restores over 500ms", () => {
    expect(collapseFrame(1249, opts).hashTyped).toBe(0);
    expect(collapseFrame(1400, opts).hashTyped).toBeCloseTo(0.5);
    expect(collapseFrame(1550, opts).hashTyped).toBe(1);
    expect(collapseFrame(1699, opts).brightness).toBe(0.4);
    expect(collapseFrame(1700, opts).brightness).toBe(0.4);
    expect(collapseFrame(1950, opts).brightness).toBeGreaterThan(0.4);
    expect(collapseFrame(1950, opts).brightness).toBeLessThan(1);
    expect(collapseFrame(2200, opts).brightness).toBe(1);
    expect(collapseFrame(2199, opts).done).toBe(false);
    expect(collapseFrame(2200, opts).done).toBe(true);
  });

  it("a user pick (no entropy requested) has no beam and no shower but still snaps", () => {
    const o = { reducedMotion: false, shower: false };
    expect(collapseFrame(0, o).beam).toBeNull();
    expect(collapseFrame(400, o).shower).toBeNull();
    expect(collapseFrame(1200, o).snapped).toBe(true);
    expect(collapseFrame(1200, o).ring).toBe(0);
  });

  it("reduced motion: no shower, no 24Hz flicker, no aberration; 200ms fades; snap, ring and hash keep their timing", () => {
    const r = { reducedMotion: true, shower: true };
    expect(collapseFrame(0, r).beam).toBeNull();
    expect(collapseFrame(400, r).shower).toBeNull();
    // the dim is itself a 200ms fade
    expect(collapseFrame(0, r).brightness).toBe(1);
    expect(collapseFrame(200, r).brightness).toBeCloseTo(0.4);
    const f = collapseFrame(900, r);
    expect(f.beadJitter).toBe(0);
    expect(f.reducedFade).not.toBeNull();
    expect(f.flickerOpacity).toBeGreaterThan(0.35);
    expect(f.flickerOpacity).toBeLessThanOrEqual(0.6);
    expect(collapseFrame(820, r).flickerOpacity).not.toBe(0.2);
    expect(collapseFrame(1200, { ...r, framesSinceSnap: 0 }).snapped).toBe(true);
    expect(collapseFrame(1200, r).ring).toBe(0);
    expect(collapseFrame(1250, r).aberration).toBe(0);
    expect(collapseFrame(1550, r).hashTyped).toBe(1);
    expect(collapseFrame(2200, r).done).toBe(true);
  });
});

describe("the convergence (SPEC §6.6)", () => {
  it("final pulses meet at 900ms; the core expands 0.35→0.55 over 600ms; CA then URL at 1500ms; live at 1800ms", () => {
    expect(convergenceFrame(0).finalPulse).toBe(0);
    expect(convergenceFrame(450).finalPulse).toBeCloseTo(0.5);
    expect(convergenceFrame(899).met).toBe(false);
    expect(convergenceFrame(900).finalPulse).toBeNull();
    expect(convergenceFrame(900).met).toBe(true);
    expect(convergenceFrame(0).coreRadius).toBe(0.35);
    expect(convergenceFrame(900).coreRadius).toBe(0.35);
    expect(convergenceFrame(1500).coreRadius).toBeCloseTo(0.55);
    expect(convergenceFrame(1499).caTyped).toBe(0);
    expect(convergenceFrame(1499).relaxed).toBe(false);
    expect(convergenceFrame(1500).relaxed).toBe(true);
    expect(convergenceFrame(1500 + CONVERGENCE.typeMs).caTyped).toBe(1);
    expect(convergenceFrame(1500 + CONVERGENCE.typeMs).urlTyped).toBe(0);
    expect(convergenceFrame(1500 + 2 * CONVERGENCE.typeMs).urlTyped).toBe(1);
    expect(convergenceFrame(1799).live).toBe(false);
    expect(convergenceFrame(1800).live).toBe(true);
  });
});
