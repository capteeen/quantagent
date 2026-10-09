import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Autopilot } from "@quantagent/core/types";
import { AutopilotToggle } from "./AutopilotToggle";

const OFF: Autopilot = { posts: false, trades: false, recruiting: false };

describe("AutopilotToggle", () => {
  it("all off: three switches, all unchecked, no confirm open", () => {
    render(<AutopilotToggle autopilot={OFF} onChange={() => {}} />);
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(3);
    for (const s of switches) expect(s.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("enabling asks for a confirming tap, then reports the change", () => {
    const onChange = vi.fn();
    render(<AutopilotToggle autopilot={OFF} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Trades autopilot" }));
    expect(onChange).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: "Enable Trades autopilot?" });
    expect(dialog.textContent).toContain("without a tap");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enable" }));
    expect(onChange).toHaveBeenCalledWith("trades", true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("cancelling the confirm changes nothing", () => {
    const onChange = vi.fn();
    render(<AutopilotToggle autopilot={OFF} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Posts autopilot" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("disabling is immediate", () => {
    const onChange = vi.fn();
    render(<AutopilotToggle autopilot={{ ...OFF, posts: true }} onChange={onChange} />);
    const s = screen.getByRole("switch", { name: "Posts autopilot" });
    expect(s.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(s);
    expect(onChange).toHaveBeenCalledWith("posts", false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("pending: that switch is busy and inert", () => {
    render(<AutopilotToggle autopilot={OFF} onChange={() => {}} pending={{ recruiting: true }} />);
    const s = screen.getByRole("switch", { name: "Recruiting autopilot" }) as HTMLButtonElement;
    expect(s.disabled).toBe(true);
    expect(s.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("autopilot-recruiting").textContent).toContain("saving…");
  });

  it("failed: the error is shown under that class only", () => {
    render(<AutopilotToggle autopilot={OFF} onChange={() => {}} errors={{ trades: "server rejected: launch not live" }} />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(within(screen.getByTestId("autopilot-trades")).getByRole("alert").textContent).toBe("server rejected: launch not live");
  });

  it("subset of classes", () => {
    render(<AutopilotToggle autopilot={OFF} onChange={() => {}} classes={["posts"]} />);
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });
});
