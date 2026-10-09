import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each file runs in its own worker; the core launch registry is per process.
    fileParallelism: true,
  },
});
