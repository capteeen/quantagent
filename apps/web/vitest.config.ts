import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.join(here, "src"),
      "@quantagent/core-state": path.join(repoRoot, "packages", "core", "src", "state", "index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
    environmentMatchGlobs: [["test/**/*.test.tsx", "jsdom"]],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20_000,
    css: false,
  },
});
