/**
 * Post-processing, SPEC §6.1 / §6.4: UnrealBloom-equivalent (strength 0.9, radius 0.6,
 * threshold 0.75), depth-of-field for the void's depth, chromatic aberration whose offset
 * is written by the collapse (0.004 for 120ms then decays). Lazy-mounted after the first
 * frame; its rungs on the degradation ladder: bloom radius → DOF → aberration.
 */
import { useRef, type Ref } from "react";
import { Vector2 } from "three";
import { useFrame } from "@react-three/fiber";
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer } from "@react-three/postprocessing";
import type { ChromaticAberrationEffect, DepthOfFieldEffect } from "postprocessing";
import { useChamberContext } from "./context";

export const BLOOM = { intensity: 0.9, radius: 0.6, threshold: 0.75 } as const;

export default function PostFX() {
  const { runtime, perf } = useChamberContext();
  const ca = useRef<ChromaticAberrationEffect | null>(null);
  // @react-three/postprocessing types the ref as the class, not the instance
  const caRef = ca as unknown as Ref<typeof ChromaticAberrationEffect>;
  const offset = useRef(new Vector2(0, 0));
  const dof = useRef<DepthOfFieldEffect | null>(null);

  useFrame(() => {
    const rt = runtime.current;
    const a = rt.fx.aberration;
    const eff = ca.current;
    if (eff) {
      offset.current.set(a, a);
      eff.offset.copy(offset.current);
    }
    // focus follows the camera's dolly so the core stays sharp through the QSD handoff
    const d = dof.current;
    if (d) d.cocMaterial.worldFocusDistance = rt.fx.distance;
  });

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom intensity={BLOOM.intensity} radius={perf.bloomRadius} luminanceThreshold={BLOOM.threshold} luminanceSmoothing={0.08} mipmapBlur />
      {perf.dof ? <DepthOfField ref={dof} worldFocusDistance={7.5} worldFocusRange={3.5} bokehScale={2} /> : <></>}
      {perf.aberration ? <ChromaticAberration ref={caRef} offset={offset.current} radialModulation={false} modulationOffset={0} /> : <></>}
    </EffectComposer>
  );
}
