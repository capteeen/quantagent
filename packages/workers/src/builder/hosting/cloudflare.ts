/**
 * Cloudflare Pages Direct Upload adapter. No build step: files are hashed, uploaded
 * and a deployment is created from a manifest, the same flow `wrangler pages deploy`
 * uses (researched from the Pages API docs + wrangler's upload client):
 *
 *   GET  /accounts/{account}/pages/projects/{project}                 ensure the project (POST creates it)
 *   GET  /accounts/{account}/pages/projects/{project}/upload-token    → { result: { jwt } }
 *   POST /pages/assets/check-missing   { hashes }      Bearer <jwt>  → hashes not yet stored
 *   POST /pages/assets/upload          [{ key, value(base64), metadata:{contentType}, base64:true }]
 *   POST /pages/assets/upsert-hashes   { hashes }
 *   POST /accounts/{account}/pages/projects/{project}/deployments   multipart: manifest={"/index.html":hash}, branch
 *   POST /accounts/{account}/pages/projects/{project}/domains       { name }   custom domain
 *
 * File hash = blake3(base64(content) + extension).hex.slice(0, 32).
 * One Pages project per slug (`<CF_PAGES_PROJECT>-<slug>`) so each coin gets its own
 * host; with SITE_DOMAIN set, `<slug>.<SITE_DOMAIN>` is attached as a custom domain
 * (the zone must be on Cloudflare with a wildcard CNAME to pages.dev).
 *
 * Env: CF_API_TOKEN (Pages:Edit), CF_ACCOUNT_ID, CF_PAGES_PROJECT (prefix), SITE_DOMAIN (optional).
 */

import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";
import { NotImplemented } from "@quantagent/core/types";
import type { HostingClient } from "@quantagent/core/types/clients";
import { fetchBytes } from "../../artist/storage";
import { env, requireEnv } from "../../shared";

export const CF_ENV = ["CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_PAGES_PROJECT"] as const;
const API = "https://api.cloudflare.com/client/v4";

export interface CloudflareHostingOptions {
  apiToken?: string;
  accountId?: string;
  projectPrefix?: string;
  siteDomain?: string;
  fetch?: typeof fetch;
}

export interface UploadFile {
  path: string;
  bytes: Uint8Array;
  contentType: string;
}

export function cfFileHash(bytes: Uint8Array, path: string): string {
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : "";
  const b64 = Buffer.from(bytes).toString("base64");
  return bytesToHex(blake3(new TextEncoder().encode(b64 + ext))).slice(0, 32);
}

export function cfProjectName(prefix: string, slug: string): string {
  return `${prefix}-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 58);
}

interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

export function createCloudflareHosting(o: CloudflareHostingOptions = {}): HostingClient {
  const apiToken = o.apiToken ?? env("CF_API_TOKEN");
  const accountId = o.accountId ?? env("CF_ACCOUNT_ID");
  const prefix = o.projectPrefix ?? env("CF_PAGES_PROJECT");
  const missing = [!apiToken && "CF_API_TOKEN", !accountId && "CF_ACCOUNT_ID", !prefix && "CF_PAGES_PROJECT"].filter(Boolean) as string[];
  if (missing.length) throw new NotImplemented("Builder.hosting.cloudflare", `missing environment: ${missing.join(", ")}`, missing);
  const siteDomain = o.siteDomain ?? env("SITE_DOMAIN");
  const f = o.fetch ?? fetch;
  const auth = { authorization: `Bearer ${apiToken}` };

  async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<CfEnvelope<T>> {
    const res = await f(path.startsWith("http") ? path : `${API}${path}`, {
      ...init,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : auth), ...(init.headers as Record<string, string> | undefined) },
    });
    const text = await res.text();
    let json: CfEnvelope<T>;
    try {
      json = JSON.parse(text) as CfEnvelope<T>;
    } catch {
      throw new Error(`cloudflare ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok || !json.success) {
      const msg = json.errors?.map((e) => `${e.code} ${e.message}`).join("; ") ?? text.slice(0, 200);
      const err = new Error(`cloudflare ${init.method ?? "GET"} ${path} → ${res.status}: ${msg}`) as Error & { status: number; code?: number | undefined };
      err.status = res.status;
      err.code = json.errors?.[0]?.code;
      throw err;
    }
    return json;
  }

  async function ensureProject(project: string): Promise<void> {
    try {
      await api(`/accounts/${accountId}/pages/projects/${project}`);
      return;
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
    await api(`/accounts/${accountId}/pages/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: project, production_branch: "main" }),
    });
  }

  async function ensureDomain(project: string, domain: string): Promise<void> {
    try {
      await api(`/accounts/${accountId}/pages/projects/${project}/domains`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: domain }),
      });
    } catch (err) {
      // 8000011 / 409: domain already attached — fine.
      const e = err as { status?: number; code?: number };
      if (e.status !== 409 && e.code !== 8000011) throw err;
    }
  }

  async function uploadFiles(project: string, files: UploadFile[]): Promise<Record<string, string>> {
    const token = (await api<{ jwt: string }>(`/accounts/${accountId}/pages/projects/${project}/upload-token`)).result.jwt;
    const manifest: Record<string, string> = {};
    const byHash = new Map<string, UploadFile>();
    for (const file of files) {
      const hash = cfFileHash(file.bytes, file.path);
      manifest[`/${file.path.replace(/^\/+/, "")}`] = hash;
      byHash.set(hash, file);
    }
    const missing = (
      await api<string[]>(`/pages/assets/check-missing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hashes: [...byHash.keys()] }),
      }, token)
    ).result;
    if (missing.length) {
      const payload = missing.map((hash) => {
        const file = byHash.get(hash)!;
        return { key: hash, value: Buffer.from(file.bytes).toString("base64"), metadata: { contentType: file.contentType }, base64: true };
      });
      await api(`/pages/assets/upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }, token);
    }
    await api(`/pages/assets/upsert-hashes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hashes: [...byHash.keys()] }),
    }, token);
    return manifest;
  }

  return {
    provider: "cloudflare-pages",
    async publish({ slug, html, assets = [] }) {
      const project = cfProjectName(prefix!, slug);
      await ensureProject(project);
      const files: UploadFile[] = [{ path: "index.html", bytes: new TextEncoder().encode(html), contentType: "text/html" }];
      for (const a of assets) {
        const { bytes, contentType } = await fetchBytes(a.url, f);
        files.push({ path: a.path, bytes, contentType });
      }
      const manifest = await uploadFiles(project, files);
      const form = new FormData();
      form.set("manifest", JSON.stringify(manifest));
      form.set("branch", "main");
      const dep = await api<{ id: string; url: string }>(`/accounts/${accountId}/pages/projects/${project}/deployments`, { method: "POST", body: form });
      let url = `https://${project}.pages.dev`;
      if (siteDomain) {
        const domain = `${slug}.${siteDomain}`;
        await ensureDomain(project, domain);
        url = `https://${domain}`;
      }
      return { url, deployId: dep.result.id };
    },
    async connectCustomDomain({ slug, domain }) {
      const project = cfProjectName(prefix!, slug);
      await ensureDomain(project, domain);
      return { verification: `Point ${domain} at ${project}.pages.dev with a CNAME; Cloudflare verifies it automatically.` };
    },
  };
}
