/**
 * vitest (jsdom) setup: a minimal WebGL stub so three can construct objects, plus the
 * browser APIs @react-three/fiber and drei touch at import time. Nothing here renders.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

// matchMedia (reduced motion queries)
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// ResizeObserver (fiber's Canvas measures its container)
if (typeof globalThis.ResizeObserver === "undefined") {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
}

// A minimal WebGL context stub: enough for feature detection, never for drawing.
const glStub = () => {
  const noop = () => undefined;
  const ctx: Record<string, unknown> = new Proxy(
    {
      canvas: null,
      drawingBufferWidth: 390,
      drawingBufferHeight: 844,
      getExtension: () => null,
      getParameter: () => 0,
      getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
      getContextAttributes: () => ({ alpha: true, antialias: false }),
      isContextLost: () => false,
      getSupportedExtensions: () => [],
    },
    {
      get(target, prop) {
        if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
        return noop;
      },
    },
  );
  return ctx;
};

if (typeof HTMLCanvasElement !== "undefined") {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
      const c = glStub();
      (c as { canvas: unknown }).canvas = this;
      return c as unknown as RenderingContext;
    }
    try {
      return (orig as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } catch {
      return null;
    }
  } as typeof HTMLCanvasElement.prototype.getContext;
}

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
