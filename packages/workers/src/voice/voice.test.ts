import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@quantagent/core/types";
import type { XPost } from "@quantagent/core/types/clients";
import { FAKE_CA, fakeLlm, fakePost, fakeX, harness, type Harness } from "../testing/fakes";
import { MemoryPostedTextStore, normalizeText } from "./dedup";
import { CA_PENDING_LINE, buildCaPost, buildThreadDraft, finalizeCaText, pumpFunUrl } from "./drafts";
import { VoiceWorker } from "./voice";

const identity = { name: "Schrodinger Cat", ticker: "SCAT", lore: "A cat in a box, both alive and dead, runs a quantum lab.", hook: "the only cat that is already everywhere", trend: "quantum" };
const SITE = "https://scat.quantagent.site";
const OTHER_CA = "AnotherCA" + "1".repeat(34);

function image(n: number): ImageAsset {
  return { url: `https://img/${n}.png`, kind: "character", width: 1024, height: 1024, externalId: `gen-${n}` };
}

function recordingX() {
  const posts: { text: string; mediaIds?: string[]; replyTo?: string }[] = [];
  const threads: { text: string; mediaIds?: string[] }[][] = [];
  const uploads: string[] = [];
  const profile: { avatarUrl?: string; bannerUrl?: string }[] = [];
  let mentionsNext: XPost[] = [];
  let n = 0;
  const x = fakeX({
    async post(input) {
      posts.push(input);
      return fakePost({ id: `post-${++n}`, url: `https://x.com/i/status/post-${n}`, text: input.text, authorId: "x-account-1" });
    },
    async thread(input) {
      threads.push(input.posts);
      return input.posts.map((p) => fakePost({ id: `t-${++n}`, url: `https://x.com/i/status/t-${n}`, text: p.text, authorId: "x-account-1" }));
    },
    async uploadMedia({ url }) {
      uploads.push(url);
      return { mediaId: `media-${uploads.length}` };
    },
    async updateProfile(input) {
      profile.push(input);
    },
    async mentions() {
      const out = mentionsNext;
      mentionsNext = [];
      return out;
    },
  });
  return { x, posts, threads, uploads, profile, setMentions: (m: XPost[]) => (mentionsNext = m) };
}

function feedLaunchInputs(h: Harness, images = 2): void {
  h.emit({ type: "Ideator.named", reason: "test", payload: { identity } });
  h.emit({ type: "Builder.published", reason: "test", payload: { url: SITE, deployId: "d1", trigger: "t0" } });
  for (let i = 1; i <= images; i++) h.emit({ type: "Artist.imageReady", reason: "test", payload: { asset: image(i) } });
}

function deploy(h: Harness): void {
  h.emit({ type: "Launcher.deployed", reason: "test", payload: { coinCa: FAKE_CA, txSignature: "deploy-sig", identityRoot: "root" } });
}

/** Runs the whole launch on autopilot.posts and returns the harness once done. */
async function launched(w = recordingX(), store = new MemoryPostedTextStore()) {
  const h = harness(new VoiceWorker({ store }), { clients: { x: w.x }, autopilot: { posts: true } });
  const started = h.start();
  await h.waitFor("Worker.progress");
  feedLaunchInputs(h);
  await h.waitFor("Voice.posted", { predicate: (e) => e.payload.kind === "thread" });
  deploy(h);
  expect(await started).toBe("done");
  h.emit({ type: "Launch.live", reason: "test", payload: { coinCa: FAKE_CA, siteUrl: SITE } });
  await h.settle();
  return { h, w, store };
}

describe("drafts", () => {
  it("thread carries hook, lore, site link and the pending CA line until deployed", () => {
    const t = buildThreadDraft({ identity, siteUrl: SITE, images: [image(1), image(2)] });
    expect(t.posts).toHaveLength(3);
    expect(t.posts[0]!.text).toContain(identity.hook);
    expect(t.posts[0]!.imageUrls).toEqual([image(1).url]);
    expect(t.posts[1]!.text).toContain("both alive and dead");
    expect(t.posts[2]!.text).toContain(SITE);
    expect(t.posts[2]!.text).toContain(CA_PENDING_LINE);
    expect(t.posts.every((p) => p.text.length <= 280)).toBe(true);
  });

  it("finalizeCaText always ends up with the real CA and the pump.fun link, never another address", () => {
    const pending = buildCaPost({ identity, siteUrl: SITE });
    expect(pending.text).toContain(CA_PENDING_LINE);
    const final = finalizeCaText(pending.text, FAKE_CA);
    expect(final).toContain(`CA: ${FAKE_CA}`);
    expect(final).toContain(pumpFunUrl(FAKE_CA));
    expect(final).not.toContain(CA_PENDING_LINE);
    expect(final).toContain("is live.");
    // a user edit that dropped the line still gets the CA
    expect(finalizeCaText("gm, we are live", FAKE_CA)).toContain(FAKE_CA);
    // an over-long edit keeps the essentials
    const long = finalizeCaText("x".repeat(300), FAKE_CA);
    expect(long.length).toBeLessThanOrEqual(280);
    expect(long).toContain(FAKE_CA);
    expect(long).toContain(pumpFunUrl(FAKE_CA));
  });

  it("dedup store is whitespace-insensitive", () => {
    const s = new MemoryPostedTextStore();
    s.add("gm   frens\n");
    expect(s.has("gm frens")).toBe(true);
    expect(normalizeText(" a  b ")).toBe("a b");
  });
});

describe("VoiceWorker", () => {
  it("posts only through the X client: no other posting path in src/voice", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, `${f} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(src, `${f} must not talk to X directly`).not.toMatch(/api\.(x|twitter)\.com|twitter-api|XMLHttpRequest|node:http/);
    }
  });

  it("fails with NotImplemented naming the X env vars when no x client is wired", async () => {
    const h = harness(new VoiceWorker(), { clients: {} });
    expect(await h.start()).toBe("failed");
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/NotImplemented.*X_CLIENT_ID.*X_CLIENT_SECRET/);
    await h.stop();
  });

  it("pre-drafts the thread and the CA post so each approval is one tap, and finalizes the CA on deploy", async () => {
    const w = recordingX();
    const h = harness(new VoiceWorker(), { clients: { x: w.x } });
    const started = h.start();
    await h.waitFor("Worker.progress", { predicate: (e) => e.payload.step === "wait.inputs" });
    feedLaunchInputs(h);

    const threadCard = await h.waitFor("Worker.awaitingApproval");
    const threadDraft = threadCard.payload.approval.draft as { kind: string; posts: { text: string; imageUrls: string[] }[] };
    expect(threadCard.payload.approval.actionClass).toBe("posts");
    expect(threadDraft.kind).toBe("thread");
    expect(threadDraft.posts).toHaveLength(3);
    expect(threadDraft.posts[0]!.text).toContain(identity.hook);
    expect(threadDraft.posts[0]!.imageUrls).toEqual([image(1).url]);
    expect(threadDraft.posts[2]!.text).toContain(SITE);
    expect(threadDraft.posts[2]!.text).toContain(CA_PENDING_LINE);
    expect(w.threads).toHaveLength(0);
    h.gate.resolve(threadCard.payload.approval.id, "approve");

    const posted = await h.waitFor("Voice.posted");
    expect(posted.payload.kind).toBe("thread");
    expect(posted.payload.postId).toBe("t-1");
    expect(posted.payload.url).toBe("https://x.com/i/status/t-1");
    expect(w.threads[0]!.map((p) => p.mediaIds)).toEqual([["media-1"], ["media-2"], undefined]);
    expect(w.uploads).toEqual([image(1).url, image(2).url]);

    // the CA card is drafted BEFORE the deploy, with the pending line
    const caCard = await h.waitFor("Worker.awaitingApproval", { predicate: (e) => (e.payload.approval.draft as { kind: string }).kind === "ca" });
    const caDraft = caCard.payload.approval.draft as { text: string; finalizedOnDeploy: boolean };
    expect(caDraft.finalizedOnDeploy).toBe(true);
    expect(caDraft.text).toContain(CA_PENDING_LINE);
    expect(caDraft.text).not.toContain(FAKE_CA);
    expect(h.ofType("Launcher.deployed")).toHaveLength(0);
    h.gate.resolve(caCard.payload.approval.id, "approve");
    await h.settle();
    expect(w.posts).toHaveLength(0); // approved, but nothing posted until the CA exists

    deploy(h);
    const caPosted = await h.waitFor("Voice.posted", { predicate: (e) => e.payload.kind === "ca" });
    expect(caPosted.payload.text).toContain(`CA: ${FAKE_CA}`);
    expect(caPosted.payload.text).toContain(pumpFunUrl(FAKE_CA));
    expect(caPosted.payload.text).not.toContain(CA_PENDING_LINE);
    expect(caPosted.reason).toMatch(/deploy-sig/);
    expect(w.posts).toEqual([{ text: caPosted.payload.text }]);

    expect(await started).toBe("done");
    expect(h.ofType("Worker.done")[0]!.payload.outputs).toMatchObject({ threadPostId: "t-1", caPostId: "post-4", coinCa: FAKE_CA });
    await h.stop();
  });

  it("honours an edited thread and a skipped CA post without failing", async () => {
    const w = recordingX();
    const h = harness(new VoiceWorker(), { clients: { x: w.x } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    feedLaunchInputs(h);
    const threadCard = await h.waitFor("Worker.awaitingApproval");
    const draft = threadCard.payload.approval.draft as { posts: { text: string; imageUrls: string[] }[] };
    h.gate.resolve(threadCard.payload.approval.id, "edit", { ...draft, posts: [{ text: "edited hook" }, ...draft.posts.slice(1)] });
    const posted = await h.waitFor("Voice.posted");
    expect(posted.payload.text).toBe("edited hook");
    expect(w.threads[0]![0]).toEqual({ text: "edited hook", mediaIds: ["media-1"] }); // image kept from the original
    const caCard = await h.waitFor("Worker.awaitingApproval", { predicate: (e) => (e.payload.approval.draft as { kind: string }).kind === "ca" });
    h.gate.resolve(caCard.payload.approval.id, "skip");
    deploy(h);
    expect(await started).toBe("done");
    expect(w.posts).toHaveLength(0);
    expect(h.ofType("Worker.progress").some((e) => e.payload.step === "ca.skipped")).toBe(true);
    await h.stop();
  });

  it("refuses to post a CA draft edited to carry another address", async () => {
    const w = recordingX();
    const h = harness(new VoiceWorker(), { clients: { x: w.x } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    feedLaunchInputs(h);
    const threadCard = await h.waitFor("Worker.awaitingApproval");
    h.gate.resolve(threadCard.payload.approval.id, "skip");
    const caCard = await h.waitFor("Worker.awaitingApproval", { predicate: (e) => (e.payload.approval.draft as { kind: string }).kind === "ca" });
    h.gate.resolve(caCard.payload.approval.id, "edit", { ...caCard.payload.approval.draft, text: `we are live! CA: ${OTHER_CA}` });
    deploy(h);
    expect(await started).toBe("done");
    expect(w.posts).toHaveLength(0);
    const failed = h.ofType("Voice.postFailed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.payload.error).toMatch(/not the deployed CA/);
    await h.stop();
  });

  it("posts the thread with what it has when the deploy arrives first, and fails if the Launcher fails", async () => {
    const w = recordingX();
    const h = harness(new VoiceWorker(), { clients: { x: w.x }, autopilot: { posts: true } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity } });
    h.emit({ type: "Builder.published", reason: "test", payload: { url: SITE, deployId: "d1", trigger: "t0" } });
    h.emit({ type: "Artist.imageReady", reason: "test", payload: { asset: image(1) } });
    await h.settle();
    expect(w.threads).toHaveLength(0); // still waiting for a second image
    deploy(h);
    expect(await started).toBe("done");
    expect(w.threads).toHaveLength(1);
    expect(w.threads[0]![2]!.text).toContain(`CA: ${FAKE_CA}`); // drafted after deploy: the real CA, never pending
    expect(w.posts).toHaveLength(1);
    await h.stop();

    const h2 = harness(new VoiceWorker(), { clients: { x: recordingX().x } });
    const started2 = h2.start();
    await h2.waitFor("Worker.progress");
    h2.emit({ type: "Worker.failed", worker: "Launcher", reason: "boom", payload: { reason: "boom" } });
    expect(await started2).toBe("failed");
    expect(h2.ofType("Worker.failed").find((e) => e.worker === "Voice")!.reason).toMatch(/Launcher failed before deploying/);
    await h2.stop();
  });

  it("sets the avatar and banner from the Artist", async () => {
    const w = recordingX();
    const h = harness(new VoiceWorker(), { clients: { x: w.x } });
    void h.start();
    await h.waitFor("Worker.progress");
    h.emit({ type: "Artist.logoReady", reason: "test", payload: { asset: { ...image(9), kind: "logo", url: "https://img/logo.png" } } });
    h.emit({ type: "Artist.bannerReady", reason: "test", payload: { asset: { ...image(8), kind: "banner", url: "https://img/banner.png" } } });
    await h.settle();
    expect(w.profile).toEqual([{ avatarUrl: "https://img/logo.png" }, { bannerUrl: "https://img/banner.png" }]);
    const ev = h.ofType("Voice.profileUpdated");
    expect(ev.map((e) => e.payload)).toEqual([{ avatar: true, banner: false }, { avatar: true, banner: true }]);
    await h.stop();
  });

  it("never posts the same text twice (milestones), with an injectable store", async () => {
    const { h, w, store } = await launched();
    const before = w.posts.length;
    h.emit({ type: "Chain.milestone", reason: "test", payload: { kind: "holders", value: 100 } });
    await h.settle();
    h.emit({ type: "Chain.milestone", reason: "test", payload: { kind: "holders", value: 100 } });
    await h.settle();
    expect(w.posts.length).toBe(before + 1);
    expect(w.posts.at(-1)!.text).toMatch(/100 holders/);
    expect(h.ofType("Voice.posted").filter((e) => e.payload.kind === "milestone")).toHaveLength(1);
    expect(h.ofType("Worker.progress").some((e) => e.payload.step === "milestone.duplicate")).toBe(true);
    expect(store.has(w.posts.at(-1)!.text)).toBe(true);
    await h.stop();
  });

  it("flags copycats publicly through the gate, with the canonical CA", async () => {
    const { h, w } = await launched();
    const before = w.posts.length;
    h.emit({
      type: "Shield.copycatFound",
      reason: "test",
      payload: { copycat: { source: "pump.fun", externalId: OTHER_CA, url: `https://pump.fun/coin/${OTHER_CA}`, match: "name", score: 0.9, seenAt: new Date().toISOString() } },
    });
    await h.settle();
    expect(w.posts.length).toBe(before + 1);
    const flag = h.ofType("Voice.posted").find((e) => e.payload.kind === "flag")!;
    expect(flag.payload.text).toContain(FAKE_CA);
    expect(flag.payload.text).toContain(`https://pump.fun/coin/${OTHER_CA}`);
    expect(h.ofType("Worker.approvalResolved").length).toBeGreaterThan(0);
    await h.stop();
  });

  it("tick: replies to mentions through the gate with replyTo, posts queued images, asks for angles and images", async () => {
    let now = 1_800_000_000_000;
    const w = recordingX();
    const llm = fakeLlm(() => ({ text: "the box says hi" }));
    const store = new MemoryPostedTextStore();
    const worker = new VoiceWorker({ store, now: () => now, config: { imageEveryMs: 60 * 60_000, engagementHistory: 2 } });
    const h = harness(worker, { clients: { x: w.x, llm }, autopilot: { posts: true } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    feedLaunchInputs(h);
    await h.waitFor("Voice.posted");
    deploy(h);
    await started;
    h.emit({ type: "Launch.live", reason: "test", payload: { coinCa: FAKE_CA, siteUrl: SITE } });
    await h.settle();
    const base = w.posts.length;

    // mentions → gated replies with replyTo
    w.setMentions([fakePost({ id: "100", text: "@scat is this real?", authorId: "fan1" }), fakePost({ id: "101", text: "wen", authorId: "fan2" })]);
    await h.run.tick();
    // both mentions were drafted, but the LLM produced the same text twice: the second is never posted
    const replies = h.ofType("Voice.posted").filter((e) => e.payload.kind === "reply");
    expect(replies).toHaveLength(1);
    expect(w.posts.slice(base)).toEqual([{ text: "the box says hi", replyTo: "100" }]);
    expect(h.ofType("Worker.awaitingApproval")).toHaveLength(0); // autopilot.posts: no taps
    expect(h.ofType("Worker.approvalResolved").filter((e) => e.reason.includes("autopilot")).length).toBeGreaterThanOrEqual(3);
    expect(h.ofType("Worker.progress").some((e) => e.payload.step === "reply.duplicate")).toBe(true);
    expect(store.has("the box says hi")).toBe(true);
    await h.stop();
  });

  it("tick: identical reply texts are deduped, a new image is posted, needsAngle and needsImage fire", async () => {
    let now = 1_800_000_000_000;
    const w = recordingX();
    let k = 0;
    const llm = fakeLlm(() => ({ text: `reply #${++k}` }));
    const worker = new VoiceWorker({ now: () => now, config: { imageEveryMs: 60 * 60_000, engagementHistory: 2 } });
    const h = harness(worker, { clients: { x: w.x, llm }, autopilot: { posts: true } });
    const started = h.start();
    await h.waitFor("Worker.progress");
    feedLaunchInputs(h);
    await h.waitFor("Voice.posted");
    deploy(h);
    await started;
    h.emit({ type: "Launch.live", reason: "test", payload: { coinCa: FAKE_CA, siteUrl: SITE } });
    await h.settle();

    // two busy ticks, then a quiet one → needsAngle
    w.setMentions([fakePost({ id: "1", authorId: "a", metrics: { likes: 10, reposts: 2, replies: 1 } }), fakePost({ id: "2", authorId: "b" })]);
    await h.run.tick();
    now += 60_000;
    w.setMentions([fakePost({ id: "3", authorId: "c", metrics: { likes: 8, reposts: 0, replies: 0 } }), fakePost({ id: "4", authorId: "d" })]);
    await h.run.tick();
    expect(h.ofType("Voice.needsAngle")).toHaveLength(0);
    now += 60_000;
    w.setMentions([]);
    await h.run.tick();
    const needsAngle = h.ofType("Voice.needsAngle");
    expect(needsAngle).toHaveLength(1);
    expect(needsAngle[0]!.payload).toEqual({ mentions: 0, engagement: 0 });
    expect(needsAngle[0]!.reason).toMatch(/engagement dropped/);

    // a new image post-launch is posted on the next tick, using the Ideator's angle
    h.emit({ type: "Ideator.angles", reason: "test", payload: { angles: ["the box is open now"] } });
    h.emit({ type: "Artist.imageReady", reason: "test", payload: { asset: image(3) } });
    await h.settle();
    now += 60_000;
    await h.run.tick();
    const imagePost = h.ofType("Voice.posted").find((e) => e.payload.kind === "image")!;
    expect(imagePost.payload.text).toContain("the box is open now");
    expect(w.posts.at(-1)!.mediaIds).toEqual([`media-${w.uploads.length}`]);
    expect(w.uploads.at(-1)).toBe(image(3).url);

    // no fresh image for over imageEveryMs → needsImage with a brief, once
    now += 2 * 60 * 60_000;
    await h.run.tick();
    await h.run.tick();
    const needsImage = h.ofType("Voice.needsImage");
    expect(needsImage).toHaveLength(1);
    expect(needsImage[0]!.payload.brief).toContain("Schrodinger Cat");
    await h.stop();
  });

  it("tick without an LLM notes that replies need LLM env vars, without failing the worker", async () => {
    const { h, w } = await launched();
    w.setMentions([fakePost({ id: "7", authorId: "fan" })]);
    await h.run.tick();
    const note = h.ofType("Worker.progress").find((e) => e.payload.step === "replies.unavailable")!;
    expect(note.reason).toMatch(/LLM_API_KEY/);
    expect(h.run.status).toBe("done");
    expect(h.ofType("Voice.posted").filter((e) => e.payload.kind === "reply")).toHaveLength(0);
    await h.stop();
  });
});
