import { defineConfig } from "@playwright/test";

const PORT = Number(process.env["E2E_PORT"] ?? 3977);

function definedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") out[k] = v;
  return out;
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    launchOptions: {
      ...(process.env["PW_CHROMIUM_PATH"] ? { executablePath: process.env["PW_CHROMIUM_PATH"] } : {}),
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/status`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { ...definedEnv(), SESSION_SECRET: process.env["SESSION_SECRET"] ?? "e2e-only-secret", NEXT_TELEMETRY_DISABLED: "1" },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
