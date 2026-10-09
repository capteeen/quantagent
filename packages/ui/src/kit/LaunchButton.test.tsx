import { fireEvent, render, screen } from "@testing-library/react";
import { LaunchButton } from "./LaunchButton";

describe("LaunchButton", () => {
  it("idle: tappable", () => {
    const onLaunch = vi.fn();
    render(<LaunchButton state="idle" onLaunch={onLaunch} />);
    const btn = screen.getByRole("button", { name: "Launch" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("disabled: always says why", () => {
    render(<LaunchButton state="disabled" reason="Connect X and a wallet first." />);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const reasonId = btn.getAttribute("aria-describedby")!;
    expect(document.getElementById(reasonId)?.textContent).toBe("Connect X and a wallet first.");
    expect(screen.getByTestId("launch-button").getAttribute("data-state")).toBe("disabled");
  });

  it("launching: busy and inert", () => {
    render(<LaunchButton state="launching" />);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.textContent).toContain("Launching…");
  });
});
