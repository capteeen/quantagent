/**
 * Prompt construction for the Artist. Pure. Every brief ends with SAFETY_SUFFIX and
 * is checked by assertContentOk before it leaves the process.
 */

import type { Identity } from "@quantagent/core/types";
import { SAFETY_SUFFIX } from "./rules";

export const LOGO_SIZE = { width: 1024, height: 1024 } as const;
export const BANNER_SIZE = { width: 1500, height: 500 } as const;
export const CHARACTER_SIZE = { width: 1024, height: 1024 } as const;

/** Style directions the prompt-only logo candidates explore; the quantum draw picks one. */
export const STYLE_DIRECTIONS: readonly string[] = [
  "flat vector mascot, bold outlines, two-tone palette on a dark void background",
  "soft 3D clay render, studio lighting, pastel glow, centered mascot",
  "pixel art sprite, 32-color palette, crisp edges, dark background",
  "ink brush illustration, single accent color, minimal, emblem framing",
  "retro airbrush sticker, chrome highlights, neon rim light",
  "hand-drawn marker doodle, thick lines, playful, sticker-style",
];

const BASE = (subject: string) => (subject.trim() ? `Subject: ${subject.trim()}.` : "Subject: an original memecoin mascot.");

export function logoCandidateBrief(prompt: string, style: string): string {
  return `${BASE(prompt)} Square coin logo of a single original mascot, ${style}. Centered, readable at 64px, no text. ${SAFETY_SUFFIX}`;
}

export function namedLogoBrief(prompt: string, identity: Identity, style: string): string {
  return `${BASE(prompt)} Square coin logo for "${identity.name}" (ticker $${identity.ticker}): a single original mascot, ${style}. Centered, readable at 64px. The only text allowed is "${identity.ticker}" small and clean, or no text. ${SAFETY_SUFFIX}`;
}

export function bannerBrief(prompt: string, identity: Identity | undefined, style: string): string {
  const who = identity ? `for "${identity.name}" ($${identity.ticker})` : "for the coin";
  return `${BASE(prompt)} Wide X profile header ${who}: the same mascot in a scene, ${style}. Mascot off-center left, calm negative space right, 3:1 composition. No text. ${SAFETY_SUFFIX}`;
}

export const CHARACTER_SCENES: readonly string[] = [
  "waving hello, front view, neutral background",
  "laughing with eyes closed, three-quarter view",
  "thinking with a hand on the chin",
  "celebrating with both arms up",
  "sleeping curled up",
  "running fast with motion lines",
  "holding a glowing orb",
  "sitting at a tiny desk with a laptop",
  "wearing sunglasses, cool pose",
  "peeking from behind a wall",
  "floating in zero gravity",
  "surprised, jumping back",
];

export function characterBrief(prompt: string, identity: Identity | undefined, style: string, index: number): string {
  const who = identity ? `the "${identity.name}" mascot` : "the same mascot";
  const scene = CHARACTER_SCENES[index % CHARACTER_SCENES.length] as string;
  return `${BASE(prompt)} Character sheet image ${index + 1}: ${who} ${scene}, ${style}. Same character design, colors and proportions as the logo. No text. ${SAFETY_SUFFIX}`;
}

export function requestedImageBrief(prompt: string, identity: Identity | undefined, style: string, brief: string): string {
  const who = identity ? `the "${identity.name}" mascot` : "the same mascot";
  return `${BASE(prompt)} ${who}: ${brief.trim()}. ${style}. Same character design, colors and proportions as the logo. ${SAFETY_SUFFIX}`;
}
