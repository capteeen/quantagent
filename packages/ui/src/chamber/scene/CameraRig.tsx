/**
 * Camera, SPEC §6.2 / §6.5: (0, 1.2, 7.5) looking at (0, 0.4, 0), fov 38. The camera drifts
 * constantly (0.3°/s orbit, 2% dolly breathing): the one time-driven motion besides vapour
 * and the core pulse. Launcher.qsdStage keyGeneration dollies 7.5→4.2 over 1.2s; anchoring
 * dollies back. Reduced motion stops the orbit (the dolly is an event transition and stays).
 */
import { useEffect } from "react";
import { PerspectiveCamera } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useChamberContext } from "./context";
import { CAMERA_FOV, CAMERA_POSITION, CAMERA_TARGET, TIER_OUTER_RADIUS } from "../layout";
import { MS, SPEED, motionDurations, progress } from "../motion";
import { CAMERA_DISTANCE_FAR } from "../layout";

const BASE_ELEV = Math.atan2(CAMERA_POSITION.y - CAMERA_TARGET.y, CAMERA_POSITION.z);

export function CameraRig() {
  const { runtime, reducedMotion, framing } = useChamberContext();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

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
    // "fit" framing: on a portrait viewport the outermost tier (r 3.0) and its anchors would be
    // cropped at the spec distance; pull back just enough to keep the ring in frame.
    let fit = 1;
    if (framing === "fit") {
      const aspect = size.width / Math.max(1, size.height);
      const halfWidthAtTarget = CAMERA_DISTANCE_FAR * Math.tan((CAMERA_FOV * Math.PI) / 360) * aspect;
      fit = Math.max(1, (TIER_OUTER_RADIUS + 0.35) / halfWidthAtTarget);
    }
    const d = fx.distance * breathe * fit;
    const y = CAMERA_TARGET.y + Math.sin(BASE_ELEV) * d;
    const horiz = Math.cos(BASE_ELEV) * d;
    camera.position.set(Math.sin(angle) * horiz, y, Math.cos(angle) * horiz);
    camera.lookAt(CAMERA_TARGET);
  });
  return null;
}
