import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import { hostingClientFromEnv } from "./index";
import { cfFileHash, cfProjectName, createCloudflareHosting } from "./cloudflare";
import { createVercelHosting, vercelProjectName } from "./vercel";
import { fetchStub } from "../../testing/fakes";

const HTML = "<!doctype html><html><body>hi</body></html>";
const OG = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;

describe("hosting selection", () => {
  it("throws NotImplemented naming HOSTING_PROVIDER and the adapters' vars when unset", () => {
    const saved = { ...process.env };
    delete process.env.HOSTING_PROVIDER;
    try {
      try {
        hostingClientFromEnv();
        expect.fail("should throw");
      } catch (e) {
        expect(e).toBeInstanceOf(NotImplemented);
        expect((e as NotImplemented).needs).toEqual(["HOSTING_PROVIDER=cloudflare|vercel", "CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_PAGES_PROJECT", "VERCEL_TOKEN", "VERCEL_PROJECT"]);
      }
      for (const k of ["CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_PAGES_PROJECT", "VERCEL_TOKEN", "VERCEL_PROJECT"]) delete process.env[k];
      try {
        hostingClientFromEnv({ provider: "cloudflare" });
        expect.fail("should throw");
      } catch (e) {
        expect((e as NotImplemented).needs).toEqual(["CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_PAGES_PROJECT"]);
      }
      try {
        hostingClientFromEnv({ provider: "vercel" });
        expect.fail("should throw");
      } catch (e) {
        expect((e as NotImplemented).needs).toEqual(["VERCEL_TOKEN", "VERCEL_PROJECT"]);
      }
      expect(() => hostingClientFromEnv({ provider: "netlify" })).toThrow(/not one of/);
    } finally {
      process.env = saved;
    }
  });
});

describe("cloudflare pages direct upload", () => {
  it("hashes like wrangler (blake3 of base64 + ext, 32 hex) and names projects per slug", () => {
    const h = cfFileHash(new TextEncoder().encode(HTML), "index.html");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(cfFileHash(new TextEncoder().encode(HTML), "index.html")).toBe(h);
    expect(cfFileHash(new TextEncoder().encode(HTML), "index.txt")).not.toBe(h);
    expect(cfProjectName("quantagent", "QCAT")).toBe("quantagent-qcat");
  });
  it("ensures the project, uploads missing assets with the upload token, creates the deployment from a manifest, attaches the subdomain", async () => {
    const stub = fetchStub([
      { match: /\/pages\/projects\/quantagent-qcat$/, status: 404, body: { success: false, errors: [{ code: 8000007, message: "Project not found" }] } },
      { match: /\/pages\/projects$/, body: { success: true, result: { name: "quantagent-qcat" } } },
      { match: "/upload-token", body: { success: true, result: { jwt: "jwt-1" } } },
      { match: "/pages/assets/check-missing", body: { success: true, result: [cfFileHash(new TextEncoder().encode(HTML), "index.html")] } },
      { match: "/pages/assets/upload", body: { success: true, result: null } },
      { match: "/pages/assets/upsert-hashes", body: { success: true, result: null } },
      { match: "/deployments", body: { success: true, result: { id: "dep-1", url: "https://abc.quantagent-qcat.pages.dev" } } },
      { match: "/domains", body: { success: true, result: { name: "qcat.quantagent.site", status: "pending" } } },
    ]);
    const client = createCloudflareHosting({ apiToken: "cf-token", accountId: "acct", projectPrefix: "quantagent", siteDomain: "quantagent.site", fetch: stub.fetch });
    const out = await client.publish({ slug: "qcat", html: HTML, assets: [{ path: "og.svg", url: OG }] });
    expect(out).toEqual({ url: "https://qcat.quantagent.site", deployId: "dep-1" });
    const seq = stub.calls.map((c) => `${c.method} ${c.url.replace("https://api.cloudflare.com/client/v4", "")}`);
    expect(seq).toEqual([
      "GET /accounts/acct/pages/projects/quantagent-qcat",
      "POST /accounts/acct/pages/projects",
      "GET /accounts/acct/pages/projects/quantagent-qcat/upload-token",
      "POST /pages/assets/check-missing",
      "POST /pages/assets/upload",
      "POST /pages/assets/upsert-hashes",
      "POST /accounts/acct/pages/projects/quantagent-qcat/deployments",
      "POST /accounts/acct/pages/projects/quantagent-qcat/domains",
    ]);
    expect(stub.calls[0]!.headers.authorization).toBe("Bearer cf-token");
    expect(stub.calls[3]!.headers.authorization).toBe("Bearer jwt-1");
    const uploaded = JSON.parse(stub.calls[4]!.body as string) as { key: string; value: string; metadata: { contentType: string }; base64: boolean }[];
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({ metadata: { contentType: "text/html" }, base64: true });
    expect(Buffer.from(uploaded[0]!.value, "base64").toString()).toBe(HTML);
    const form = stub.calls[6]!.body as FormData;
    const manifest = JSON.parse(form.get("manifest") as string) as Record<string, string>;
    expect(Object.keys(manifest).sort()).toEqual(["/index.html", "/og.svg"]);
    expect(form.get("branch")).toBe("main");
    expect(JSON.parse(stub.calls[7]!.body as string)).toEqual({ name: "qcat.quantagent.site" });
  });
  it("returns the pages.dev url without SITE_DOMAIN and tolerates an already-attached custom domain", async () => {
    const stub = fetchStub([
      { match: /\/pages\/projects\/quantagent-qcat$/, body: { success: true, result: {} } },
      { match: "/upload-token", body: { success: true, result: { jwt: "jwt" } } },
      { match: "/check-missing", body: { success: true, result: [] } },
      { match: "/upsert-hashes", body: { success: true, result: null } },
      { match: "/deployments", body: { success: true, result: { id: "dep-2", url: "x" } } },
      { match: "/domains", status: 409, body: { success: false, errors: [{ code: 8000011, message: "already exists" }] } },
    ]);
    const client = createCloudflareHosting({ apiToken: "t", accountId: "acct", projectPrefix: "quantagent", fetch: stub.fetch });
    expect(await client.publish({ slug: "qcat", html: HTML })).toEqual({ url: "https://quantagent-qcat.pages.dev", deployId: "dep-2" });
    expect(stub.calls.some((c) => c.url.includes("/pages/assets/upload") && !c.url.includes("upload-token"))).toBe(false);
    const dom = await client.connectCustomDomain({ slug: "qcat", domain: "mycoin.xyz" });
    expect(dom.verification).toMatch(/CNAME/);
  });
  it("surfaces API errors", async () => {
    const stub = fetchStub([{ match: /\/pages\/projects\/quantagent-qcat$/, status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } }]);
    const client = createCloudflareHosting({ apiToken: "t", accountId: "acct", projectPrefix: "quantagent", fetch: stub.fetch });
    await expect(client.publish({ slug: "qcat", html: HTML })).rejects.toThrow(/403.*Authentication error/);
  });
});

describe("vercel deployments api", () => {
  it("creates a deployment with inline files, polls to READY, attaches the subdomain", async () => {
    const stub = fetchStub([
      { match: /\/v13\/deployments\/dpl_1/, body: { id: "dpl_1", url: "quantagent-qcat-abc.vercel.app", readyState: "READY" } },
      { match: "/v13/deployments", body: { id: "dpl_1", url: "quantagent-qcat-abc.vercel.app", readyState: "QUEUED" } },
      { match: "/v10/projects/quantagent-qcat/domains", body: { verified: false, verification: [{ type: "TXT", domain: "_vercel.quantagent.site", value: "vc-domain-verify=abc" }] } },
    ]);
    const client = createVercelHosting({ token: "v-token", projectPrefix: "quantagent", teamId: "team_1", siteDomain: "quantagent.site", fetch: stub.fetch, pollMs: 1 });
    const out = await client.publish({ slug: "qcat", html: HTML, assets: [{ path: "og.svg", url: OG }] });
    expect(out).toEqual({ url: "https://qcat.quantagent.site", deployId: "dpl_1" });
    expect(stub.calls[0]!.url).toBe("https://api.vercel.com/v13/deployments?teamId=team_1");
    expect(stub.calls[0]!.headers.authorization).toBe("Bearer v-token");
    const body = JSON.parse(stub.calls[0]!.body as string);
    expect(body).toMatchObject({ name: "quantagent-qcat", project: "quantagent-qcat", target: "production", projectSettings: { framework: null } });
    expect(body.files).toEqual([
      { file: "index.html", data: HTML },
      { file: "og.svg", data: Buffer.from("<svg/>").toString("base64"), encoding: "base64" },
    ]);
    expect(stub.calls[1]!.url).toContain("/v13/deployments/dpl_1");
    expect(JSON.parse(stub.calls[2]!.body as string)).toEqual({ name: "qcat.quantagent.site" });
    const dom = await client.connectCustomDomain({ slug: "qcat", domain: "mycoin.xyz" });
    expect(dom.verification).toContain("TXT _vercel.quantagent.site → vc-domain-verify=abc");
    expect(vercelProjectName("quantagent", "Q CAT")).toBe("quantagent-q-cat");
  });
  it("fails on an ERROR deployment", async () => {
    const stub = fetchStub([{ match: "/v13/deployments", body: { id: "dpl_2", url: "x", readyState: "ERROR", errorMessage: "bad files" } }]);
    const client = createVercelHosting({ token: "t", projectPrefix: "quantagent", fetch: stub.fetch });
    await expect(client.publish({ slug: "qcat", html: HTML })).rejects.toThrow(/ERROR: bad files/);
  });
});
