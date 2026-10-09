/**
 * Design tokens for quantagent (SPEC §6.1 + §6.8).
 *
 * Exported twice: as a typed object for TS/React/three, and as a CSS
 * custom-property sheet (`tokensCss`) so plain CSS, Tailwind and the
 * Storybook decorator read the exact same values.
 */
import { WORKER_COLORS, WORKER_NAMES, type WorkerName } from "@quantagent/core/types";

export const colors = {
  /** The background. Nothing sits behind it. */
  void: "#06080A",
  /** Faint cold radial gradient target at the edges of the void. */
  voidEdge: "#0B1220",
  panel: "#0D1117",
  border: "#1C2430",
  /** Cyan: probability, the live/computing colour, rim light. */
  probability: "#4DD0E1",
  /** Magenta: the collapse, the one snap. */
  collapse: "#E91E63",
  /** Amber: decay, awaiting approval. */
  decay: "#FFB300",
  /** Near-white: the tunnel, headings on the void. */
  tunnel: "#F0F4F8",
  text: "#D7DEE6",
  muted: "#6B7684",
  /** A failed strand desaturates to this and stays there. */
  failed: "#3A4049",
  /** Emissive colour of anything computing. */
  active: "#FFE6F2",
} as const;

export type ColorToken = keyof typeof colors;

/** The eight worker colours, re-exported from the shared contract (never redefined). */
export const workerColors: Readonly<Record<WorkerName, string>> = WORKER_COLORS;
export { WORKER_NAMES };

export const fonts = {
  /** JetBrains Mono for ALL data and logs. */
  mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  /** Space Grotesk 600 for headings only. */
  heading: '"Space Grotesk", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  headingWeight: 600,
} as const;

export const motion = {
  /** The only easing. */
  easing: "cubic-bezier(0.4,0,0.2,1)",
  /** Minimum for anything that moves, in ms. Nothing snaps except a collapse. */
  minMs: 700,
  duration: {
    base: 700,
    strandIgnite: 900,
    slow: 1200,
    fail: 1200,
    /** The collapse is the one exception: non-chosen branches vanish in one frame. */
    collapseSnapMs: 0,
    /** The reduced-motion replacement for shower / flicker / aberration. */
    reducedMs: 200,
  },
} as const;

/** Minimum tap target for any interactive element on a phone. */
export const hit = { min: 44 } as const;

export const tokens = { colors, workerColors, fonts, motion, hit } as const;
export type Tokens = typeof tokens;

const toVar = (prefix: string, key: string): string =>
  `--qa-${prefix}${prefix ? "-" : ""}${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;

/** `--qa-color-void`, `--qa-worker-ideator`, `--qa-font-mono`, `--qa-ease`, `--qa-duration-base`… */
export const cssVar = {
  color: (key: ColorToken): string => `var(${toVar("color", key)})`,
  worker: (name: WorkerName): string => `var(${toVar("worker", name.toLowerCase())})`,
  font: (key: "mono" | "heading"): string => `var(${toVar("font", key)})`,
  ease: (): string => "var(--qa-ease)",
  duration: (key: keyof typeof motion.duration): string => `var(${toVar("duration", key)})`,
} as const;

function buildTokensCss(): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(colors)) lines.push(`  ${toVar("color", k)}: ${v};`);
  for (const name of WORKER_NAMES) lines.push(`  ${toVar("worker", name.toLowerCase())}: ${WORKER_COLORS[name]};`);
  lines.push(`  ${toVar("font", "mono")}: ${fonts.mono};`);
  lines.push(`  ${toVar("font", "heading")}: ${fonts.heading};`);
  lines.push(`  --qa-font-heading-weight: ${fonts.headingWeight};`);
  lines.push(`  --qa-ease: ${motion.easing};`);
  for (const [k, v] of Object.entries(motion.duration)) lines.push(`  ${toVar("duration", k)}: ${v}ms;`);
  lines.push(`  --qa-hit-min: ${hit.min}px;`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

/** The same tokens as a `:root { --qa-… }` sheet. Inject once, anywhere. */
export const tokensCss: string = buildTokensCss();
