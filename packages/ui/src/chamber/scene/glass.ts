/**
 * Glass and light materials, SPEC §6.1. Nothing opaque, nothing textured.
 *
 * GLASS: MeshPhysicalMaterial transmission 1.0, thickness 0.4–1.2, ior 1.45,
 * roughness 0.05–0.15, iridescence 0.6, iridescenceIOR 1.3.
 * LIGHT: emissive #FFE6F2 at intensity 2–4, caught by bloom (threshold 0.75).
 */
import { AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial } from "three";

export const ACTIVE_EMISSIVE = "#FFE6F2";
export const RIM_KEY = "#4DD0E1";
export const VOID = "#06080A";
export const VOID_EDGE = "#0B1220";
export const FAILED = "#3A4049";
export const AMBER = "#FFB300";

export interface GlassOptions {
  thickness?: number;
  roughness?: number;
  iridescence?: number;
  /** Visual opacity of the pane (the transmitted colour carries the rest). */
  opacity?: number;
  color?: string;
  emissive?: string;
  emissiveIntensity?: number;
  /** 1 for the vessel (see-through); 0 for the core so it stays visible through every pane. */
  transmission?: number;
}

export function makeGlass(o: GlassOptions = {}): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: new Color(o.color ?? "#ffffff"),
    transmission: o.transmission ?? 1,
    thickness: o.thickness ?? 0.6,
    ior: 1.45,
    roughness: o.roughness ?? 0.08,
    metalness: 0,
    iridescence: o.iridescence ?? 0.6,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 400],
    transparent: true,
    opacity: o.opacity ?? 0.55,
    side: DoubleSide,
    depthWrite: false,
    envMapIntensity: 0,
    specularIntensity: 1,
    emissive: new Color(o.emissive ?? "#000000"),
    emissiveIntensity: o.emissiveIntensity ?? 0,
  });
  return m;
}

/** A strand / pulse / spark: unlit colour pushed over 1.0 so bloom catches it. */
export function makeLight(color: string, intensity = 2.5, opts: { transparent?: boolean; opacity?: number; additive?: boolean } = {}): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    color: new Color(color).multiplyScalar(intensity),
    toneMapped: false,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: !(opts.transparent ?? false),
  });
  if (opts.additive) m.blending = AdditiveBlending;
  return m;
}

const tmp = new Color();
/** Set an unlit material's colour to `hex` × intensity (HDR for bloom). */
export function setLight(m: MeshBasicMaterial, hex: string | Color, intensity: number): void {
  if (typeof hex === "string") tmp.set(hex);
  else tmp.copy(hex);
  m.color.copy(tmp).multiplyScalar(intensity);
}

/** Lerp a material colour toward a target hex by t (used for the 1.2s desaturation to #3A4049). */
export function lerpLight(m: MeshBasicMaterial, fromHex: string, toHex: string, t: number, intensity: number): void {
  const a = tmp.set(fromHex);
  const b = new Color(toHex);
  a.lerp(b, t);
  m.color.copy(a).multiplyScalar(intensity);
}
