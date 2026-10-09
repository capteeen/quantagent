import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("empty: text only, no illustration, no placeholder", () => {
    const { container } = render(<EmptyState title="No launches yet." />);
    expect(screen.getByTestId("empty-state").textContent).toBe("No launches yet.");
    expect(container.querySelector("img, svg")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("with detail and action", () => {
    const onClick = vi.fn();
    render(<EmptyState title="No approvals pending." detail="Workers ask here before money or reputation moves." action={{ label: "Refresh", onClick }} />);
    expect(screen.getByTestId("empty-state").textContent).toContain("Workers ask here before money or reputation moves.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("failed: an alert with the reason", () => {
    render(<EmptyState failed title="Event stream disconnected." detail="SSE closed with 502; reconnecting." />);
    const el = screen.getByRole("alert");
    expect(el.getAttribute("data-failed")).toBe("true");
    expect(el.textContent).toContain("SSE closed with 502; reconnecting.");
  });
});
