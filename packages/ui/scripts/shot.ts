/**
 * Screenshot the chamber at a point in the recorded fixture (no CPU throttle). A look tool:
 *
 *   pnpm --filter @quantagent/ui shot -- <mode> <seq|-1> <out.png> [waitMs] [reduced 0|1] [framing spec|fit]
 *
 * mode = idle | launch | live | coin. seq = apply fixture events up to this seq (-1 = none).
 * Env: SHOT_W / SHOT_H viewport (default 390×844), SHOT_GOVERNOR=0 keeps every effect on
 * (software GL is far below 55fps, so the governor would otherwise strip the look).
 * Uses the preinstalled Chromium under /opt/pw-browsers (never runs `playwright install`).
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

async function main() {
  const [mode = "idle", seqArg = "-1", out = "chamber.png", waitArg = "2500", reduced = "0", framing = "spec"] = process.argv.slice(2);
  const seq = Number(seqArg);
  const base = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? "/opt/pw-browsers";
  const executablePath = process.env["CHROMIUM_PATH"] ?? `${base}/chromium-1194/chrome-linux/chrome`;
  if (!existsSync(executablePath)) {
    console.log(`shot: SKIPPED — no Chromium at ${executablePath}`);
    return;
  }
  const server = await createServer({
    configFile: false,
    root: resolve(here, "harness"),
    logLevel: "error",
    plugins: [react()],
    server: { port: 0, host: "127.0.0.1", fs: { allow: [repoRoot] } },
  });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!;
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: Number(process.env["SHOT_W"] ?? 390), height: Number(process.env["SHOT_H"] ?? 844) }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text());
    });
    await page.goto(`${url}?mode=${mode}&reduced=${reduced}&framing=${framing}&governor=${process.env["SHOT_GOVERNOR"] ?? "1"}`);
    await page.waitForFunction(() => window.__chamber?.ready === true, undefined, { timeout: 120_000 });
    await page.waitForTimeout(1200);
    if (seq >= 0) {
      await page.evaluate((n) => {
        const c = window.__chamber;
        c.store.applyMany(c.fixture.filter((e) => e.seq <= n));
      }, seq);
    }
    await page.waitForTimeout(Number(waitArg));
    await page.screenshot({ path: out });
    const phase = await page.evaluate(() => window.__chamber.store.getState().phase);
    console.log(`shot: saved ${out} (mode=${mode} seq=${seq} phase=${phase}) errors: ${errs.length ? errs.join(" | ") : "none"}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error("shot: error", e);
  process.exitCode = 1;
});
