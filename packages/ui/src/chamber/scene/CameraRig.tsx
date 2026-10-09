/**
 * Camera, SPEC §6.2 / §6.5: (0, 1.2, 7.5) looking at (0, 0.4, 0), fov 38. The camera drifts
 * constantly (0.3°/s orbit, 2% dolly breathing): the one time-driven motion besides vapour
 * and the core pulse. Launcher.qsdStage keyGeneration dollies 7.5→4.2 over 1.2s; anchoring
 * dollies back. Reduced motion stops the orbit (the dolly is an event transition and stays).
 */
import { useEffect, useMemo, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useChamberContext } from "./context";
import { CAMERA_DISTANCE_FAR, CAMERA_DISTANCE_NEAR, CAMERA_FOV, CAMERA_POSITION, CAMERA_TARGET, fitFraming } from "../layout";
import { MS, SPEED, motionDurations, progress } from "../motion";

const BASE_ELEV = Math.atan2(CAMERA_POSITION.y - CAMERA_TARGET.y, CAMERA_POSITION.z);

export function CameraRig() {
  const { runtime, reducedMotion, framing } = useChamberContext();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const fit = useMemo(() => (framing === "fit" ? fitFraming(aspect) : { distanceScale: 1, targetY: CAMERA_TARGET.y }), [framing, aspect]);
  const target = useRef(new Vector3());

  useEffect(() => {
    if (camera instanceof PerspectiveCamera) {
      camera.fov = CAMERA_FOV;
      camera.near = 0.1;
      camera.far = 60;
      camera.updateProjectionMatrix();
    }
    camera.position.copy(CAMERA_POSITION);
    camera.lookAt(CAMERA_TARGET);
  }, [camera]);

  useFrame(() => {
    const rt = runtime.current;
    const now = rt.now();
    const fx = rt.fx;
    // event-started dolly
    if (fx.dolly) {
      const p = progress(now, fx.dolly.start, fx.dolly.duration);
      fx.distance = fx.dolly.from + (fx.dolly.to - fx.dolly.from) * p;
      if (p >= 1) fx.dolly = null;
    }
    const orbit = motionDurations(reducedMotion).orbitDegPerSec;
    const angle = reducedMotion ? 0 : ((now / 1000) * orbit * Math.PI) / 180;
    const breathe = reducedMotion ? 1 : 1 + SPEED.breatheAmplitude * Math.sin((now / MS.breathe) * Math.PI * 2);
    // "fit" framing (layout.fitFraming): pulled back and aimed at the vessel's middle; the
    // QSD dolly toward 4.2 eases the aim back down to the core
    const near = Math.min(1, Math.max(0, (CAMERA_DISTANCE_FAR - fx.distance) / (CAMERA_DISTANCE_FAR - CAMERA_DISTANCE_NEAR)));
    const t = target.current.set(0, fit.targetY + (CAMERA_TARGET.y - fit.targetY) * near, 0);
    const d = fx.distance * breathe * fit.distanceScale;
    const y = t.y + Math.sin(BASE_ELEV) * d;
    const horiz = Math.cos(BASE_ELEV) * d;
    camera.position.set(Math.sin(angle) * horiz, y, Math.cos(angle) * horiz);
    camera.lookAt(t);
  });
  return null;
}
