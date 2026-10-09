/**
 * §9 check 6: the CA handshake. On a simulated launch (fake solana.deployPumpFun resolves
 * with a known CA) the Builder republishes with the CA, the Voice posts the CA
 * (autopilot.posts on) and the Shield registers it as canonical, each within 5s of
 * Launcher.deployed (asserted < 1s in-process). Then every rendered surface is grepped
 * for any base58 string of address length that is not the deployed CA, the agent
 * wallet, the owner wallet or a known tx signature. Zero tolerance.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rebuild } from "@quantagent/core";
import type { QuantagentEvent } from "@quantagent/core/types";
import { CA, AGENT_WALLET, OWNER_WALLET, DEPLOY_TX } from "./helpers/fakes";
import { simulate, type Sim } from "./helpers/launch";
import { addressLikeTokens } from "./helpers/scan";

let sim: Sim;

beforeAll(async () => {
  sim = await simulate({ autopilot: { posts: true }, solana: { deployDelayMs: 25 } });
  const outcome = await sim.settledOrTimeout(25_000);
  expect(outcome, "the simulated launch must settle").toBe("settled");
});

afterAll(async () => {
  await sim?.stop();
});

function deployedEvent() {
  const deployed = sim.ofType("Launcher.deployed");
  expect(deployed, "exactly one Launcher.deployed").toHaveLength(1);
  return deployed[0]!;
}

function msAfterDeployed(e: QuantagentEvent): number {
  const d = deployedEvent();
  return sim.deliveredAt.get(e.id)! - sim.deliveredAt.get(d.id)!;
}

describe("CA handshake timing (SPEC §3 THE CA HANDSHAKE, §9)", () => {
  it("the launch went live with the deployed CA and the site url", () => {
    const state = sim.handle.getState();
    expect(state.status).toBe("live");
    expect(state.coinCa).toBe(CA);
    expect(state.siteUrl).toMatch(/^https:\/\/frost\.quantagent\.site/);
    expect(deployedEvent().payload.coinCa).toBe(CA);
  });

  it("Builder republishes with the CA on the page within 1s of Launcher.deployed", () => {
    const d = deployedEvent();
    const published = sim.ofType("Builder.published").filter((e) => e.seq > d.seq && e.payload.trigger.split("+").includes("Launcher.deployed"));
    expect(published.length, "a Builder.published triggered by Launcher.deployed").toBeGreaterThanOrEqual(1);
    const first = published[0]!;
    const dt = msAfterDeployed(first);
    expect(dt).toBeLessThan(1000);
    expect(dt).toBeLessThan(5000);
    // The html that went to the host carries the CA, the pump.fun buy link and the live indicator.
    const html = sim.fakes.hosting.publishes.at(-1)!.html;
    expect(html).toContain(`<code>${CA}</code>`);
    expect(html).toContain(`https://pump.fun/coin/${CA}`);
    expect(html).not.toContain("CA: pending launch");
    expect(html).toContain('class="dot live"');
  });

  it("the site said 'CA: pending launch' before the deploy and never any other address", () => {
    const d = deployedEvent();
    const before = sim.fakes.hosting.publishes.slice(0, -1);
    expect(before.length).toBeGreaterThanOrEqual(1);
    const prePublishes = sim.ofType("Builder.published").filter((e) => e.seq < d.seq);
    expect(prePublishes.length).toBeGreaterThanOrEqual(1);
    for (const p of before.slice(0, prePublishes.length)) {
      expect(p.html).toContain("CA: pending launch");
      expect(addressLikeTokens(p.html)).toEqual([]);
    }
  });

  it("Voice posts the CA (kind 'ca') within 1s of Launcher.deployed, from the connected account", () => {
    const caPosts = sim.ofType("Voice.posted").filter((e) => e.payload.kind === "ca");
    expect(caPosts).toHaveLength(1);
    const post = caPosts[0]!;
    expect(post.payload.text).toContain(`CA: ${CA}`);
    expect(post.payload.text).toContain(`https://pump.fun/coin/${CA}`);
    const dt = msAfterDeployed(post);
    expect(dt).toBeLessThan(1000);
    expect(dt).toBeLessThan(5000);
    // The provider saw exactly that text, and only through the connected account's client.
    expect(sim.fakes.x.posts.map((p) => p.text)).toContain(post.payload.text);
    expect(sim.fakes.x.accountId).toBe(sim.handle.getState().xAccountId);
  });

  it("Shield registers the canonical CA within 1s of Launcher.deployed", () => {
    const reg = sim.ofType("Shield.canonicalRegistered");
    expect(reg).toHaveLength(1);
    expect(reg[0]!.payload.coinCa).toBe(CA);
    const dt = msAfterDeployed(reg[0]!);
    expect(dt).toBeLessThan(1000);
    const reports = sim.ofType("Shield.report");
    expect(reports.at(-1)!.payload.report.canonicalCa).toBe(CA);
  });

  it("all three reactions happen independently (none waits on another)", () => {
    const d = deployedEvent();
    const after = (type: QuantagentEvent["type"]) => sim.events.find((e) => e.type === type && e.seq > d.seq)!;
    const built = sim.ofType("Builder.published").find((e) => e.seq > d.seq)!;
    const posted = sim.ofType("Voice.posted").find((e) => e.seq > d.seq && e.payload.kind === "ca")!;
    const shield = after("Shield.canonicalRegistered");
    // The Shield reacts synchronously on the deploy tick; the other two are async provider calls.
    expect(shield.seq).toBeGreaterThan(d.seq);
    expect(shield.seq).toBeLessThan(Math.min(built.seq, posted.seq));
    expect(msAfterDeployed(shield)).toBeLessThan(50);
  });
});

describe("THE CA IS NEVER WRONG: zero tolerance grep of every rendered surface", () => {
  const allowed = () => new Set([CA, AGENT_WALLET, OWNER_WALLET, DEPLOY_TX]);

  function foreign(text: string): string[] {
    const ok = allowed();
    return addressLikeTokens(text).filter((t) => !ok.has(t));
  }

  it("every Builder html the host received", () => {
    expect(sim.fakes.hosting.publishes.length).toBeGreaterThan(1);
    for (const p of sim.fakes.hosting.publishes) expect(foreign(p.html), `publish ${p.slug}`).toEqual([]);
    // The final page shows the CA exactly where the template puts it.
    const final = sim.fakes.hosting.publishes.at(-1)!.html;
    expect(final.match(new RegExp(CA, "g"))!.length).toBeGreaterThanOrEqual(2);
  });

  it("every text the Voice sent to X", () => {
    const texts = sim.fakes.x.allTexts();
    expect(texts.length).toBeGreaterThanOrEqual(4); // 3 thread posts + CA post
    for (const t of texts) expect(foreign(t), t).toEqual([]);
    // The thread carries either the pending line or the real CA, never a placeholder address.
    const thread = sim.fakes.x.threads[0]!;
    const text = thread.posts.map((p) => p.text).join("\n");
    expect(text.includes("CA: pending launch") || text.includes(`CA: ${CA}`)).toBe(true);
  });

  it("the Voice links to the site url the launch reports (the ticker slug), not a stale t0 slug", () => {
    // Defect if this fails: the Voice pins the FIRST Builder.published url (q-<launchId>) and never
    // follows the Builder's move to <ticker>.quantagent.site, so the announcement thread and the CA
    // post link to a page that is frozen at "name undetermined / CA: pending launch".
    const siteUrl = sim.handle.getState().siteUrl!;
    const thread = sim.fakes.x.threads[0]!.posts.map((p) => p.text).join("\n");
    const caPost = sim.ofType("Voice.posted").find((e) => e.payload.kind === "ca")!.payload.text;
    expect(thread, "announcement thread links the final site url").toContain(siteUrl);
    expect(caPost, "CA post links the final site url").toContain(siteUrl);
    // And the stale slug must not be what users are sent to.
    const stale = sim.fakes.hosting.publishes.find((p) => p.slug.startsWith("q-"));
    if (stale) {
      const staleUrl = `https://${stale.slug}.quantagent.site`;
      expect(thread).not.toContain(staleUrl);
      expect(caPost).not.toContain(staleUrl);
    }
  });

  it("every Voice.posted / Voice.postFailed payload", () => {
    for (const e of sim.ofType("Voice.posted")) expect(foreign(e.payload.text)).toEqual([]);
    expect(sim.ofType("Voice.postFailed")).toEqual([]);
  });

  it("every Shield report", () => {
    for (const e of sim.ofType("Shield.report")) expect(foreign(JSON.stringify(e.payload.report))).toEqual([]);
  });

  it("the rebuilt Launch state JSON", async () => {
    const log = await sim.log();
    const json = JSON.stringify(rebuild(log));
    expect(foreign(json)).toEqual([]);
    expect(json).toContain(CA);
  });

  it("the whole event log (every reason and payload)", async () => {
    const log = await sim.log();
    for (const e of log) expect(foreign(JSON.stringify(e)), `${e.type} #${e.seq}`).toEqual([]);
  });
});

describe("F3 re-verification: the Builder's named republish fails — does the Voice still link a page that exists?", () => {
  /** urls the host actually served, and the last html it holds for each. */
  function served(s: Sim): Map<string, string> {
    const m = new Map<string, string>();
    for (const p of s.fakes.hosting.publishes) m.set(`https://${p.slug}.quantagent.site`, p.html);
    return m;
  }

  describe("one transient failure: the first <ticker> publish 502s, later triggers republish, then the deploy", () => {
    let s: Sim;
    beforeAll(async () => {
      s = await simulate({
        autopilot: { posts: true },
        hosting: { failFor: (input, attempt) => (attempt === 2 && !input.slug.startsWith("q-") ? new Error("edge 502") : undefined) },
        solana: { deployDelayMs: 25 },
      });
      expect(await s.settledOrTimeout(25_000)).toBe("settled");
    });
    afterAll(async () => {
      await s?.stop();
    });

    it("the failed attempt was the Ideator.named republish (Builder.patchFailed), and the launch still went live", () => {
      const failed = s.ofType("Builder.patchFailed");
      expect(failed).toHaveLength(1);
      expect(failed[0]!.payload.trigger.split("+")).toContain("Ideator.named");
      expect(s.handle.getState().status).toBe("live");
    });

    it("every url the Voice posted was served by the host, and the page behind the CA post carries the CA", () => {
      const pages = served(s);
      const caPost = s.ofType("Voice.posted").find((e) => e.payload.kind === "ca")!.payload.text;
      const thread = s.fakes.x.threads[0]!.posts.map((p) => p.text).join("\n");
      const linked = [...new Set([...caPost.matchAll(/https:\/\/[a-z0-9-]+\.quantagent\.site/g), ...thread.matchAll(/https:\/\/[a-z0-9-]+\.quantagent\.site/g)].map((m) => m[0]))];
      expect(linked.length).toBeGreaterThanOrEqual(1);
      for (const url of linked) expect(pages.has(url), `${url} was served`).toBe(true);
      const caUrl = caPost.match(/https:\/\/[a-z0-9-]+\.quantagent\.site/)![0];
      expect(pages.get(caUrl)).toContain(`<code>${CA}</code>`);
      expect(caUrl).toBe(s.handle.getState().siteUrl);
    });
  });

  describe("permanent failure: the host refuses the <ticker> slug on every attempt (slug taken), the coin deploys anyway", () => {
    let s: Sim;
    beforeAll(async () => {
      s = await simulate({
        autopilot: { posts: true },
        hosting: { failFor: (input) => (input.slug.startsWith("q-") ? undefined : new Error(`slug ${input.slug} is already taken on the host`)) },
        solana: { deployDelayMs: 25 },
      });
      expect(await s.settledOrTimeout(25_000)).toBe("settled");
    });
    afterAll(async () => {
      await s?.stop();
    });

    it("the launch settles; the coin deployed; only the q-<launchId> page was ever served", () => {
      expect(s.handle.getState().coinCa).toBe(CA);
      expect(s.fakes.hosting.publishes.every((p) => p.slug.startsWith("q-"))).toBe(true);
      // The ticker slug is refused once; the Builder then falls back to the served slug for good.
      expect(s.ofType("Builder.patchFailed").length).toBeGreaterThanOrEqual(1);
      expect(s.ofType("Builder.published").every((e) => e.payload.url.startsWith("https://q-"))).toBe(true);
    });

    it("the Voice links only pages that exist (the q-<launchId> page)", () => {
      const pages = served(s);
      const caPost = s.ofType("Voice.posted").find((e) => e.payload.kind === "ca")!.payload.text;
      const caUrl = caPost.match(/https:\/\/[a-z0-9-]+\.quantagent\.site/)![0];
      expect(pages.has(caUrl), `${caUrl} was served`).toBe(true);
      expect(caPost).toContain(`CA: ${CA}`);
    });

    it("FINDING if this fails: the page the CA post links must carry the CA (the Builder must fall back to a slug the host accepts)", () => {
      // Was finding F6: the Builder moved to the ticker slug before the host accepted it and never fell
      // back. It now falls back to the last served slug, so the CA reaches the page the Voice links.
      const pages = served(s);
      const caPost = s.ofType("Voice.posted").find((e) => e.payload.kind === "ca")!.payload.text;
      const caUrl = caPost.match(/https:\/\/[a-z0-9-]+\.quantagent\.site/)![0];
      expect(pages.get(caUrl)).toContain(`<code>${CA}</code>`);
      expect(pages.get(caUrl)).not.toContain("CA: pending launch");
    });

    it("FINDING if this fails: a launch whose site never received the CA must not report Launch.live with that site url", () => {
      const state = s.handle.getState();
      const pages = served(s);
      const live = s.ofType("Launch.live");
      if (live.length) {
        const html = pages.get(live[0]!.payload.siteUrl);
        expect(html, "Launch.live.siteUrl was served").toBeTruthy();
        expect(html, "Launch.live.siteUrl carries the CA").toContain(`<code>${CA}</code>`);
      } else {
        expect(state.status).toBe("partial");
      }
    });
  });
});
