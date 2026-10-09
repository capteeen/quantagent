import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { CoinCard } from "./CoinCard";
import { COIN_CA, LAUNCH_FAILED, LAUNCH_LIVE, LAUNCH_PENDING, SHIELD_CLEAR, SHIELD_FLAGGED, SITE_URL, X_POST_ID } from "./fixtures";

const row = (id: string) => screen.getByTestId(id);

describe("CoinCard", () => {
  it("pending launch: no CA, no site, no thread, no logo; nothing invented", () => {
    render(<CoinCard launch={LAUNCH_PENDING} />);
    expect(screen.getByTestId("coin-card").getAttribute("data-state")).toBe("pending");
    expect(row("coin-ca").textContent).toContain("pending launch");
    expect(within(row("coin-ca")).queryByRole("button")).toBeNull();
    expect(row("coin-site").textContent).toContain("not deployed");
    expect(row("coin-x").textContent).toContain("not posted");
    expect(row("coin-wallet").textContent).toContain("balance unknown");
    expect(row("coin-shield").textContent).toContain("not scanning");
    expect(screen.getByTestId("coin-logo").textContent).toContain("no logo");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("heading").textContent).toContain("unnamed");
  });

  it("live: the real CA with copy, site, X thread, balance, logo and shield", async () => {
    const copy = vi.fn(async () => true);
    render(
      <CoinCard
        launch={LAUNCH_LIVE}
        name="Qubit Frog"
        ticker="QFROG"
        logo={{ status: "ready", value: { url: "https://img.example/logo.png", kind: "logo", width: 512, height: 512, externalId: "img_1" } }}
        xThread={{ status: "ready", value: { url: `https://x.com/i/web/status/${X_POST_ID}`, postId: X_POST_ID } }}
        walletBalance={{ status: "ready", value: 0.4321 }}
        shield={{ status: "ready", value: SHIELD_CLEAR }}
        copy={copy}
      />,
    );
    expect(screen.getByTestId("coin-card").getAttribute("data-state")).toBe("live");
    expect(screen.getByRole("heading").textContent).toContain("Qubit Frog");
    expect(screen.getByRole("heading").textContent).toContain("$QFROG");
    expect((screen.getByRole("img") as HTMLImageElement).src).toBe("https://img.example/logo.png");
    expect(within(row("coin-ca")).getByRole("link").getAttribute("href")).toBe(`https://pump.fun/coin/${COIN_CA}`);
    expect(screen.getByTitle(COIN_CA)).toBeTruthy();
    expect(within(row("coin-site")).getByRole("link").getAttribute("href")).toBe(SITE_URL);
    expect(within(row("coin-x")).getByRole("link").getAttribute("href")).toContain(X_POST_ID);
    expect(row("coin-wallet").textContent).toContain("0.432 SOL");
    expect(row("coin-shield").textContent).toContain("clear");

    const copyBtn = screen.getByRole("button", { name: "Copy contract address" });
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(copy).toHaveBeenCalledWith(COIN_CA);
    expect(copyBtn.textContent).toBe("copied");
  });

  it("copy failed: says so instead of pretending", async () => {
    render(<CoinCard launch={LAUNCH_LIVE} copy={async () => false} />);
    const copyBtn = screen.getByRole("button", { name: "Copy contract address" });
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(copyBtn.textContent).toBe("copy failed");
  });

  it("loading: each field says it is in flight", () => {
    render(<CoinCard launch={LAUNCH_LIVE} logo={{ status: "loading" }} xThread={{ status: "loading" }} walletBalance={{ status: "loading" }} shield={{ status: "loading" }} />);
    expect(screen.getByLabelText("logo generating")).toBeTruthy();
    expect(row("coin-x").textContent).toContain("posting…");
    expect(row("coin-shield").textContent).toContain("scanning…");
  });

  it("partial failures: each field shows its own error", () => {
    render(
      <CoinCard
        launch={LAUNCH_LIVE}
        logo={{ status: "failed", error: "provider 503" }}
        xThread={{ status: "failed", error: "X: 403 duplicate content" }}
        walletBalance={{ status: "failed", error: "rpc timeout" }}
        shield={{ status: "failed", error: "helius webhook down" }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("provider 503");
    expect(screen.getByTestId("coin-logo").textContent).toContain("no logo");
    expect(row("coin-x").textContent).toContain("X: 403 duplicate content");
    expect(row("coin-wallet").textContent).toContain("rpc timeout");
    expect(row("coin-shield").textContent).toContain("helius webhook down");
  });

  it("shield flagged: counts and opens the report on tap", () => {
    const onOpenShield = vi.fn();
    render(<CoinCard launch={LAUNCH_LIVE} shield={{ status: "ready", value: SHIELD_FLAGGED }} onOpenShield={onOpenShield} />);
    const btn = within(row("coin-shield")).getByRole("button");
    expect(btn.textContent).toBe("2 copycats · 1 flag");
    fireEvent.click(btn);
    expect(onOpenShield).toHaveBeenCalledTimes(1);
  });

  it("launch failed: says so, no CA", () => {
    render(<CoinCard launch={LAUNCH_FAILED} name="Qubit Frog" />);
    expect(screen.getByTestId("coin-card").getAttribute("data-state")).toBe("failed");
    expect(screen.getByTestId("coin-card").textContent).toContain("launch failed");
    expect(row("coin-ca").textContent).toContain("pending launch");
  });
});
