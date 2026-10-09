#!/usr/bin/env node
/**
 * Runs the Playwright smoke test when a Chromium is available (PLAYWRIGHT_BROWSERS_PATH,
 * default /opt/pw-browsers). When the browser cannot launch, prints the reason and exits 0
 * so `pnpm test` stays honest about what ran.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

function skip(reason) {
  console.log(`[e2e] SKIPPED: ${reason}`);
  process.exit(0);
}

if (process.env.SKIP_E2E === "1") skip("SKIP_E2E=1");
if (!existsSync(browsersPath)) skip(`no Playwright browsers at ${browsersPath} (set PLAYWRIGHT_BROWSERS_PATH or run: pnpm exec playwright install chromium)`);

let chromium;
try {
  ({ chromium } = await import("@playwright/test"));
} catch (err) {
  skip(`@playwright/test is not installed: ${err instanceof Error ? err.message : String(err)}`);
}

// Prefer the Chromium Playwright itself expects; otherwise any chromium-<rev> under the browsers path
// (the one this machine ships may be older than the installed Playwright's), passed on as PW_CHROMIUM_PATH.
let executablePath = process.env.PW_CHROMIUM_PATH;
if (!executablePath) {
  const expected = chromium.executablePath();
  if (expected && existsSync(expected)) executablePath = expected;
  else {
    const candidates = readdirSync(browsersPath)
      .filter((d) => /^chromium-\d+$/.test(d))
      .map((d) => path.join(browsersPath, d, "chrome-linux", "chrome"))
      .filter((p) => existsSync(p));
    executablePath = candidates[candidates.length - 1];
  }
}
if (!executablePath) skip(`no Chromium under ${browsersPath}`);
process.env.PW_CHROMIUM_PATH = executablePath;

try {
  const browser = await chromium.launch({ executablePath, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  await browser.close();
} catch (err) {
  skip(`Chromium at ${executablePath} cannot launch: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
}
console.log(`[e2e] chromium: ${executablePath}`);

const result = spawnSync("pnpm", ["exec", "playwright", "test", "--config", path.join(app, "playwright.config.ts")], { cwd: app, stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
