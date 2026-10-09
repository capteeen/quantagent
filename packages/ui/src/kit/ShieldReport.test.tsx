import { render, screen } from "@testing-library/react";
import { COIN_CA, SHIELD_CLEAR, SHIELD_FLAGGED, TX_SIG } from "./fixtures";
import { ShieldReport } from "./ShieldReport";

describe("ShieldReport", () => {
  it("none: says the Shield has not reported", () => {
    render(<ShieldReport state="none" />);
    expect(screen.getByTestId("empty-state").textContent).toContain("The Shield has not reported.");
    expect(screen.queryByTestId("shield-report")).toBeNull();
  });

  it("scanning: says what it is looking for", () => {
    render(<ShieldReport state="scanning" />);
    expect(screen.getByTestId("empty-state").textContent).toContain("Scanning…");
  });

  it("failed: shows the real error", () => {
    render(<ShieldReport state="failed" error="pump.fun search 429 rate limited" />);
    expect(screen.getByRole("alert").textContent).toContain("pump.fun search 429 rate limited");
  });

  it("clear: canonical CA linked, both lists say none found", () => {
    render(<ShieldReport state="ready" report={SHIELD_CLEAR} />);
    const el = screen.getByTestId("shield-report");
    expect(el.getAttribute("data-state")).toBe("clear");
    expect(screen.getByRole("link").getAttribute("href")).toBe(`https://pump.fun/coin/${COIN_CA}`);
    expect(screen.getAllByText("None found.")).toHaveLength(2);
  });

  it("no canonical CA yet: pending launch", () => {
    render(<ShieldReport state="ready" report={{ ...SHIELD_CLEAR, canonicalCa: null }} />);
    expect(screen.getByTestId("shield-report").textContent).toContain("pending launch");
  });

  it("flagged: every copycat links to its source, every flag tx links to the explorer", () => {
    render(<ShieldReport state="ready" report={SHIELD_FLAGGED} reportedAt="2026-10-09T12:03:00.000Z" cluster="devnet" />);
    const el = screen.getByTestId("shield-report");
    expect(el.getAttribute("data-state")).toBe("flagged");
    expect(el.textContent).toContain("2 copycats · 1 flag");
    const copycats = screen.getAllByTestId("copycat");
    expect(copycats).toHaveLength(2);
    expect(copycats[0]!.querySelector("a")!.getAttribute("href")).toBe(SHIELD_FLAGGED.copycats[0]!.url);
    expect(copycats[0]!.textContent).toContain("98%");
    expect(copycats[1]!.textContent).toContain("logo");
    const flags = screen.getAllByTestId("bundle-flag");
    expect(flags).toHaveLength(1);
    expect(flags[0]!.textContent).toContain("bundled-launch");
    expect(flags[0]!.querySelector("a")!.getAttribute("href")).toBe(`https://solscan.io/tx/${TX_SIG}?cluster=devnet`);
  });
});
