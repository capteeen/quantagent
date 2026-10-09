/**
 * Footer: on every screen, the exact text from SPEC §8.
 */
import { cx } from "./primitives";

export const FOOTER_TEXT =
  "Quantagent runs parallel workers on verifiable quantum randomness. It is not a mind and will not make a bad idea good. Coins launch on pump.fun (Solana). A meme, not an investment.";

export interface FooterProps {
  className?: string;
}

export function Footer({ className }: FooterProps) {
  return (
    <footer data-testid="footer" className={cx("border-t border-border px-4 py-4 font-mono text-[11px] leading-relaxed text-muted", className)}>
      <p>{FOOTER_TEXT}</p>
    </footer>
  );
}
