/**
 * The collapse timeline, SPEC §6.4, as a pure function of elapsed milliseconds.
 * Every number below is the spec's. The scene samples this each frame; tests assert it.
 *
 *   t=0       chamber dims to 40%; a white beam leaves the core upward, 200ms additive
 *   t=300ms   120 photon sprites fall into the vessel, converging on the fan (500ms)
 *   t=800ms   ghost tubes flicker 0.2↔0.6 at 24Hz for 400ms, beads jitter ±0.02
 *   t=1200ms  COLLAPSE: non-chosen vanish in one frame; chosen snaps to full; torus
 *             0.1→1.4 (450ms, opacity 1→0); core flashes white 2 frames; chromatic
 *             aberration 0.004 for 120ms then decays; C6 tone
 *   t=1250ms  proof hash types in (JetBrains Mono 11px #4DD0E1, 300ms, char by char)
 *   t=1700ms  chamber returns to full brightness over 500ms
 *
 * Reduced motion: the shower, the flicker and the aberration are replaced by a 200ms
 * fade; the snap, the ring, the flash and the hash keep their timing (information stays).
 */
import { clamp01, ease, motionDurations } from "../motion";

export const COLLAPSE = {
  dimTo: 0.4,
  beamStart: 0,
  beamMs: 200,
  showerStart: 300,
  showerMs: 500,
  photonCount: 120,
  flickerStart: 800,
  flickerMs: 400,
  flickerHz: 24,
  flickerLo: 0.2,
  flickerHi: 0.6,
  beadJitter: 0.02,
  snapAt: 1200,
  ringMs: 450,
  ringFrom: 0.1,
  ringTo: 1.4,
  coreFlashFrames: 2,
  aberration: 0.004,
  aberrationHoldMs: 120,
  aberrationDecayMs: 300,
  hashStart: 1250,
  hashMs: 300,
  restoreStart: 1700,
  restoreMs: 500,
  /** Total length: everything is back to normal. */
  totalMs: 2200,
  /** Worker.candidates → fan grows over this. */
  fanMs: 600,
  ghostRadius: 0.012,
  ghostOpacity: 0.35,
  /** C6 */
  toneHz: 1046.5,
  toneMs: 300,
} as const;

export interface CollapseFrame {
  /** 0.4 → 1 chamber brightness multiplier. */
  brightness: number;
  /** 0..1 beam progress, null when no beam. */
  beam: number | null;
  /** 0..1 shower progress (sprites falling), null when no shower is showing. */
  shower: number | null;
  /** Ghost tube opacity override while flickering, null otherwise. */
  flickerOpacity: number | null;
  /** Bead jitter amplitude (0 outside the flicker window). */
  beadJitter: number;
  /** True from the snap frame on. */
  snapped: boolean;
  /** 0..1 ring expansion progress, null outside the ring window. */
  ring: number | null;
  /** True for exactly the 2 frames after the snap. */
  coreFlash: boolean;
  /** Chromatic aberration offset, 0 outside the spike. */
  aberration: number;
  /** 0..1 fraction of the proof hash typed in. */
  hashTyped: number;
  /** Under reduced motion: 0..1 progress of the fade that replaces shower/flicker, null otherwise. */
  reducedFade: number | null;
  done: boolean;
}

export interface CollapseOptions {
  reducedMotion: boolean;
  /** false for Orchestrator.userPicked: no entropy was requested, so no beam and no shower. */
  shower: boolean;
  /** Frames rendered since the snap, for the 2-frame core flash. Caller tracks it. */
  framesSinceSnap?: number;
}

export function collapseFrame(ms: number, opts: CollapseOptions): CollapseFrame {
  const d = motionDurations(opts.reducedMotion);
  const C = COLLAPSE;
  const withShower = opts.shower && !opts.reducedMotion;

  // brightness: dim to 0.4 at t0 (through a 200ms fade under reduced motion, else immediately
  // with the beam), restore 1700→2200.
  let brightness: number;
  if (ms < C.restoreStart) {
    brightness = opts.reducedMotion ? 1 - (1 - C.dimTo) * ease(clamp01(ms / d.fadeMs)) : C.dimTo;
  } else {
    brightness = C.dimTo + (1 - C.dimTo) * ease(clamp01((ms - C.restoreStart) / C.restoreMs));
  }
  if (ms < 0) brightness = 1;

  const beam = withShower && ms >= C.beamStart && ms < C.beamStart + C.beamMs ? (ms - C.beamStart) / C.beamMs : null;

  const shower =
    withShower && ms >= C.showerStart && ms < C.showerStart + d.showerMs ? (ms - C.showerStart) / d.showerMs : null;

  let flickerOpacity: number | null = null;
  let beadJitter = 0;
  let reducedFade: number | null = null;
  if (ms >= C.flickerStart && ms < C.flickerStart + C.flickerMs) {
    if (opts.reducedMotion) {
      // a 200ms fade from 0.35 toward 0.6 in place of the 24Hz flicker
      reducedFade = clamp01((ms - C.flickerStart) / d.fadeMs);
      flickerOpacity = C.ghostOpacity + (C.flickerHi - C.ghostOpacity) * ease(reducedFade);
    } else {
      // cycles since the flicker began, rounded so a float modulo never lands a hair early
      const cycles = Math.round(((ms - C.flickerStart) * C.flickerHz) / 1000 * 1e6) / 1e6;
      const phaseOn = cycles - Math.floor(cycles) < 0.5;
      flickerOpacity = phaseOn ? C.flickerHi : C.flickerLo;
      beadJitter = C.beadJitter;
    }
  }

  const snapped = ms >= C.snapAt;
  const ring = snapped && ms < C.snapAt + C.ringMs ? (ms - C.snapAt) / C.ringMs : null;
  const coreFlash = snapped && (opts.framesSinceSnap ?? 0) < C.coreFlashFrames;

  let aberration = 0;
  if (snapped && !opts.reducedMotion) {
    const t = ms - C.snapAt;
    if (t < C.aberrationHoldMs) aberration = C.aberration;
    else if (t < C.aberrationHoldMs + C.aberrationDecayMs) {
      aberration = C.aberration * (1 - (t - C.aberrationHoldMs) / C.aberrationDecayMs);
    }
  }

  const hashTyped = ms < C.hashStart ? 0 : clamp01((ms - C.hashStart) / C.hashMs);

  return {
    brightness,
    beam,
    shower,
    flickerOpacity,
    beadJitter,
    snapped,
    ring,
    coreFlash,
    aberration,
    hashTyped,
    reducedFade,
    done: ms >= C.totalMs,
  };
}

/** Ring radius and opacity at ring progress p∈[0,1]. */
export function ringAt(p: number): { radius: number; opacity: number } {
  const e = ease(p);
  return { radius: COLLAPSE.ringFrom + (COLLAPSE.ringTo - COLLAPSE.ringFrom) * e, opacity: 1 - e };
}
