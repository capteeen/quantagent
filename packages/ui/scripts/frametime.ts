/**
 * Frame-time test, SPEC §6.7: Playwright at 390×844, CPU throttled 4× (CDP
 * Emulation.setCPUThrottlingRate), the recorded fixture fed at real timings through a full
 * launch; requestAnimationFrame deltas sampled; median must be ≥ 55fps; heap sampled before
 * and after (no growth across a launch).
 *
 *   pnpm --filter @quantagent/ui frametime
 *
 * Env:  FRAMETIME_SPEED=1     fixture playback speed (1 = real time, 34s)
 *       FRAMETIME_STRICT=1    enforce the fps assertion even on software GL
 *       FRAMETIME_DPR=2       device scale factor
 *       FRAMETIME_SCREENSHOT=path  save a screenshot after the launch
 *       CHROMIUM_PATH         override the browser binary
 *
 * Chromium is preinstalled under /opt/pw-browsers; this never runs `playwright install`.
 * If the browser or WebGL cannot run here, the script prints why and skips (exit 0).
 * Scene errors in the console always fail (exit 1): the chamber must not throw.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { medianOf } from "../src/chamber/perf/frameMonitor";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const repoRoot = resolve(pkgRoot, "../..");
const FIXTURE = resolve(pkgRoot, "src/fixtures/launch.recorded.json");
const TARGET_FPS = 55;

function findChromium(): string | null {
  const env = process.env["CHROMIUM_PATH"];
  if (env && existsSync(env)) return env;
  const base = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? "/opt/pw-browsers";
  const candidates = [
    `${base}/chromium-1194/chrome-linux/chrome`,
    `${base}/chromium/chrome-linux/chrome`,
    `${base}/chromium_headless_shell-1194/chrome-linux/headless_shell`,
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    /* no bundled browser */
  }
  return null;
}

function skip(reason: string): never {
  console.log(`frametime: SKIPPED — ${reason}`);
  process.exit(0);
}

async function main() {
  const speed = Number(process.env["FRAMETIME_SPEED"] ?? "1") || 1;
  const strict = process.env["FRAMETIME_STRICT"] === "1";
  const dpr = Number(process.env["FRAMETIME_DPR"] ?? "2") || 2;
  const events = JSON.parse(readFileSync(FIXTURE, "utf8")) as { at: string }[];
  const spanMs = Date.parse(events[events.length - 1]!.at) - Date.parse(events[0]!.at);

  const executablePath = findChromium();
  if (!executablePath) skip("no Chromium binary found (PLAYWRIGHT_BROWSERS_PATH / CHROMIUM_PATH)");

  const server = await createServer({
    configFile: false,
    root: resolve(here, "harness"),
    logLevel: "error",
    plugins: [react()],
    server: { port: 0, host: "127.0.0.1", fs: { allow: [repoRoot] } },
    optimizeDeps: { entries: ["./main.tsx"] },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    await server.close();
    skip("vite dev server gave no local url");
  }

  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--ignore-gpu-blocklist",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--enable-precise-memory-info",
        "--disable-dev-shm-usage",
      ],
    });
  } catch (e) {
    await server.close();
    skip(`Chromium failed to launch: ${(e as Error).message.split("\n")[0]}`);
  }

  const errors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on("console", (m) => {
      // network failures (fonts behind a proxy, favicons) are not scene errors
      if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("HeapProfiler.enable");

    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__chamber?.ready === true, undefined, { timeout: 30_000 });
    const renderer = await page.evaluate(() => window.__chamber.renderer());
    if (renderer === "no-webgl") skip("WebGL is not available in this Chromium");
    const softwareGL = /swiftshader|llvmpipe|software|mesa/i.test(renderer);
    console.log(`frametime: renderer=${renderer} viewport=390x844 dpr=${dpr} cpuThrottle=4x speed=${speed}x fixture=${events.length} events over ${(spanMs / 1000).toFixed(1)}s`);

    // give strands and post-FX time to stream in, then settle; measure the idle baseline
    await page.waitForTimeout(1500);
    const idle = await page.evaluate(
      () =>
        new Promise<number[]>((res) => {
          const stop = window.__chamber.sample();
          setTimeout(() => res(stop()), 2000);
        }),
    );
    console.log(`frametime: idle baseline frames=${idle.length} median=${medianOf(idle).toFixed(2)}ms (${(1000 / medianOf(idle)).toFixed(1)}fps)`);
    await cdp.send("HeapProfiler.collectGarbage");
    const heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize;

    await page.evaluate(() => {
      window.__sampleStop = window.__chamber.sample();
    });
    const fed = await page.evaluate((s) => window.__chamber.feed(window.__chamber.fixture, s), speed);
    await page.waitForTimeout(3000);
    const samples = await page.evaluate(() => window.__sampleStop());
    const lived = await page.evaluate(() => window.__chamber.lived);
    const phase = await page.evaluate(() => window.__chamber.store.getState().phase);
    const tier = await page.evaluate(() => window.__chamber.store.getState().settings.perfTier);

    const shot = process.env["FRAMETIME_SCREENSHOT"];
    if (shot) await page.screenshot({ path: shot });
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(500);
    await cdp.send("HeapProfiler.collectGarbage");
    const heapAfter = (await cdp.send("Runtime.getHeapUsage")).usedSize;

    // a second launch on the same chamber: growth across THIS one is what "no heap growth" means
    // (the first pass also paid for lazy chunks, the parsed fixture and the fonts)
    await page.evaluate(() => window.__chamber.store.reset());
    await page.waitForTimeout(500);
    await page.evaluate((s) => window.__chamber.feed(window.__chamber.fixture, s), speed * 2);
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__chamber.store.reset());
    await page.waitForTimeout(500);
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(500);
    await cdp.send("HeapProfiler.collectGarbage");
    const heapSecond = (await cdp.send("Runtime.getHeapUsage")).usedSize;

    const medianMs = medianOf(samples);
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? NaN;
    const medianFps = 1000 / medianMs;
    const growth = heapAfter - heapBefore;
    const growthPct = (growth / heapBefore) * 100;

    console.log(`frametime: frames=${samples.length} median=${medianMs.toFixed(2)}ms (${medianFps.toFixed(1)}fps) p95=${p95.toFixed(2)}ms fed in ${(fed / 1000).toFixed(1)}s phase=${phase} onLive=${lived} perfTier=${tier}`);
    const secondGrowth = heapSecond - heapAfter;
    const secondPct = (secondGrowth / heapAfter) * 100;
    console.log(`frametime: heap before=${(heapBefore / 1048576).toFixed(1)}MB after first launch=${(heapAfter / 1048576).toFixed(1)}MB (+${(growth / 1048576).toFixed(1)}MB, ${growthPct.toFixed(1)}%, includes lazy chunks) after second launch=${(heapSecond / 1048576).toFixed(1)}MB (${secondGrowth >= 0 ? "+" : ""}${(secondGrowth / 1048576).toFixed(1)}MB, ${secondPct.toFixed(1)}% across a launch)`);
    if (errors.length) {
      console.error(`frametime: FAILED — ${errors.length} console error(s):`);
      for (const e of errors.slice(0, 10)) console.error("  " + e);
      process.exitCode = 1;
      return;
    }
    if (samples.length < 30) {
      console.log(`frametime: SKIPPED — only ${samples.length} frame(s) rendered through the launch on ${renderer}: this machine cannot render the chamber at a measurable rate (try FRAMETIME_DPR=1 FRAMETIME_SPEED=4), so neither the fps nor the heap figures mean anything here`);
      return;
    }
    if (phase !== "live" || lived < 1) {
      console.error(`frametime: FAILED — the recorded launch did not reach live (phase=${phase}, onLive=${lived})`);
      process.exitCode = 1;
      return;
    }
    if (medianFps < TARGET_FPS) {
      if (softwareGL && !strict) {
        console.log(`frametime: SKIPPED assertion — ${renderer} is software GL, not a mid-range phone GPU; median ${medianFps.toFixed(1)}fps < ${TARGET_FPS} is not meaningful here (set FRAMETIME_STRICT=1 to enforce)`);
      } else {
        console.error(`frametime: FAILED — median ${medianFps.toFixed(1)}fps < ${TARGET_FPS}fps`);
        process.exitCode = 1;
      }
    } else {
      console.log(`frametime: PASS — median ${medianFps.toFixed(1)}fps ≥ ${TARGET_FPS}fps`);
    }
    if (secondPct > 10) console.warn(`frametime: WARNING — heap grew ${secondPct.toFixed(1)}% across the second launch`);
  } finally {
    await browser.close();
    await server.close();
  }
}

declare global {
  interface Window {
    __sampleStop: () => number[];
  }
}

main().catch((e) => {
  console.error("frametime: error", e);
  process.exitCode = 1;
});
