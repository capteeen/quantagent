/**
 * Launch.live convergence, SPEC §6.6, as a pure function of elapsed milliseconds.
 *
 *   t=0       every sealed strand sends one final bright pulse anchor→core at once
 *   t=900ms   pulses meet; the core flashes and expands 0.35→0.55 over 600ms; its glass
 *             becomes a spherical frame around the coin's real logo, lit from within
 *   t=1500ms  the CA types in beneath the core; the site URL beneath that; strands relax
 *   t=1800ms  the CoinCard slides up (the app's job; the chamber fires onLive here)
 */
import { clamp01, ease } from "../motion";

export const CONVERGENCE = {
  finalPulseMs: 900,
  meetAt: 900,
  coreFrom: 0.35,
  coreTo: 0.55,
  coreExpandMs: 600,
  typeStart: 1500,
  /** CA and URL type over this, char by char. */
  typeMs: 700,
  liveAt: 1800,
  totalMs: 2500,
} as const;

export interface ConvergenceFrame {
  /** 0..1 progress of the final anchor→core pulses (null after they meet). */
  finalPulse: number | null;
  /** Core radius. */
  coreRadius: number;
  /** True on the frame the pulses meet (for the flash); callers hold it for 2 frames. */
  met: boolean;
  /** 0..1 logo frame reveal (inner sphere lit from within). */
  logoReveal: number;
  /** 0..1 fraction of the CA typed. */
  caTyped: number;
  /** 0..1 fraction of the site URL typed (starts when the CA is done). */
  urlTyped: number;
  /** Strands relax to idle shimmer from t=1500. */
  relaxed: boolean;
  /** t >= 1800: the app may slide the CoinCard up. */
  live: boolean;
  done: boolean;
}

export function convergenceFrame(ms: number): ConvergenceFrame {
  const C = CONVERGENCE;
  const finalPulse = ms >= 0 && ms < C.finalPulseMs ? ms / C.finalPulseMs : null;
  const expand = ms < C.meetAt ? 0 : ease(clamp01((ms - C.meetAt) / C.coreExpandMs));
  const coreRadius = C.coreFrom + (C.coreTo - C.coreFrom) * expand;
  const caTyped = ms < C.typeStart ? 0 : clamp01((ms - C.typeStart) / C.typeMs);
  const urlTyped = ms < C.typeStart + C.typeMs ? 0 : clamp01((ms - C.typeStart - C.typeMs) / C.typeMs);
  return {
    finalPulse,
    coreRadius,
    met: ms >= C.meetAt,
    logoReveal: expand,
    caTyped,
    urlTyped,
    relaxed: ms >= C.typeStart,
    live: ms >= C.liveAt,
    done: ms >= C.totalMs,
  };
}
