/**
 * Hosting provider selection. HOSTING_PROVIDER=cloudflare|vercel picks the adapter;
 * each adapter throws NotImplemented naming its env vars when they are missing.
 */

import { NotImplemented } from "@quantagent/core/types";
import type { HostingClient } from "@quantagent/core/types/clients";
import { env } from "../../shared";
import { CF_ENV, createCloudflareHosting } from "./cloudflare";
import { VERCEL_ENV, createVercelHosting } from "./vercel";

export const HOSTING_PROVIDERS = ["cloudflare", "vercel"] as const;
export type HostingProvider = (typeof HOSTING_PROVIDERS)[number];

export function hostingClientFromEnv(opts: { provider?: string; fetch?: typeof fetch } = {}): HostingClient {
  const provider = opts.provider ?? env("HOSTING_PROVIDER");
  if (!provider) {
    throw new NotImplemented("Builder.hosting", "HOSTING_PROVIDER is not set", ["HOSTING_PROVIDER=cloudflare|vercel", ...CF_ENV, ...VERCEL_ENV]);
  }
  const fetchOpt = opts.fetch ? { fetch: opts.fetch } : {};
  switch (provider) {
    case "cloudflare":
      return createCloudflareHosting(fetchOpt);
    case "vercel":
      return createVercelHosting(fetchOpt);
    default:
      throw new NotImplemented("Builder.hosting", `HOSTING_PROVIDER "${provider}" is not one of ${HOSTING_PROVIDERS.join("|")}`, [
        "HOSTING_PROVIDER=cloudflare|vercel",
      ]);
  }
}

export { createCloudflareHosting, createVercelHosting };
