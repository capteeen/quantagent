/**
 * "The CA is never wrong": over the rendered launch and coin screens, every
 * base58 string of contract-address length is the deployed CA, a wallet, or
 * (coin page only) a copycat address inside the Shield's labelled copycat row.
 * Before Launcher.deployed the screens say "pending launch" and show no CA.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletProvider } from "@solana/wallet-adapter-react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuantagentEvent } from "@quantagent/core/types";
import { EventBus, rebuild } from "@quantagent/core";
import { useLaunchStore } from "@/lib/launchStore";
import { AGENT_WALLET, COPYCAT_CA, IDENTITY, LOGO, OWNER_WALLET, REAL_CA, TX, X_ACCOUNT } from "./fakes";

vi.mock("@/components/ChamberMount", () => ({ ChamberMount: (p: { mode: string }) => <div data-testid="chamber" data-mode={p.mode} /> }));

const { LaunchScreen } = await import("@/components/LaunchScreen");
const { CoinScreen } = await import("@/components/CoinScreen");

const ID = "launch_test_1";
const BASE58_CA = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

function buildLog(): { preDeploy: QuantagentEvent[]; full: QuantagentEvent[] } {
  const bus = new EventBus();
  const emit = (input: Parameters<EventBus["emit"]>[1]) => bus.emit(ID, input);
  const all: QuantagentEvent[] = [];
  bus.subscribe((e) => all.push(e), { launchId: ID });
  emit({ type: "Launch.started", reason: "user tapped launch", payload: { prompt: "a coin about cats", workers: ["Ideator", "Artist", "Builder", "Launcher", "Voice", "Trader", "Shield", "Recruiter"], ownerWallet: OWNER_WALLET, xAccountId: X_ACCOUNT, agentWallet: AGENT_WALLET, autopilot: { posts: false, trades: false, recruiting: false }, cluster: "mainnet-beta" } });
  for (const w of ["Ideator", "Artist", "Builder", "Launcher", "Voice", "Trader", "Shield", "Recruiter"] as const) emit({ type: "Worker.started", worker: w, reason: "start", payload: {} });
  emit({ type: "Ideator.named", reason: "named", payload: { identity: IDENTITY } });
  emit({ type: "Artist.logoReady", reason: "logo", payload: { asset: LOGO } });
  emit({ type: "Builder.published", reason: "site up, CA pending", payload: { url: "https://cfcat.quantagent.site", deployId: "d1", trigger: "start" } });
  emit({ type: "Shield.copycatFound", reason: "a look-alike appeared on pump.fun", payload: { copycat: { source: "pump.fun", externalId: COPYCAT_CA, url: `https://pump.fun/coin/${COPYCAT_CA}`, match: "name", score: 0.9, seenAt: new Date().toISOString() } } });
  emit({ type: "Worker.progress", worker: "Trader", reason: "waiting for the deploy", payload: { step: "waiting" } });
  const preDeploy = [...all];
  emit({ type: "Launcher.deployed", reason: "pump.fun create confirmed", payload: { coinCa: REAL_CA, txSignature: TX, identityRoot: "" } });
  emit({ type: "Launcher.devBuy", reason: "dev buy", payload: { txSignature: TX, sol: 0.1 } });
  emit({ type: "Builder.published", reason: "republished with the CA", payload: { url: "https://cfcat.quantagent.site", deployId: "d2", trigger: "Launcher.deployed" } });
  emit({ type: "Launch.live", reason: "coin deployed and site published", payload: { coinCa: REAL_CA, siteUrl: "https://cfcat.quantagent.site" } });
  emit({ type: "Voice.posted", reason: "announcement", payload: { postId: "1001", url: "https://x.com/i/web/status/1001", text: `${IDENTITY.name} is live. CA: ${REAL_CA}`, kind: "thread" } });
  emit({ type: "Trader.traded", reason: "dip buy within budget", payload: { side: "buy", sol: 0.02, txSignature: TX } });
  emit({ type: "Shield.report", reason: "scan complete", payload: { report: { canonicalCa: REAL_CA, copycats: [{ source: "pump.fun", externalId: COPYCAT_CA, url: `https://pump.fun/coin/${COPYCAT_CA}`, match: "name", score: 0.9, seenAt: new Date().toISOString() }], bundleFlags: [] } } });
  for (const w of ["Ideator", "Artist", "Builder", "Launcher", "Voice", "Trader", "Shield", "Recruiter"] as const) emit({ type: "Worker.done", worker: w, reason: "done", payload: { outputs: {} } });
  return { preDeploy, full: [...all] };
}

function seed(events: QuantagentEvent[]) {
  useLaunchStore.setState({ launches: {} });
  useLaunchStore.getState().reset(ID);
  useLaunchStore.getState().ingest(ID, events);
}

function stubFetch(events: QuantagentEvent[]) {
  const state = rebuild(events, ID);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/events")) return new Response("no stream in tests", { status: 404 });
      if (url.includes(`/api/launch/${ID}`)) {
        return new Response(JSON.stringify({ meta: { id: ID, createdAt: "", clients: {}, postLaunch: { status: "pending", detail: "test" } }, state, pendingApprovals: [], seq: events.length, events }), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/me")) return new Response(JSON.stringify({ account: { accountId: X_ACCOUNT, handle: "cfcat" }, launches: [], wallets: [], pendingApprovals: [] }), { headers: { "content-type": "application/json" } });
      if (url.includes("/api/status")) return new Response(JSON.stringify({ cluster: "mainnet-beta", cost: { cluster: "mainnet-beta", launchSol: 0.0305, devBuySol: 0.1, agentBudgetSol: 0.1, youPaySol: 0.2305, notes: [] } }), { headers: { "content-type": "application/json" } });
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }),
  );
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <WalletProvider wallets={[]} autoConnect={false}>
        {ui}
      </WalletProvider>
    </QueryClientProvider>
  );
}

/**
 * Every base58 run of CA length in the page's text nodes, hrefs and titles — except the
 * Shield's labelled copycat references (LogRow "copycat:<id>" refs and ShieldReport copycat rows),
 * which are the one place a foreign address may appear, and transaction signatures.
 */
function addressesIn(root: HTMLElement): string[] {
  const scope = root.cloneNode(true) as HTMLElement;
  for (const row of scope.querySelectorAll("[data-testid=copycat]")) row.remove();
  for (const a of scope.querySelectorAll("a")) if ((a.textContent ?? "").startsWith("copycat:")) a.remove();
  const found = new Set<string>();
  const walker = scope.ownerDocument.createTreeWalker(scope, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) for (const m of (n.textContent ?? "").matchAll(BASE58_CA)) found.add(m[0]);
  for (const el of scope.querySelectorAll("[href],[title]")) {
    for (const attr of ["href", "title"]) {
      const v = el.getAttribute(attr) ?? "";
      for (const m of v.matchAll(BASE58_CA)) found.add(m[0]);
    }
  }
  return [...found].filter((s) => s !== TX && !TX.includes(s));
}

const ALLOWED = new Set([REAL_CA, AGENT_WALLET, OWNER_WALLET]);

describe("the CA is never wrong", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("launch screen before the deploy: pending launch, no contract address anywhere", async () => {
    const { preDeploy } = buildLog();
    seed(preDeploy);
    stubFetch(preDeploy);
    const r = render(wrap(<LaunchScreen launchId={ID} accountId={X_ACCOUNT} logOpen />));
    expect(await screen.findByTestId("thread-strip")).toBeTruthy();
    expect(r.container.textContent).not.toContain(REAL_CA);
    expect(screen.getByText(/pending launch/i)).toBeTruthy();
    const addrs = addressesIn(r.container);
    for (const a of addrs) expect(ALLOWED.has(a) && a !== REAL_CA, `unexpected address on screen: ${a}`).toBe(true);
    // the copycat the Shield flagged is visible only as a labelled copycat reference
    const copycatRefs = [...r.container.querySelectorAll("a")].filter((a) => (a.textContent ?? "").startsWith("copycat:"));
    expect(copycatRefs.length).toBe(1);
    expect(screen.queryByTestId("coin-card")).toBeNull();
  });

  it("launch screen after the deploy: only the deployed CA appears, in the CoinCard", async () => {
    const { full } = buildLog();
    seed(full);
    stubFetch(full);
    const r = render(wrap(<LaunchScreen launchId={ID} accountId={X_ACCOUNT} logOpen />));
    const card = await screen.findByTestId("coin-card");
    expect(card.getAttribute("data-state")).toBe("live");
    expect(within(card).getByTestId("coin-ca").querySelector("a")?.getAttribute("href")).toBe(`https://pump.fun/coin/${REAL_CA}`);
    const addrs = addressesIn(r.container);
    expect(addrs).toContain(REAL_CA);
    for (const a of addrs) expect(ALLOWED.has(a), `unexpected address on screen: ${a}`).toBe(true);
  });

  it("coin page: the deployed CA everywhere; a copycat address only inside the Shield's copycat row", async () => {
    const { full } = buildLog();
    seed(full);
    stubFetch(full);
    const r = render(wrap(<CoinScreen launchId={ID} ca={REAL_CA} />));
    const card = await screen.findByTestId("coin-card");
    expect(card.getAttribute("data-state")).toBe("live");
    expect(screen.getByTestId("voice-feed").textContent).toContain(REAL_CA);
    const copycatRows = r.container.querySelectorAll("[data-testid=copycat]");
    expect(copycatRows.length).toBe(1);
    expect(copycatRows[0]!.textContent).toContain(COPYCAT_CA);
    const addrs = addressesIn(r.container);
    expect(addrs).toContain(REAL_CA);
    for (const a of addrs) expect(ALLOWED.has(a), `unexpected address outside a labelled copycat reference: ${a}`).toBe(true);
  });

  it("coin page refuses to render a launch under a different address", async () => {
    const { full } = buildLog();
    seed(full);
    stubFetch(full);
    render(wrap(<CoinScreen launchId={ID} ca={COPYCAT_CA} />));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("different contract address");
    expect(screen.queryByTestId("coin-card")).toBeNull();
  });
});
