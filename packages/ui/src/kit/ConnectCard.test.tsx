import { fireEvent, render, screen } from "@testing-library/react";
import { ConnectCard } from "./ConnectCard";
import { OWNER_WALLET } from "./fixtures";

describe("ConnectCard", () => {
  it("disconnected: offers the one tap", () => {
    const onConnect = vi.fn();
    render(<ConnectCard kind="x" state="disconnected" onConnect={onConnect} />);
    expect(screen.getByTestId("connect-x").getAttribute("data-state")).toBe("disconnected");
    fireEvent.click(screen.getByRole("button", { name: "Connect X" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("connecting: busy, with an optional cancel", () => {
    const onCancel = vi.fn();
    render(<ConnectCard kind="wallet" state="connecting" onCancel={onCancel} />);
    const busy = screen.getByText(/Connecting…/).closest("button")!;
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("connected: collapses to a chip with the real id", () => {
    const onDisconnect = vi.fn();
    render(<ConnectCard kind="wallet" state="connected" id={OWNER_WALLET} onDisconnect={onDisconnect} />);
    const chip = screen.getByTestId("connect-wallet");
    expect(chip.getAttribute("data-state")).toBe("connected");
    expect(chip.textContent).toContain("7xKX…gAsU");
    expect(screen.getByTitle(OWNER_WALLET)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Wallet" }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("connected X: shows the handle with one @", () => {
    render(<ConnectCard kind="x" state="connected" id="@yourproject" />);
    expect(screen.getByTestId("connect-x").textContent).toContain("@yourproject");
    expect(screen.getByTestId("connect-x").textContent).not.toContain("@@");
  });

  it("failed: shows the real error and a retry", () => {
    const onRetry = vi.fn();
    render(<ConnectCard kind="x" state="failed" error="OAuth callback rejected: invalid_state" onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toBe("OAuth callback rejected: invalid_state");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
