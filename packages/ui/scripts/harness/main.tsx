/**
 * Frame-time harness page: mounts <Chamber mode="launch" /> full-viewport and exposes
 * window.__chamber so scripts/frametime.ts can feed the recorded fixture at real timings and
 * sample requestAnimationFrame deltas. Never shipped; test tooling only.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { QuantagentEvent } from "@quantagent/core/types";
import { Chamber } from "../../src/chamber/Chamber";
import { createChamberStore } from "../../src/chamber/store";
import "../../src/fonts.css";
import recorded from "../../src/fixtures/launch.recorded.json";

declare global {
  interface Window {
    __chamber: {
      ready: boolean;
      store: ReturnType<typeof createChamberStore>;
      /** Feed events at their recorded spacing (divided by speed). Resolves when the last one is applied. */
      feed(events: QuantagentEvent[], speed?: number): Promise<number>;
      /** Start sampling rAF deltas; returns a stop function yielding the samples. */
      sample(): () => number[];
      renderer(): string;
      fixture: QuantagentEvent[];
      lived: number;
      tapped: string[];
    };
  }
}

const store = createChamberStore();
const root = document.getElementById("root")!;
const params = new URLSearchParams(location.search);
const mode = (params.get("mode") ?? "launch") as "idle" | "launch" | "live" | "coin";
const reduced = params.get("reduced") === "1";
const framing = (params.get("framing") ?? "spec") as "spec" | "fit";
const governor = params.get("governor") !== "0";

window.__chamber = {
  ready: false,
  store,
  fixture: recorded as QuantagentEvent[],
  lived: 0,
  tapped: [],
  feed(events, speed = 1) {
    return new Promise<number>((resolve) => {
      if (events.length === 0) return resolve(0);
      const t0 = Date.parse(events[0]!.at);
      let applied = 0;
      const start = performance.now();
      for (const e of events) {
        const delay = (Date.parse(e.at) - t0) / speed;
        window.setTimeout(() => {
          store.apply(e);
          applied++;
          if (applied === events.length) resolve(performance.now() - start);
        }, delay);
      }
    });
  },
  sample() {
    const samples: number[] = [];
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      samples.push(now - last);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame((now) => {
      last = now;
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      return samples;
    };
  },
  renderer() {
    const canvas = root.querySelector("canvas");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    if (!gl) return "no-webgl";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  },
};

createRoot(root).render(
  <StrictMode>
    <Chamber
      mode={mode}
      store={store}
      reducedMotion={reduced}
      framing={framing}
      governor={governor}
      onLive={() => {
        window.__chamber.lived++;
      }}
      onTapWorker={(w) => window.__chamber.tapped.push(w)}
      style={{ width: "100vw", height: "100vh" }}
    />
  </StrictMode>,
);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    window.__chamber.ready = true;
  });
});
