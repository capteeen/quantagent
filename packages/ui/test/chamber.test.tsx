/**
 * <Chamber /> in jsdom. There is no WebGL here, so @react-three/fiber's Canvas is replaced by a
 * stub that records its props and renders nothing: what is tested is the component contract
 * (mount/unmount, modes, the honest status text, store wiring), not pixels. The scene's logic is
 * covered by the pure tests; the real render is exercised by scripts/frametime.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { QuantagentEvent } from "@quantagent/core/types";

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    Canvas: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "canvas", "data-props": Object.keys(props).join(",") }),
    useFrame: () => null,
    useThree: () => ({}),
    useLoader: () => null,
  };
});

import { Chamber } from "../src/chamber/Chamber";
import { createChamberStore } from "../src/chamber/store";
import recorded from "../src/fixtures/launch.recorded.json";

const events = recorded as QuantagentEvent[];

describe("<Chamber />", () => {
  it("mounts in idle mode with an honest status and nothing computing", () => {
    const store = createChamberStore();
    const { unmount } = render(<Chamber mode="idle" store={store} governor={false} />);
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("chamber-status")).toHaveTextContent("Chamber idle: nothing is computing.");
    const root = screen.getByTestId("canvas").parentElement!;
    expect(root.getAttribute("data-chamber-mode")).toBe("idle");
    expect(root.getAttribute("data-framing")).toBe("spec");
    expect(root.getAttribute("data-perf-tier")).toBe("0");
    unmount();
  });

  it("follows the store: the status reflects running, done and failed strands", () => {
    const store = createChamberStore();
    render(<Chamber mode="launch" store={store} governor={false} />);
    act(() => store.applyMany(events.filter((e) => e.seq <= 30)));
    expect(screen.getByTestId("chamber-status").textContent).toMatch(/Chamber running: \d+ workers running/);
    act(() => store.applyMany(events));
    expect(screen.getByTestId("chamber-status").textContent).toMatch(/Chamber live: .*8 done, 0 failed/);
    const base = events[0]!;
    act(() =>
      store.apply({ ...base, id: "x1", seq: 99999, type: "Worker.failed", worker: "Shield", payload: { reason: "rpc down" } } as QuantagentEvent),
    );
    expect(screen.getByTestId("chamber-status").textContent).toMatch(/1 failed/);
  });

  it("writes the reduced-motion preference into the store and honours the override", () => {
    const store = createChamberStore();
    render(<Chamber mode="launch" store={store} governor={false} reducedMotion />);
    expect(store.getState().settings.reducedMotion).toBe(true);
    const root = screen.getByTestId("canvas").parentElement!;
    expect(root.getAttribute("data-reduced-motion")).toBe("true");
  });

  it("keeps sound off by default and never creates an AudioContext without the prop", () => {
    const ctor = vi.fn();
    vi.stubGlobal("AudioContext", ctor);
    const store = createChamberStore();
    const { container } = render(<Chamber mode="launch" store={store} governor={false} />);
    act(() => {
      container.firstElementChild!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(ctor).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("accepts the fit framing", () => {
    const store = createChamberStore();
    render(<Chamber mode="coin" store={store} governor={false} framing="fit" />);
    const root = screen.getByTestId("canvas").parentElement!;
    expect(root.getAttribute("data-framing")).toBe("fit");
    expect(root.getAttribute("data-chamber-mode")).toBe("coin");
  });
});
