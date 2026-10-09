import { render, screen } from "@testing-library/react";
import { WORKER_COLORS } from "@quantagent/core/types";
import { COIN_CA, EVENTS, SITE_URL, TX_SIG, X_POST_ID } from "./fixtures";
import { externalRefsOf, LogRow, workerOfEvent } from "./LogRow";

const find = (type: string) => EVENTS.find((e) => e.type === type)!;
const hex2rgb = (hex: string) => {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};

describe("LogRow", () => {
  it("renders time, the worker dot and the reason", () => {
    const e = find("Worker.progress");
    render(<LogRow event={e} />);
    const row = screen.getByTestId("log-row");
    const time = row.querySelector("time")!;
    expect(time.getAttribute("dateTime")).toBe(e.at);
    expect(time.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    const dot = row.querySelector("span[aria-hidden]") as HTMLElement;
    expect(dot.style.backgroundColor).toBe(hex2rgb(WORKER_COLORS.Ideator));
    expect(row.textContent).toContain(e.reason);
    expect(row.textContent).toContain("Worker.progress");
  });

  it("resolves the worker from the field, the payload or the type prefix", () => {
    expect(workerOfEvent(find("Worker.started"))).toBe("Ideator");
    expect(workerOfEvent(find("Orchestrator.collapsed"))).toBe("Ideator");
    expect(workerOfEvent(find("Voice.posted"))).toBe("Voice");
    expect(workerOfEvent(find("Launch.started"))).toBeNull();
  });

  it("links every external id: tx, CA, post, deploy url, draw hash", () => {
    const deployed = externalRefsOf(find("Launcher.deployed"), "devnet");
    expect(deployed.find((r) => r.label === "tx")?.href).toBe(`https://solscan.io/tx/${TX_SIG}?cluster=devnet`);
    expect(deployed.find((r) => r.label === "ca")?.href).toBe(`https://pump.fun/coin/${COIN_CA}`);
    const posted = externalRefsOf(find("Voice.posted"));
    expect(posted.find((r) => r.label === "post")?.href).toBe(`https://x.com/i/web/status/${X_POST_ID}`);
    const published = externalRefsOf(find("Builder.published"));
    expect(published.find((r) => r.label === "url")?.href).toBe(SITE_URL);
    expect(published.find((r) => r.label === "deploy")?.value).toBe("dpl_test_01");
    const collapsed = externalRefsOf(find("Orchestrator.collapsed"));
    expect(collapsed.find((r) => r.label === "draw")).toBeTruthy();

    render(<LogRow event={find("Launcher.deployed")} cluster="mainnet-beta" />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([`https://solscan.io/tx/${TX_SIG}`, `https://pump.fun/coin/${COIN_CA}`]);
    for (const l of links) expect(l.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("a row with no external ids renders no links", () => {
    render(<LogRow event={find("Launch.started")} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("failed events read as failures", () => {
    render(<LogRow event={find("Worker.failed")} />);
    const type = screen.getByText("Worker.failed", { exact: false });
    expect(type.className).toContain("text-worker-shield");
    expect(screen.getByTestId("log-row").textContent).toContain("no logo could be generated");
  });

  it("rejected trades read as failures too", () => {
    render(<LogRow event={find("Trader.rejected")} />);
    expect(screen.getByText("Trader.rejected", { exact: false }).className).toContain("text-worker-shield");
  });
});
