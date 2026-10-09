/**
 * Motion constants for the chamber (SPEC §6.1, §6.7).
 *
 * Nothing snaps except a collapse. Everything else is a fixed-duration transition
 * started by an event, eased with cubic-bezier(0.4,0,0.2,1), 700ms or longer.
 * The ONLY time-driven motion is idle ambience: camera orbit, dolly breathing,
 * vapour drift and the core pulse.
 */

export const EASING_CSS = "cubic-bezier(0.4,0,0.2,1)";

/** cubic-bezier(0.4,0,0.2,1) evaluated at t∈[0,1] (Newton on the x curve, then y). */
export function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const x1 = 0.4;
  const y1 = 0;
  const x2 = 0.2;
  const y2 = 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const dX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const x = sampleX(u) - t;
    const d = dX(u);
    if (Math.abs(x) < 1e-6) break;
    if (Math.abs(d) < 1e-6) break;
    u -= x / d;
  }
  u = Math.min(1, Math.max(0, u));
  return sampleY(u);
}

/** 0..1 progress of a transition that started at `start` and lasts `duration` ms, eased. */
export function progress(now: number, start: number, duration: number): number {
  if (duration <= 0) return now >= start ? 1 : 0;
  return ease((now - start) / duration);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fixed durations in milliseconds, each tied to an event-started transition. */
export const MS = {
  /** Minimum for anything that is not a collapse snap. */
  min: 700,
  /** Launch.started → strands grow core→anchor. */
  ignite: 900,
  /** All eight ignite within this window. */
  igniteStagger: 100,
  /** awaiting approval: amber breathe period. */
  approvalBreathe: 800,
  /** Worker.failed: desaturate to #3A4049. */
  fail: 1200,
  /** Worker.done: ring flash at the anchor. */
  ringFlash: 700,
  /** Worker.candidates: the tube splits into N ghost tubes. */
  fan: 600,
  /** Launcher.qsdStage keyGeneration / anchoring: camera dolly. */
  dolly: 1200,
  /** A chain link / merkle node / sign-ring cube appearing or moving. */
  qsdLink: 700,
  /** tx signature or hash typing in (longer than the 300ms proof hash; it is not a collapse). */
  qsdType: 700,
  /** Reduced-motion replacement for shower / flicker / aberration. */
  reducedFade: 200,
  /** Idle core pulse period (ambience). */
  corePulse: 2400,
  /** Dolly breathing period (ambience). */
  breathe: 6000,
} as const;

/** Speeds. */
export const SPEED = {
  /** Pulses core→anchor, units per second. */
  pulse: 1.5,
  /** Idle camera orbit, degrees per second. */
  orbitDegPerSec: 0.3,
  /** Dolly breathing amplitude as a fraction of distance. */
  breatheAmplitude: 0.02,
  /** Vapour drift, units per second. */
  vapour: 0.05,
} as const;

/**
 * Durations that reduced motion changes. Everything else keeps its timing:
 * remove motion, never information.
 */
export interface MotionDurations {
  /** Photon shower length (0 → no shower, a 200ms fade instead). */
  showerMs: number;
  /** Ghost flicker length (0 → a 200ms fade instead). */
  flickerMs: number;
  /** Chromatic aberration spike hold (0 → none). */
  aberrationMs: number;
  /** The replacement fade when the above are removed. */
  fadeMs: number;
  /** Orbit speed in deg/s (0 under reduced motion). */
  orbitDegPerSec: number;
}

export function motionDurations(reducedMotion: boolean): MotionDurations {
  return reducedMotion
    ? { showerMs: 0, flickerMs: 0, aberrationMs: 0, fadeMs: MS.reducedFade, orbitDegPerSec: 0 }
    : { showerMs: 500, flickerMs: 400, aberrationMs: 120, fadeMs: 0, orbitDegPerSec: SPEED.orbitDegPerSec };
}
