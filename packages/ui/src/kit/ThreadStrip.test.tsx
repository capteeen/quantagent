import { fireEvent, render, screen } from "@testing-library/react";
import { WORKER_COLORS, WORKER_NAMES } from "@quantagent/core/types";
import { colors } from "../tokens";
import { workersAll, workersMix } from "./fixtures";
import { ThreadStrip } from "./ThreadStrip";

const tabs = () => screen.getAllByRole("tab");

describe("ThreadStrip", () => {
  it("before a launch: eight idle chips, one per worker, in order", () => {
    render(<ThreadStrip />);
    const t = tabs();
    expect(t).toHaveLength(8);
    t.forEach((el, i) => {
      expect(el.getAttribute("data-worker")).toBe(WORKER_NAMES[i]);
      expect(el.getAttribute("data-status")).toBe("idle");
      expect(el.className).toContain("min-h-hit");
      expect(el.className).toContain("min-w-hit");
    });
  });

  it("live: reflects each worker's WorkerStatus and colour", () => {
    render(<ThreadStrip workers={workersMix()} />);
    const byName = Object.fromEntries(tabs().map((el) => [el.getAttribute("data-worker"), el]));
    expect(byName.Ideator!.getAttribute("data-status")).toBe("done");
    expect(byName.Artist!.getAttribute("data-status")).toBe("candidates");
    expect(byName.Voice!.getAttribute("data-status")).toBe("awaitingApproval");
    expect(byName.Voice!.getAttribute("aria-label")).toBe("Voice: needs you");
    expect(byName.Recruiter!.getAttribute("data-status")).toBe("failed");
    expect(byName.Builder!.style.boxShadow).toContain(WORKER_COLORS.Builder);
  });

  for (const status of ["pending", "running", "candidates", "awaitingApproval", "done", "failed"] as const) {
    it(`state ${status}: every chip renders it`, () => {
      render(<ThreadStrip workers={workersAll(status)} />);
      for (const el of tabs()) expect(el.getAttribute("data-status")).toBe(status);
    });
  }

  it("failed: the chip desaturates to the failed colour (no worker colour left)", () => {
    render(<ThreadStrip workers={workersAll("failed")} />);
    const dot = tabs()[0]!.querySelector("span[aria-hidden]") as HTMLElement;
    const rgb = (hex: string) => {
      const h = hex.replace("#", "");
      return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
    };
    expect(dot.style.backgroundColor).toBe(rgb(colors.failed));
  });

  it("tap: selects the worker; chips are inert without a handler", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ThreadStrip workers={workersMix()} onSelect={onSelect} selected="Artist" />);
    fireEvent.click(screen.getByRole("tab", { name: /Shield/ }));
    expect(onSelect).toHaveBeenCalledWith("Shield");
    expect(screen.getByRole("tab", { name: /Artist/ }).getAttribute("aria-selected")).toBe("true");
    rerender(<ThreadStrip workers={workersMix()} />);
    expect((screen.getByRole("tab", { name: /Shield/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
