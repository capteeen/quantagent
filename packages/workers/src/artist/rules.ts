/**
 * Artist content rules, enforced in code BEFORE any generation request leaves the process.
 * - no real people
 * - no protected characters or brands
 * - nothing sexual or violent
 * The image provider's own moderation is additive; it is never relied upon.
 */

import { PROTECTED_BRAND_DENY, REAL_PERSON_DENY, findDenied } from "../ideator/constraints";

export const SEXUAL_DENY: readonly string[] = [
  "nude", "naked", "nsfw", "sex", "sexual", "sexy", "porn", "porno", "xxx", "erotic", "hentai",
  "lingerie", "topless", "bikini", "boobs", "breasts", "nipples", "genitals", "penis", "vagina",
  "orgasm", "fetish", "bdsm", "onlyfans", "stripper", "escort", "hooker", "slut", "whore",
  "underage", "loli", "shota", "child bride", "jailbait",
];

export const VIOLENT_DENY: readonly string[] = [
  "gore", "gory", "blood", "bloody", "bleeding", "corpse", "dead body", "murder", "kill", "killing",
  "slaughter", "massacre", "beheading", "decapitate", "stab", "stabbing", "shoot", "shooting",
  "gun", "guns", "rifle", "pistol", "firearm", "bomb", "explosion", "terrorist", "terrorism",
  "torture", "mutilate", "mutilation", "lynch", "hang", "hanging", "suicide", "self-harm",
  "war crime", "genocide", "nazi", "swastika", "hitler", "isis", "school shooter",
];

/** Terms that ask the model to depict a real individual even without naming one. */
export const REAL_PEOPLE_PATTERNS: readonly string[] = [
  "real person", "real people", "celebrity", "celebrities", "politician", "president", "prime minister",
  "photo of", "photograph of", "selfie of", "deepfake", "lookalike", "look-alike",
  "in the style of a real", "actual person", "famous person", "famous people", "influencer",
];

export interface ContentCheck {
  ok: boolean;
  /** Human-readable violations, empty when ok. */
  violations: string[];
}

/** Checks a brief / prompt against every rule. Pure. */
export function checkContent(text: string): ContentCheck {
  const violations: string[] = [];
  // The safety suffix names the rules themselves ("no real people", "nothing sexual"); never match on it.
  text = text.split(SAFETY_SUFFIX).join(" ");
  const person = findDenied(text, REAL_PERSON_DENY);
  if (person) violations.push(`references a real person ("${person}")`);
  const pattern = findDenied(text, REAL_PEOPLE_PATTERNS);
  if (pattern) violations.push(`asks to depict a real person ("${pattern}")`);
  const brand = findDenied(text, PROTECTED_BRAND_DENY);
  if (brand) violations.push(`references a protected brand or character ("${brand}")`);
  const sexual = findDenied(text, SEXUAL_DENY);
  if (sexual) violations.push(`sexual content ("${sexual}")`);
  const violent = findDenied(text, VIOLENT_DENY);
  if (violent) violations.push(`violent content ("${violent}")`);
  return { ok: violations.length === 0, violations };
}

export class ContentRuleViolation extends Error {
  override readonly name = "ContentRuleViolation";
  constructor(
    public readonly brief: string,
    public readonly violations: string[],
  ) {
    super(`content rules blocked the brief: ${violations.join("; ")}`);
  }
}

/** Throws ContentRuleViolation when the brief breaks a rule. Call before every generation. */
export function assertContentOk(brief: string): void {
  const check = checkContent(brief);
  if (!check.ok) throw new ContentRuleViolation(brief, check.violations);
}

/** Suffix appended to every generation prompt so the provider gets the same rules. */
export const SAFETY_SUFFIX =
  "Original character design only. No real people, no celebrities, no existing brand logos, mascots or franchise characters, no text other than the given name/ticker, nothing sexual, nothing violent.";
