import { fireEvent, render, screen, within } from "@testing-library/react";
import { CANDIDATES, CHOSEN, EVENTS, PROOF, WORKER_STATES } from "./fixtures";
import { WorkerSheet } from "./WorkerSheet";

describe("WorkerSheet", () => {
  it("closed: renders nothing", () => {
    const { container } = render(<WorkerSheet worker="Ideator" open={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("not started: every section is honestly empty", () => {
    render(<WorkerSheet worker="Recruiter" open onClose={() => {}} events={EVENTS} />);
    const sheet = screen.getByRole("dialog", { name: "Recruiter worker" });
    expect(sheet.getAttribute("data-status")).toBe("idle");
    expect(within(screen.getByTestId("worker-sheet-candidates")).getByText("No candidates.")).toBeTruthy();
    expect(within(screen.getByTestId("worker-sheet-proof")).getByText("No draw yet.")).toBeTruthy();
    expect(within(screen.getByTestId("worker-sheet-outputs")).getByText("No outputs.")).toBeTruthy();
    expect(within(screen.getByTestId("worker-sheet-log")).getByText("No events.")).toBeTruthy();
  });

  it("running: only this worker's events are listed", () => {
    render(<WorkerSheet worker="Ideator" state={WORKER_STATES.running} open onClose={() => {}} events={EVENTS} />);
    const rows = within(screen.getByTestId("worker-sheet-log")).getAllByTestId("log-row");
    const types = rows.map((r) => r.getAttribute("data-event-type"));
    expect(types).toEqual(["Worker.started", "Worker.progress", "Worker.candidates", "Orchestrator.collapsed", "Worker.done"]);
    expect(screen.getByTestId("worker-sheet-status").textContent).toBe("running");
  });

  it("candidates: all shown, none chosen yet", () => {
    render(<WorkerSheet worker="Ideator" state={WORKER_STATES.candidates} open onClose={() => {}} />);
    const items = screen.getAllByTestId("candidate");
    expect(items).toHaveLength(CANDIDATES.length);
    expect(items.some((i) => i.hasAttribute("data-chosen"))).toBe(false);
    expect(screen.queryByTestId("proof-viewer")).toBeNull();
  });

  it("done: the chosen candidate is highlighted and the proof shows drawHash + attestation", () => {
    render(<WorkerSheet worker="Ideator" state={WORKER_STATES.done} open onClose={() => {}} />);
    const chosen = screen.getAllByTestId("candidate").filter((i) => i.hasAttribute("data-chosen"));
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!.getAttribute("data-candidate-id")).toBe(CHOSEN.id);
    expect(chosen[0]!.textContent).toContain("chosen");
    const proof = screen.getByTestId("proof-viewer");
    expect(proof.textContent).toContain(PROOF.drawHash);
    expect(proof.textContent).toContain(PROOF.provider);
    expect(proof.textContent).toContain("#1");
    fireEvent.click(within(proof).getByText(/…/));
    expect(proof.textContent).toContain(PROOF.attestation);
    const outputs = screen.getByTestId("worker-sheet-outputs");
    expect(outputs.textContent).toContain("QFROG");
    expect(within(outputs).getByRole("link").getAttribute("href")).toBe(WORKER_STATES.done.outputs.siteUrl);
  });

  it("awaiting approval: status says needs you", () => {
    render(<WorkerSheet worker="Voice" state={WORKER_STATES.awaitingApproval} open onClose={() => {}} />);
    expect(screen.getByTestId("worker-sheet-status").textContent).toBe("needs you");
  });

  it("failed: the failReason is the first thing on the sheet", () => {
    render(<WorkerSheet worker="Artist" state={WORKER_STATES.failed} open onClose={() => {}} events={EVENTS} />);
    expect(screen.getAllByRole("alert")[0]!.textContent).toBe(WORKER_STATES.failed.failReason);
    expect(screen.getByTestId("worker-sheet").getAttribute("data-status")).toBe("failed");
    const types = within(screen.getByTestId("worker-sheet-log"))
      .getAllByTestId("log-row")
      .map((r) => r.getAttribute("data-event-type"));
    expect(types).toContain("Artist.generationFailed");
    expect(types).toContain("Worker.failed");
  });

  it("QRNG unavailable: says why and lets the user pick", () => {
    const onPick = vi.fn();
    render(
      <WorkerSheet
        worker="Ideator"
        state={WORKER_STATES.candidates}
        open
        onClose={() => {}}
        collapseUnavailableReason="ANU QRNG unreachable (timeout after 3 attempts)"
        onPick={onPick}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("ANU QRNG unreachable");
    fireEvent.click(within(screen.getAllByTestId("candidate")[2]!).getByRole("button"));
    expect(onPick).toHaveBeenCalledWith(CANDIDATES[2]);
  });

  it("close: backdrop tap, the × button and Escape all close", () => {
    const onClose = vi.fn();
    render(<WorkerSheet worker="Ideator" open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByTestId("worker-sheet-backdrop"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(4);
  });
});
