/**
 * The degradation ladder, SPEC §6.7. Degrade in order:
 *   particles → bloom radius → DOF → iridescence → aberration
 * NEVER degrade strand count, pulse fidelity, the collapse sequence, or the chain link count.
 */
export const PERF_LADDER = ["particles", "bloomRadius", "dof", "iridescence", "aberration"] as const;
export type PerfStep = (typeof PERF_LADDER)[number];
export const PERF_MAX_TIER = PERF_LADDER.length;

export interface PerfSettings {
  tier: number;
  /** Cryogenic vapour points (200 at full). */
  vapourCount: number;
  /** Ignition trailing sparks per strand (30 at full; part of the ignition, kept). */
  sparkCount: number;
  bloomRadius: number;
  dof: boolean;
  iridescence: number;
  /** Whether the chromatic aberration pass is mounted at all. */
  aberration: boolean;
  /** Never changes. */
  strandCount: 8;
  chainLinks: 1072;
}

export const FULL_VAPOUR = 200;
export const DEGRADED_VAPOUR = 60;
export const FULL_BLOOM_RADIUS = 0.6;
export const DEGRADED_BLOOM_RADIUS = 0.3;
export const FULL_IRIDESCENCE = 0.6;

export function perfSettings(tier: number): PerfSettings {
  const t = Math.max(0, Math.min(PERF_MAX_TIER, Math.floor(tier)));
  const degraded = (step: PerfStep) => t > PERF_LADDER.indexOf(step);
  return {
    tier: t,
    vapourCount: degraded("particles") ? DEGRADED_VAPOUR : FULL_VAPOUR,
    sparkCount: 30,
    bloomRadius: degraded("bloomRadius") ? DEGRADED_BLOOM_RADIUS : FULL_BLOOM_RADIUS,
    dof: !degraded("dof"),
    iridescence: degraded("iridescence") ? 0 : FULL_IRIDESCENCE,
    aberration: !degraded("aberration"),
    strandCount: 8,
    chainLinks: 1072,
  };
}

/** Thresholds with hysteresis: degrade when the median drops under 55fps, restore above 58. */
export const DEGRADE_BELOW_FPS = 55;
export const RESTORE_ABOVE_FPS = 58;
/** How long the median must sit under/over the threshold before a step is taken. */
export const DEGRADE_HOLD_MS = 1500;
export const RESTORE_HOLD_MS = 8000;

export interface LadderState {
  tier: number;
  /** Timestamp the median first crossed the current threshold, or null. */
  since: number | null;
  direction: "down" | "up" | null;
}

export function initialLadder(tier = 0): LadderState {
  return { tier, since: null, direction: null };
}

/** Pure step: given the current median fps and the clock, decide the next tier. */
export function stepLadder(s: LadderState, medianFps: number | null, now: number): LadderState {
  if (medianFps === null) return s;
  if (medianFps < DEGRADE_BELOW_FPS && s.tier < PERF_MAX_TIER) {
    if (s.direction !== "down" || s.since === null) return { ...s, direction: "down", since: now };
    if (now - s.since >= DEGRADE_HOLD_MS) return { tier: s.tier + 1, direction: null, since: null };
    return s;
  }
  if (medianFps > RESTORE_ABOVE_FPS && s.tier > 0) {
    if (s.direction !== "up" || s.since === null) return { ...s, direction: "up", since: now };
    if (now - s.since >= RESTORE_HOLD_MS) return { tier: s.tier - 1, direction: null, since: null };
    return s;
  }
  return s.direction === null ? s : { ...s, direction: null, since: null };
}
