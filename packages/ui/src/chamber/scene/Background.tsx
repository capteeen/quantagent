/**
 * VOID, SPEC §6.1: #06080A with a faint cold radial gradient to #0B1220 at the edges.
 * Drawn as one fullscreen quad at the far plane, in the scene, so the glass transmission pass
 * sees the void behind the vessel (a transparent canvas would make three clear that pass to
 * white). No skybox, no grid, no texture.
 */
import { useMemo } from "react";
import { Color, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import { useDisposable } from "../perf/dispose";
import { VOID, VOID_EDGE } from "./glass";

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.999999, 1.0);
  }
`;
const fragment = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec3 uEdge;
  varying vec2 vUv;
  void main() {
    vec2 d = (vUv - vec2(0.5, 0.45)) * vec2(1.0, 1.3);
    float r = smoothstep(0.25, 1.05, length(d) * 2.0);
    gl_FragColor = vec4(mix(uCenter, uEdge, r), 1.0);
  }
`;

export function Background() {
  const geometry = useDisposable(() => new PlaneGeometry(2, 2), []);
  const material = useDisposable(
    () =>
      new ShaderMaterial({
        uniforms: { uCenter: { value: new Color(VOID) }, uEdge: { value: new Color(VOID_EDGE) } },
        vertexShader: vertex,
        fragmentShader: fragment,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
      }),
    [],
  );
  const mesh = useMemo(() => {
    const m = new Mesh(geometry, material);
    m.frustumCulled = false;
    m.renderOrder = -1000;
    m.name = "void";
    return m;
  }, [geometry, material]);
  return <primitive object={mesh} />;
}
