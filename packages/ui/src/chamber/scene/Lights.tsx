/**
 * Lighting, SPEC §6.1: a rim key light in #4DD0E1 behind the vessel so edges glow against
 * the void, and almost nothing else. Light is computation; the lights here only let glass read.
 * All intensities scale with runtime.fx.brightness (the collapse dims the chamber to 40%).
 */
import { useRef } from "react";
import { HemisphereLight, PointLight, SpotLight } from "three";
import { useFrame } from "@react-three/fiber";
import { useChamberContext } from "./context";
import { RIM_KEY, VOID, VOID_EDGE } from "./glass";

const RIM = 24;
const FILL = 4;
const AMBIENT = 0.12;

export function Lights() {
  const { runtime } = useChamberContext();
  const rim = useRef<SpotLight>(null);
  const fill = useRef<PointLight>(null);
  const ambient = useRef<HemisphereLight>(null);
  useFrame(() => {
    const b = runtime.current.fx.brightness;
    if (rim.current) rim.current.intensity = RIM * b;
    if (fill.current) fill.current.intensity = FILL * b;
    if (ambient.current) ambient.current.intensity = AMBIENT * b;
  });
  return (
    <>
      <spotLight ref={rim} color={RIM_KEY} position={[0, 2.4, -7]} angle={0.9} penumbra={1} intensity={RIM} distance={0} decay={2} />
      <pointLight ref={fill} color={RIM_KEY} position={[-3, 3.5, 2]} intensity={FILL} distance={14} decay={2} />
      <hemisphereLight ref={ambient} color={VOID_EDGE} groundColor={VOID} intensity={AMBIENT} />
    </>
  );
}
