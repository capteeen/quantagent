/**
 * What the glass reflects, SPEC §6.1. Glass in a pure void has nothing to catch, so it renders
 * as faint smears. This builds a procedural environment once (no image, no HDR file, no
 * network): a cyan rim strip behind the vessel, two cold verticals and a dim top panel. Only
 * reflections use it; the void stays the background, so there is still no skybox.
 */
import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useChamberContext } from "./context";
import { RIM_KEY } from "./glass";

export function Reflections() {
  const { runtime } = useChamberContext();
  const scene = useThree((s) => s.scene);
  // the collapse dims the whole chamber to 40%, reflections included
  useFrame(() => {
    scene.environmentIntensity = runtime.current.fx.brightness;
  });
  return (
    <Environment resolution={128} frames={1} background={false}>
      {/* rim key behind the vessel: the edges glow cyan against the void */}
      <Lightformer form="rect" color={RIM_KEY} intensity={6} position={[0, 1.5, -9]} scale={[18, 1.6, 1]} />
      <Lightformer form="ring" color={RIM_KEY} intensity={3} position={[0, 6, -2]} rotation-x={Math.PI / 2} scale={6} />
      {/* two cold verticals so cylinder walls catch a long specular line */}
      <Lightformer form="rect" color="#D7E9F2" intensity={2.2} position={[-8, 1.5, 2]} rotation-y={Math.PI / 2} scale={[1.2, 10, 1]} />
      <Lightformer form="rect" color="#D7E9F2" intensity={1.6} position={[8, 1.5, 3]} rotation-y={-Math.PI / 2} scale={[1.2, 10, 1]} />
      {/* faint top panel: the plate reads as a sheet of glass */}
      <Lightformer form="circle" color="#9FB4C8" intensity={0.8} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={8} />
    </Environment>
  );
}
