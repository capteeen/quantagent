import { render, screen } from "@testing-library/react";
import { Footer, FOOTER_TEXT } from "./Footer";

describe("Footer", () => {
  it("renders the exact SPEC §8 text, nothing else", () => {
    render(<Footer />);
    expect(FOOTER_TEXT).toBe(
      "Quantagent runs parallel workers on verifiable quantum randomness. It is not a mind and will not make a bad idea good. Coins launch on pump.fun (Solana). A meme, not an investment.",
    );
    expect(screen.getByRole("contentinfo").textContent).toBe(FOOTER_TEXT);
  });
});
