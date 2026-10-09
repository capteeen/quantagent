import { fireEvent, render, screen } from "@testing-library/react";
import { ApprovalCard, SWIPE_THRESHOLD_PX } from "./ApprovalCard";
import { APPROVAL, APPROVAL_TRADE } from "./fixtures";

// jsdom has no PointerEvent; without it fireEvent drops clientX/pointerId.
if (!("PointerEvent" in window)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "touch";
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
}

const card = () => screen.getByTestId("approval-card");

function swipe(dx: number, dy = 0) {
  const el = card();
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 100 + dx / 2, clientY: 100 + dy / 2 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
}

describe("ApprovalCard", () => {
  it("pending: shows worker, class, title, reason and the full draft", () => {
    render(<ApprovalCard approval={APPROVAL} onDecide={() => {}} />);
    expect(card().getAttribute("data-state")).toBe("pending");
    expect(card().textContent).toContain("Voice · post");
    expect(screen.getByRole("heading").textContent).toBe(APPROVAL.title);
    expect(card().textContent).toContain(APPROVAL.reason);
    expect(screen.getByTestId("approval-draft").textContent).toContain(APPROVAL.draft.text as string);
    expect(screen.getByTestId("approval-draft").textContent).toContain("thread");
  });

  it("buttons: approve / skip decide; edit opens the editor", () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={APPROVAL} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onDecide).toHaveBeenLastCalledWith("approve");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onDecide).toHaveBeenLastCalledWith("skip");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(card().getAttribute("data-state")).toBe("editing");
  });

  it("editing: string fields are editable, others read-only; approve edit sends the merged draft", () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={APPROVAL_TRADE} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const areas = screen.getAllByRole("textbox");
    expect(areas).toHaveLength(1); // only `side` is a string; sol and slippageBps stay read-only
    fireEvent.change(areas[0]!, { target: { value: "sell" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve edit" }));
    expect(onDecide).toHaveBeenCalledWith("edit", { side: "sell", sol: 0.1, slippageBps: 300 });
  });

  it("editing: cancel discards", () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={APPROVAL} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(card().getAttribute("data-state")).toBe("pending");
    expect(screen.getByTestId("approval-draft").textContent).toContain(APPROVAL.draft.text as string);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("swipe right approves, swipe left skips, a short drag does nothing", () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={APPROVAL} onDecide={onDecide} />);
    swipe(SWIPE_THRESHOLD_PX + 20);
    expect(onDecide).toHaveBeenLastCalledWith("approve");
    swipe(-(SWIPE_THRESHOLD_PX + 20));
    expect(onDecide).toHaveBeenLastCalledWith("skip");
    onDecide.mockClear();
    swipe(30);
    expect(onDecide).not.toHaveBeenCalled();
    expect(card().getAttribute("data-state")).toBe("pending");
  });

  it("a mostly vertical drag is a scroll, not a decision", () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={APPROVAL} onDecide={onDecide} />);
    swipe(SWIPE_THRESHOLD_PX + 20, 200);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("tap opens the editor", () => {
    render(<ApprovalCard approval={APPROVAL} onDecide={() => {}} />);
    swipe(2);
    expect(card().getAttribute("data-state")).toBe("editing");
  });

  it("submitting: everything is inert", () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={APPROVAL} onDecide={onDecide} submitting />);
    expect(card().getAttribute("data-state")).toBe("submitting");
    for (const b of screen.getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
    swipe(SWIPE_THRESHOLD_PX + 50);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("failed: the submission error is shown and the card stays actionable", () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={APPROVAL} onDecide={onDecide} error="bus unreachable: ECONNREFUSED" />);
    expect(card().getAttribute("data-state")).toBe("failed");
    expect(screen.getByRole("alert").textContent).toBe("bus unreachable: ECONNREFUSED");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onDecide).toHaveBeenCalledWith("approve");
  });

  it("resolved: read-only with the decision named", () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={APPROVAL} onDecide={onDecide} resolved="skip" />);
    expect(card().getAttribute("data-state")).toBe("resolved");
    expect(screen.getByTestId("approval-resolved").textContent).toBe("skipped");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    swipe(SWIPE_THRESHOLD_PX + 50);
    expect(onDecide).not.toHaveBeenCalled();
  });
});
