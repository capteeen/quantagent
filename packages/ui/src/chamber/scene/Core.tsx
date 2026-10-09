/**
 * THE CORE, SPEC §6.2 / §6.6: a glass sphere of radius 0.35 representing the coin.
 * Idle: emissive 0.3↔0.6 over 2.4s (ambience). After Launch.live it expands to 0.55 and
 * becomes a spherical frame around the coin's real logo on an inner sphere, lit from within.
 * Chain.decay clouds the glass (roughness 0.05→0.6). A collapse on the core flashes it white.
 */
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Color, Mesh, MeshBasicMaterial, PointLight, SphereGeometry, SRGBColorSpace, Texture, TextureLoader } from "three";
import { useFrame } from "@react-three/fiber";
import { useChamberContext } from "./context";
import { ACTIVE_EMISSIVE, makeGlass } from "./glass";
import { useDisposable } from "../perf/dispose";
import { useChamber } from "../store";
import { CORE_POSITION, CORE_RADIUS } from "../layout";
import { MS } from "../motion";
import { convergenceFrame } from "../convergence/timeline";

const WHITE = new Color("#ffffff");
const EMISSIVE = new Color(ACTIVE_EMISSIVE);

export function Core() {
  const { store, runtime, perf } = useChamberContext();
  const roughness = useChamber(store, (s) => s.core.roughness);
  const live = useChamber(store, (s) => s.core.live);
  const logoUrl = useChamber(store, (s) => (s.core.live ? s.core.logoUrl : undefined));

  const geometry = useDisposable(() => new SphereGeometry(1, 48, 32), []);
  const material = useDisposable(
    () => makeGlass({ transmission: 0, color: "#141C26", thickness: 0.8, roughness: 0.05, iridescence: perf.iridescence, opacity: 0.85, emissive: ACTIVE_EMISSIVE, emissiveIntensity: 0.3 }),
    [perf.iridescence],
  );
  useEffect(() => {
    // dark glass with a clearcoat so the sphere reads as a ball of glass lit from within, not a grey disc
    material.clearcoat = 1;
    material.clearcoatRoughness = 0.06;
  }, [material]);
  const meshRef = useRef<Mesh>(null);
  const lightRef = useRef<PointLight>(null);

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const mesh = meshRef.current;
    if (!mesh) return;
    // idle pulse 0.3↔0.6 over 2.4s: the only time-driven core motion
    const idle = 0.45 + 0.15 * Math.sin((now / MS.corePulse) * Math.PI * 2);
    let intensity = idle;
    let radius = CORE_RADIUS;
    if (rt.core.convergenceAt !== undefined) {
      const f = convergenceFrame(now - rt.core.convergenceAt);
      radius = f.coreRadius;
      if (f.met) intensity = 0.55 + 0.25 * f.logoReveal + 0.1 * Math.sin((now / MS.corePulse) * Math.PI * 2);
    }
    // core collapse (QSD draw / measurement) and strand collapses flash the core white for 2 frames
    const flash = rt.frame <= rt.core.flashUntilFrame;
    material.emissive.copy(flash ? WHITE : EMISSIVE);
    material.emissiveIntensity = (flash ? 6 : intensity) * rt.fx.brightness;
    material.roughness = roughness;
    material.iridescence = perf.iridescence;
    mesh.scale.setScalar(radius);
    if (lightRef.current) lightRef.current.intensity = (flash ? 1.5 : 0.06 + 0.08 * intensity) * rt.fx.brightness;
  });

  return (
    <group position={CORE_POSITION.toArray()} name="core">
      <mesh ref={meshRef} geometry={geometry} material={material} scale={CORE_RADIUS} renderOrder={20} />
      <pointLight ref={lightRef} color={ACTIVE_EMISSIVE} intensity={0.1} distance={3} decay={2} />
      {live && logoUrl ? (
        <LogoBoundary>
          <Suspense fallback={null}>
            <CoinLogo url={logoUrl} />
          </Suspense>
        </LogoBoundary>
      ) : null}
    </group>
  );
}

/**
 * The inner sphere with the coin's real logo: the only texture in the chamber.
 * A logo that fails to load shows nothing (no placeholder, SPEC §2 NOTHING INVENTED).
 */
function CoinLogo({ url }: { url: string }) {
  const { runtime } = useChamberContext();
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let alive = true;
    const loader = new TextureLoader();
    loader.setCrossOrigin("anonymous");
    let tex: Texture | null = null;
    loader.load(
      url,
      (t) => {
        if (!alive) {
          t.dispose();
          return;
        }
        t.colorSpace = SRGBColorSpace;
        tex = t;
        setTexture(t);
      },
      undefined,
      () => setTexture(null),
    );
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [url]);

  const geometry = useDisposable(() => new SphereGeometry(1, 48, 32), []);
  const material = useDisposable(() => {
    const m = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, toneMapped: false });
    return m;
  }, []);
  useEffect(() => {
    material.map = texture;
    material.needsUpdate = true;
  }, [material, texture]);
  const ref = useRef<Mesh>(null);

  useFrame(() => {
    const rt = runtime.current;
    const at = rt.core.convergenceAt;
    const f = at === undefined ? 1 : convergenceFrame(rt.now() - at).logoReveal;
    material.opacity = texture ? f : 0;
    if (ref.current) ref.current.scale.setScalar(CORE_RADIUS * 0.8 * (0.6 + 0.4 * f) * (0.35 + 0.2 * f) / 0.35);
  });

  if (!texture) return null;
  return <mesh ref={ref} geometry={geometry} material={material} renderOrder={19} />;
}

class LogoBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
