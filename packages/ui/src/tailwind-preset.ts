/**
 * Tailwind preset exposing the quantagent tokens.
 *
 * Usage (apps/web/tailwind.config.ts):
 *   import preset from "@quantagent/ui/tailwind-preset";
 *   export default { presets: [preset], content: [...] };
 *
 * Classes: bg-void bg-panel border-border text-text text-muted text-probability
 * text-collapse text-decay text-tunnel bg-worker-ideator … font-mono font-heading
 * ease-quant duration-quant duration-quant-slow min-h-hit min-w-hit animate-sheet-in bg-void-radial
 */
import type { Config } from "tailwindcss";
import { WORKER_NAMES } from "@quantagent/core/types";
import { colors, fonts, hit, motion, workerColors } from "./tokens";

const worker: Record<string, string> = {};
for (const name of WORKER_NAMES) worker[name.toLowerCase()] = workerColors[name];

const stack = (s: string): string[] => s.split(",").map((part) => part.trim());

export const preset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        void: colors.void,
        "void-edge": colors.voidEdge,
        panel: colors.panel,
        border: colors.border,
        probability: colors.probability,
        collapse: colors.collapse,
        decay: colors.decay,
        tunnel: colors.tunnel,
        text: colors.text,
        muted: colors.muted,
        failed: colors.failed,
        active: colors.active,
        worker,
      },
      fontFamily: {
        mono: stack(fonts.mono),
        heading: stack(fonts.heading),
        sans: stack(fonts.mono),
      },
      fontWeight: {
        heading: String(fonts.headingWeight),
      },
      transitionTimingFunction: {
        quant: motion.easing,
        DEFAULT: motion.easing,
      },
      transitionDuration: {
        quant: `${motion.duration.base}ms`,
        "quant-slow": `${motion.duration.slow}ms`,
        "quant-reduced": `${motion.duration.reducedMs}ms`,
        DEFAULT: `${motion.duration.base}ms`,
      },
      keyframes: {
        "sheet-in": {
          from: { transform: "translateY(100%)", opacity: "0.6" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "sheet-in": `sheet-in ${motion.duration.base}ms ${motion.easing} both`,
        "fade-in": `fade-in ${motion.duration.base}ms ${motion.easing} both`,
      },
      minHeight: { hit: `${hit.min}px` },
      minWidth: { hit: `${hit.min}px` },
      borderColor: { DEFAULT: colors.border },
      backgroundImage: {
        "void-radial": `radial-gradient(ellipse at center, ${colors.void} 55%, ${colors.voidEdge} 100%)`,
      },
    },
  },
};

export default preset;
