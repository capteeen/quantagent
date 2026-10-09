/**
 * Vercel adapter via the deployments API with inline files (no build step):
 *
 *   POST /v13/deployments { name, project, target:"production", files:[{file,data,encoding}], projectSettings:{framework:null} }
 *        → { id, url, readyState }   (name creates the project when it does not exist)
 *   GET  /v13/deployments/{id}       polled until readyState READY/ERROR
 *   POST /v10/projects/{idOrName}/domains { name }     → { verified, verification[] }
 *
 * One project per slug (`<VERCEL_PROJECT>-<slug>`); with SITE_DOMAIN set the
 * subdomain `<slug>.<SITE_DOMAIN>` is attached (SITE_DOMAIN must be verified on the
 * Vercel account / team).
 *
 * Env: VERCEL_TOKEN, VERCEL_PROJECT (prefix), VERCEL_TEAM_ID (optional), SITE_DOMAIN (optional).
 */

import { NotImplemented } from "@quantagent/core/types";
import type { HostingClient } from "@quantagent/core/types/clients";
import { fetchBytes } from "../../artist/storage";
import { env, sleep } from "../../shared";

export const VERCEL_ENV = ["VERCEL_TOKEN", "VERCEL_PROJECT"] as const;
const API = "https://api.vercel.com";

export interface VercelHostingOptions {
  token?: string;
  projectPrefix?: string;
  teamId?: string;
  siteDomain?: string;
  fetch?: typeof fetch;
  pollMs?: number;
  maxWaitMs?: number;
}

export function vercelProjectName(prefix: string, slug: string): string {
  return `${prefix}-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 100);
}

interface Deployment {
  id: string;
  url: string;
  readyState: "QUEUED" | "INITIALIZING" | "BUILDING" | "READY" | "ERROR" | "CANCELED" | "BLOCKED";
  errorMessage?: string;
}

export function createVercelHosting(o: VercelHostingOptions = {}): HostingClient {
  const token = o.token ?? env("VERCEL_TOKEN");
  const prefix = o.projectPrefix ?? env("VERCEL_PROJECT");
  const missing = [!token && "VERCEL_TOKEN", !prefix && "VERCEL_PROJECT"].filter(Boolean) as string[];
  if (missing.length) throw new NotImplemented("Builder.hosting.vercel", `missing environment: ${missing.join(", ")}`, missing);
  const teamId = o.teamId ?? env("VERCEL_TEAM_ID");
  const siteDomain = o.siteDomain ?? env("SITE_DOMAIN");
  const f = o.fetch ?? fetch;
  const pollMs = o.pollMs ?? 1000;
  const maxWaitMs = o.maxWaitMs ?? 60_000;
  const q = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await f(`${API}${path}${q}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`vercel ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async function ensureDomain(project: string, domain: string): Promise<{ verified: boolean; verification: string }> {
    try {
      const r = await api<{ verified: boolean; verification?: { type: string; domain: string; value: string }[] }>(`/v10/projects/${project}/domains`, {
        method: "POST",
        body: JSON.stringify({ name: domain }),
      });
      const v = r.verification?.map((x) => `${x.type} ${x.domain} → ${x.value}`).join("; ") ?? (r.verified ? "verified" : "pending");
      return { verified: r.verified, verification: v };
    } catch (err) {
      if ((err as { status?: number }).status === 409 || /already/i.test(String((err as Error).message))) return { verified: true, verification: "already attached" };
      throw err;
    }
  }

  return {
    provider: "vercel",
    async publish({ slug, html, assets = [] }) {
      const project = vercelProjectName(prefix!, slug);
      const files: { file: string; data: string; encoding?: "base64" }[] = [{ file: "index.html", data: html }];
      for (const a of assets) {
        const { bytes } = await fetchBytes(a.url, f);
        files.push({ file: a.path.replace(/^\/+/, ""), data: Buffer.from(bytes).toString("base64"), encoding: "base64" });
      }
      let dep = await api<Deployment>(`/v13/deployments`, {
        method: "POST",
        body: JSON.stringify({
          name: project,
          project,
          target: "production",
          files,
          projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
        }),
      });
      const t0 = Date.now();
      while (dep.readyState !== "READY" && dep.readyState !== "ERROR" && dep.readyState !== "CANCELED") {
        if (Date.now() - t0 > maxWaitMs) throw new Error(`vercel deployment ${dep.id} still ${dep.readyState} after ${maxWaitMs}ms`);
        await sleep(pollMs);
        dep = await api<Deployment>(`/v13/deployments/${dep.id}`);
      }
      if (dep.readyState !== "READY") throw new Error(`vercel deployment ${dep.id} ${dep.readyState}: ${dep.errorMessage ?? "no error text"}`);
      let url = `https://${dep.url}`;
      if (siteDomain) {
        const domain = `${slug}.${siteDomain}`;
        await ensureDomain(project, domain);
        url = `https://${domain}`;
      }
      return { url, deployId: dep.id };
    },
    async connectCustomDomain({ slug, domain }) {
      const project = vercelProjectName(prefix!, slug);
      const { verification } = await ensureDomain(project, domain);
      return { verification };
    },
  };
}
