import { WORKER_COLORS, WORKER_NAMES } from "@quantagent/core/types";
import { colors, cssVar, fonts, motion, tokens, tokensCss, workerColors } from "../tokens";
import preset from "../tailwind-preset";

describe("tokens", () => {
  it("carries the exact SPEC 6.8 colours", () => {
    expect(colors.void).toBe("#06080A");
    expect(colors.panel).toBe("#0D1117");
    expect(colors.border).toBe("#1C2430");
    expect(colors.probability).toBe("#4DD0E1");
    expect(colors.collapse).toBe("#E91E63");
    expect(colors.decay).toBe("#FFB300");
    expect(colors.tunnel).toBe("#F0F4F8");
    expect(colors.text).toBe("#D7DEE6");
    expect(colors.muted).toBe("#6B7684");
  });

  it("re-exports the eight worker colours from the shared contract, never a copy", () => {
    expect(workerColors).toBe(WORKER_COLORS);
    expect(Object.keys(workerColors)).toHaveLength(8);
    expect(workerColors.Ideator).toBe("#4DD0E1");
    expect(workerColors.Artist).toBe("#E91E63");
    expect(workerColors.Builder).toBe("#FF8A3D");
    expect(workerColors.Launcher).toBe("#FFFFFF");
    expect(workerColors.Voice).toBe("#FFB300");
    expect(workerColors.Trader).toBe("#7CFF6B");
    expect(workerColors.Shield).toBe("#FF3B30");
    expect(workerColors.Recruiter).toBe("#B388FF");
  });

  it("uses JetBrains Mono for data and Space Grotesk 600 for headings", () => {
    expect(fonts.mono).toMatch(/^"JetBrains Mono"/);
    expect(fonts.heading).toMatch(/^"Space Grotesk"/);
    expect(fonts.headingWeight).toBe(600);
  });

  it("moves on the one easing, never under 700ms (except the collapse snap)", () => {
    expect(motion.easing).toBe("cubic-bezier(0.4,0,0.2,1)");
    expect(motion.minMs).toBe(700);
    for (const [k, v] of Object.entries(motion.duration)) {
      if (k === "collapseSnapMs" || k === "reducedMs") continue;
      expect(v).toBeGreaterThanOrEqual(700);
    }
  });

  it("emits every token as a CSS custom property", () => {
    expect(tokensCss.startsWith(":root {")).toBe(true);
    expect(tokensCss).toContain("--qa-color-void: #06080A;");
    expect(tokensCss).toContain("--qa-color-probability: #4DD0E1;");
    for (const name of WORKER_NAMES) expect(tokensCss).toContain(`--qa-worker-${name.toLowerCase()}: ${WORKER_COLORS[name]};`);
    expect(tokensCss).toContain("--qa-ease: cubic-bezier(0.4,0,0.2,1);");
    expect(tokensCss).toContain("--qa-duration-base: 700ms;");
    expect(cssVar.color("void")).toBe("var(--qa-color-void)");
    expect(cssVar.worker("Ideator")).toBe("var(--qa-worker-ideator)");
    expect(tokens.hit.min).toBe(44);
  });

  it("exposes the tokens through the tailwind preset", () => {
    const theme = preset.theme?.extend as Record<string, Record<string, unknown>>;
    expect(theme.colors?.void).toBe("#06080A");
    expect((theme.colors?.worker as Record<string, string>).shield).toBe("#FF3B30");
    expect((theme.fontFamily?.mono as string[])[0]).toBe('"JetBrains Mono"');
    expect((theme.transitionTimingFunction as Record<string, string>).quant).toBe(motion.easing);
    expect((theme.transitionDuration as Record<string, string>).quant).toBe("700ms");
    expect((theme.minHeight as Record<string, string>).hit).toBe("44px");
  });
});
