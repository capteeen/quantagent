import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Workspace packages export TypeScript sources; Next compiles them.
  transpilePackages: ["@quantagent/core", "@quantagent/workers", "@quantagent/x", "@quantagent/solana", "@quantagent/ui"],
  experimental: {
    externalDir: true,
    // Node-only dependencies of the server packages stay out of the bundle.
    serverComponentsExternalPackages: ["bullmq", "ioredis", "pg", "sharp", "jimp", "@aws-sdk/client-s3"],
  },
  webpack: (webpackConfig, { isServer }) => {
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      // The pure launch reducer, importable on the client without core's Node-only adapters.
      "@quantagent/core-state": path.join(repoRoot, "packages", "core", "src", "state", "index.ts"),
    };
    if (!isServer) {
      webpackConfig.resolve.fallback = { ...webpackConfig.resolve.fallback, fs: false, net: false, tls: false, dns: false, child_process: false };
    }
    return webpackConfig;
  },
};

export default config;
