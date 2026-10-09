/**
 * Test-only fakes injected into the service: eight scripted workers that run
 * through the REAL core runtime (bus, gate, collapse protocol), fake clients,
 * and a SharedClients bundle. Nothing here is reachable from the app itself.
 */
import { EventBus, type Worker, type WorkerContext } from "@quantagent/core";
import { NotImplemented, type Identity, type ImageAsset, type QuantagentEvent, type ShieldReport } from "@quantagent/core/types";
import type { LlmClient, SolanaClient, XClient, XPost } from "@quantagent/core/types/clients";
import { MemoryKeyStore, WebhookHub } from "@quantagent/solana";
import type { XRuntime } from "@quantagent/x";
import type { SharedClients } from "@/server/clients";
import type { Unavailable } from "@/server/types";
import { OrchestratorService, type ServiceDeps } from "@/server/service";
import type { Env } from "@/server/types";

export const REAL_CA = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
export const COPYCAT_CA = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
export const AGENT_WALLET = "AgentWa11etPubKey1111111111111111111111111";
export const OWNER_WALLET = "OwnerWa11etPubKey111111111111111111111111111";
export const X_ACCOUNT = "123456789";
export const TX = "5Kd3NbUiPZrP1S3n7tD5oZtFYv4t4yxFbeXm4qmvN5CcjZk6gEoMZw4GpNhG2mwpcP1Ck7EstHsUGx5mdQxyV1Zz";

export const IDENTITY: Identity = { name: "Cold Fusion Cat", ticker: "CFCAT", lore: "a cat that lives in a cryostat", hook: "absolute zero chill", trend: "cats" };

export const LOGO: ImageAsset = { url: "https://cdn.example.test/logo.png", kind: "logo", width: 1024, height: 1024, externalId: "img_1" };

export function unavailable(capability: string, because: string, needs: string[]): Unavailable {
  const e = new NotImplemented(capability, because, needs);
  return { ok: false, name: e.name, message: e.message, capability, because, needs };
}

export function fakeLlm(): LlmClient {
  return {
    async complete(input) {
      const text = JSON.stringify({ candidates: [] });
      return { text, json: input.schema ? { candidates: [] } : undefined, tokensUsed: 10 };
    },
  };
}

export function fakeSolana(launchId: string): SolanaClient {
  return {
    cluster: "mainnet-beta",
    agentWallet: AGENT_WALLET,
    async qsdLaunch() {
      throw new NotImplemented("QSD protocol", "qsd-market is not linked in this workspace", []);
    },
    async deployPumpFun() {
      return { coinCa: REAL_CA, txSignature: TX, devBuySignature: TX };
    },
    async buy() {
      return { txSignature: TX };
    },
    async sell() {
      return { txSignature: TX };
    },
    async claimCreatorFees() {
      return { txSignature: TX, sol: 0 };
    },
    async isNameTaken() {
      return { name: false, ticker: false };
    },
    async findLogoMatches() {
      return [];
    },
    async findNameMatches() {
      return [];
    },
    async watchAnomalies() {
      return () => undefined;
    },
    async watchMilestones() {
      return () => undefined;
    },
    async registerWithQsd() {
      void launchId;
    },
    async balanceSol() {
      return 1;
    },
  };
}

export function fakeXClient(accountId: string): XClient {
  const post = (text: string, id = "1"): XPost => ({ id, url: `https://x.com/i/web/status/${id}`, text, authorId: accountId, createdAt: new Date().toISOString() });
  return {
    accountId,
    async post(input) {
      return post(input.text, "1001");
    },
    async thread(input) {
      return input.posts.map((p, i) => post(p.text, String(2000 + i)));
    },
    async uploadMedia() {
      return { mediaId: "m1" };
    },
    async mentions() {
      return [];
    },
    async search() {
      return [];
    },
    async trends() {
      return [{ name: "cats" }];
    },
    async users() {
      return [];
    },
    async updateProfile() {},
    async budget() {
      return { used: 1, limit: 1500, resetsAt: "2026-11-01T00:00:00.000Z", paused: false };
    },
  };
}

export function fakeXRuntime(connected: string[]): XRuntime {
  const accounts = connected.map((accountId) => ({ accountId, handle: `handle_${accountId}`, expiresAt: "2027-01-01T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" }));
  const runtime = {
    oauthConfig: { clientId: "client-id-test", redirectUri: "http://localhost/api/x/oauth/callback" },
    store: {
      async get(id: string) {
        return connected.includes(id) ? { accountId: id, accessToken: "t", expiresAt: "2027-01-01T00:00:00.000Z", scopes: [], updatedAt: "" } : null;
      },
      async list() {
        return accounts;
      },
      async put() {},
      async delete() {},
    },
    oauth: {
      start: () => ({ url: "https://x.com/i/oauth2/authorize?state=abc", state: "abc" }),
      async complete({ state }: { code: string; state: string }) {
        if (state !== "abc") throw new Error("x.oauth: unknown or expired state; start the authorization again");
        return { accountId: X_ACCOUNT, handle: "handle_x", accessToken: "t", expiresAt: "", scopes: [], updatedAt: "" };
      },
      async disconnect() {},
    },
    client: (accountId: string) => fakeXClient(accountId),
    async status() {
      return {
        budget: { used: 1, limit: 1500, resetsAt: "2026-11-01T00:00:00.000Z", paused: false, percent: 0 },
        rateLimit: { global: { available: 300, capacity: 300 }, accounts: {} },
        deadLetters: { count: 0, failed: 0, items: [] },
        accounts,
      };
    },
  };
  return runtime as unknown as XRuntime;
}

export function fakeShared(opts: { xConnected?: string[]; llm?: boolean } = {}): SharedClients {
  return {
    llm: opts.llm === false ? { ok: false, error: unavailable("LlmClient", "LLM_PROVIDER is not set", ["LLM_PROVIDER=anthropic|openai"]) } : { ok: true, value: fakeLlm() },
    image: { ok: false, error: unavailable("Artist.image", "IMAGE_PROVIDER is not set", ["IMAGE_PROVIDER=openai|fal|replicate", "OPENAI_API_KEY", "FAL_KEY", "REPLICATE_API_TOKEN"]) },
    hosting: { ok: false, error: unavailable("Builder.hosting", "HOSTING_PROVIDER is not set", ["HOSTING_PROVIDER=cloudflare|vercel"]) },
    quantum: { ok: false, error: unavailable("quantum draw", "ANU_QRNG_API_KEY not set", ["ANU_QRNG_API_KEY"]) },
    x: { ok: true, value: fakeXRuntime(opts.xConnected ?? [X_ACCOUNT]) },
    wallets: { kind: "memory", keyStore: new MemoryKeyStore() },
    hub: new WebhookHub(),
    webhook: { ok: false, error: unavailable("Helius webhook", "Helius webhooks are not configured", ["HELIUS_API_KEY", "HELIUS_WEBHOOK_URL", "HELIUS_WEBHOOK_SECRET"]) },
    store: { events: "memory", stream: "memory", tokens: "memory" },
  };
}

/* ───────────────────────── scripted workers ───────────────────────── */

const noop: Worker["on"] = () => undefined;

/** Eight workers exercising the real gate (Voice), the real collapse protocol (Recruiter) and the live handshake. */
export function scriptedWorkers(): Worker[] {
  const ideator: Worker = {
    name: "Ideator",
    start(ctx) {
      ctx.progress("naming", "trend read, five candidates drafted");
      ctx.emit({ type: "Ideator.named", reason: "named from the prompt", payload: { identity: IDENTITY } });
      return { identity: IDENTITY };
    },
    on: noop,
    stop() {},
  };
  const artist: Worker = {
    name: "Artist",
    start(ctx) {
      ctx.emit({ type: "Artist.logoReady", reason: "logo rendered", payload: { asset: LOGO } });
      return { logo: LOGO.url };
    },
    on: noop,
    stop() {},
  };
  const builder: Worker = {
    name: "Builder",
    async start(ctx) {
      ctx.emit({ type: "Builder.published", reason: "site published with CA pending", payload: { url: "https://cfcat.quantagent.site", deployId: "d1", trigger: "start" } });
      await ctx.waitFor("Launcher.deployed", { timeoutMs: 5000 });
      ctx.emit({ type: "Builder.published", reason: "site republished with the contract address", payload: { url: "https://cfcat.quantagent.site", deployId: "d2", trigger: "Launcher.deployed" } });
      return { url: "https://cfcat.quantagent.site" };
    },
    on: noop,
    stop() {},
  };
  const launcher: Worker = {
    name: "Launcher",
    async start(ctx) {
      // waitFor is future-only (dependencies are subscriptions); the identity is already fixed in this script,
      // so yield one tick for the later workers to subscribe to Launcher.deployed, then deploy.
      await new Promise((r) => setTimeout(r, 20));
      ctx.progress("qsd-skipped", "QSD protocol not linked; launching on pump.fun without the cryptographic sequence");
      const solana = ctx.clients.solana;
      if (!solana) throw new NotImplemented("Launcher.deploy", "no solana client", ["SOLANA_RPC_URL", "AGENT_WALLET_KEY"]);
      const r = await solana.deployPumpFun({ identity: IDENTITY, logoUrl: LOGO.url, siteUrl: "https://cfcat.quantagent.site", devBuySol: ctx.options.devBuySol });
      ctx.emit({ type: "Launcher.deployed", reason: "pump.fun create confirmed", payload: { coinCa: r.coinCa, txSignature: r.txSignature, identityRoot: "" } });
      ctx.emit({ type: "Launcher.devBuy", reason: "dev buy folded into create", payload: { txSignature: r.devBuySignature, sol: ctx.options.devBuySol } });
      return { coinCa: r.coinCa };
    },
    on: noop,
    stop() {},
  };
  const voice: Worker = {
    name: "Voice",
    async start(ctx: WorkerContext) {
      await ctx.waitFor("Launcher.deployed", { timeoutMs: 5000 });
      const outcome = await ctx.requireApproval({ actionClass: "posts", title: "Post the announcement thread", draft: { text: `${IDENTITY.name} is live. CA: ${REAL_CA}` }, reason: "first post from the project's account" });
      const text = String(outcome.draft["text"]);
      ctx.emit({ type: "Voice.posted", reason: "announcement posted after approval", payload: { postId: "1001", url: "https://x.com/i/web/status/1001", text, kind: "thread" } });
      return { posted: 1 };
    },
    on: noop,
    stop() {},
  };
  const trader: Worker = {
    name: "Trader",
    async start(ctx) {
      const d = await ctx.waitFor("Launcher.deployed", { timeoutMs: 5000 });
      ctx.progress("deployed.observed", `bound to ${d.payload.coinCa}; the Trader will never trade any other coin`);
      return { coinCa: d.payload.coinCa };
    },
    on: noop,
    stop() {},
  };
  const shield: Worker = {
    name: "Shield",
    async start(ctx) {
      const d = await ctx.waitFor("Launcher.deployed", { timeoutMs: 5000 });
      const report: ShieldReport = { canonicalCa: d.payload.coinCa, copycats: [], bundleFlags: [] };
      ctx.emit({ type: "Shield.report", reason: "first scan clear", payload: { report } });
      return { copycats: 0 };
    },
    on: noop,
    stop() {},
  };
  const recruiter: Worker = {
    name: "Recruiter",
    async start(ctx) {
      const { chosen } = await ctx.collapse(
        [
          { id: "a", value: "angle-a", reason: "first angle", label: "A" },
          { id: "b", value: "angle-b", reason: "second angle", label: "B" },
        ],
        "two outreach angles",
      );
      return { angle: chosen.id };
    },
    on: noop,
    stop() {},
  };
  return [ideator, artist, builder, launcher, voice, trader, shield, recruiter];
}

export function makeService(overrides: Partial<ServiceDeps> = {}): OrchestratorService {
  const env: Env = { SESSION_SECRET: "test-secret", NODE_ENV: "test" };
  return new OrchestratorService({
    env,
    bus: new EventBus(),
    shared: fakeShared(),
    createWorkers: scriptedWorkers,
    createSolana: async ({ launchId }) => fakeSolana(launchId),
    startPostLaunch: null,
    ...overrides,
  });
}

/** The bus's waitFor is future-only; tests want "has happened or happens within timeoutMs". */
export async function seen<T extends QuantagentEvent["type"]>(svc: OrchestratorService, launchId: string, type: T, timeoutMs = 5000): Promise<Extract<QuantagentEvent, { type: T }>> {
  const waiting = svc.eventBus.waitFor(launchId, type, { timeoutMs }).catch((err: unknown) => err);
  const past = (await svc.eventBus.log(launchId)).find((e) => e.type === type);
  if (past) {
    void waiting;
    return past as Extract<QuantagentEvent, { type: T }>;
  }
  const result = await waiting;
  if (result instanceof Error) throw result;
  return result as Extract<QuantagentEvent, { type: T }>;
}
