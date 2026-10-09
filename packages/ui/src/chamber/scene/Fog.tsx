/**
 * VOID, SPEC §6.1: depth from fog (near 8, far 40, #06080A) and depth-of-field, not scenery.
 * No skybox, no grid. The radial gradient to #0B1220 is the Background quad (Background.tsx).
 */
import { useEffect } from "react";
import { Fog as ThreeFog } from "three";
import { useThree } from "@react-three/fiber";
import { FOG_FAR, FOG_NEAR } from "../layout";
import { VOID } from "./glass";

export function SceneFog() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const fog = new ThreeFog(VOID, FOG_NEAR, FOG_FAR);
    scene.fog = fog;
    scene.background = null;
    return () => {
      if (scene.fog === fog) scene.fog = null;
    };
  }, [scene]);
  return null;
}
