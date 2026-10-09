import { fireEvent, render, screen } from "@testing-library/react";
import { PromptBox, PROMPT_PLACEHOLDER } from "./PromptBox";

describe("PromptBox", () => {
  it("empty: shows the exact placeholder and no content", () => {
    render(<PromptBox value="" onChange={() => {}} onSurprise={() => {}} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(PROMPT_PLACEHOLDER).toBe("a coin about…");
    expect(input.placeholder).toBe("a coin about…");
    expect(input.value).toBe("");
  });

  it("typing: reports every change and submits on Enter", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<PromptBox value="a coin about" onChange={onChange} onSurprise={() => {}} onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "a coin about frogs" } });
    expect(onChange).toHaveBeenCalledWith("a coin about frogs");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("surprise me: clears the line and sets the flag; renders pressed when set", () => {
    const onChange = vi.fn();
    const onSurprise = vi.fn();
    const { rerender } = render(<PromptBox value="something" onChange={onChange} onSurprise={onSurprise} />);
    const chip = screen.getByRole("button", { name: "surprise me" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith("");
    expect(onSurprise).toHaveBeenCalledTimes(1);
    rerender(<PromptBox value="" onChange={onChange} onSurprise={onSurprise} surprise />);
    expect(screen.getByRole("button", { name: "surprise me" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("disabled: input and chip are inert", () => {
    render(<PromptBox value="" onChange={() => {}} onSurprise={() => {}} disabled />);
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "surprise me" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("failed: shows the validation error and marks the input invalid", () => {
    render(<PromptBox value="" onChange={() => {}} onSurprise={() => {}} error="Say what the coin is about, or tap surprise me." />);
    expect(screen.getByRole("alert").textContent).toBe("Say what the coin is about, or tap surprise me.");
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
  });
});
