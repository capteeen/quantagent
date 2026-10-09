/**
 * @quantagent/ui public API.
 *
 * - THE CHAMBER (C1): the 3D view of eight workers computing at once (SPEC §6).
 * - the phone-first component kit (C2, SPEC §6.8)
 * - design tokens + tailwind preset (C2)
 */
export * from "./chamber/index";
export * from "./kit/index";
export * from "./tokens";
export { preset as tailwindPreset } from "./tailwind-preset";
