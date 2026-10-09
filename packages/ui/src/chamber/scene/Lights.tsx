/**
 * Lighting, SPEC §6.1: a rim key in #4DD0E1 behind the vessel so edges glow against the void,
 * and almost nothing else. Light is computation; the lights here only let glass read.
 *
 * The rim key is the cyan area light behind the vessel in Reflections.tsx: glass only shows a
 * light by reflecting it, and an area light gives long glowing edges where a spot light gave a
 * single blown-out glint on the plate. This keeps a faint cold ambient that scales with
 * runtime.fx.brightness (the collapse dims the chamber to 40%).
 */
import { useRef } from "react";
import { HemisphereLight } from "three";
import { useFrame } from "@react-three/fiber";
import { useChamberContext } from "./context";
import { VOID, VOID_EDGE } from "./glass";

const AMBIENT = 0.12;

export function Lights() {
  const { runtime } = useChamberContext();
  const ambient = useRef<HemisphereLight>(null);
  useFrame(() => {
    if (ambient.current) ambient.current.intensity = AMBIENT * runtime.current.fx.brightness;
  });
  return <hemisphereLight ref={ambient} color={VOID_EDGE} groundColor={VOID} intensity={AMBIENT} />;
}
