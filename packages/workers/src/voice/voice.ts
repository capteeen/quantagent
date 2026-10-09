/**
 * B5 VOICE
 * Posts ONLY through ctx.clients.x, the client scoped to the account the user connected.
 * There is no other posting path in this folder (voice.test.ts greps for one).
 *
 * Launch: pre-drafts the announcement thread (hook, lore, site link, first two images)
 * the moment Ideator.named + the named site (the Builder.published that followed
 * Ideator.named, i.e. the ticker slug rather than the t0 placeholder) + two
 * Artist.imageReady are in, then pre-drafts the CA post with "CA: pending launch" and
 * finalizes it on Launcher.deployed, so each approval is one tap. Every draft links
 * the LATEST Builder.published url at the moment it is finalized; the CA post is
 * re-pointed on deploy if the Builder moved in between. Every post goes through
 * requireApproval({ actionClass: "posts" }) ("edit" honoured, "skip" is not a failure)
 * and is logged as Voice.posted with its post id, or Voice.postFailed.
 * The same text is never posted twice (PostedTextStore, injectable).
 *
 * Post-launch tick(): polls mentions and replies (gated, LLM-drafted), posts chart
 * milestones, posts new images, asks the Ideator for angles when engagement drops and
 * the Artist for images when the set runs dry; on Shield.copycatFound drafts a public
 * flag post (gated).
 */

import { NotImplemented, type Copycat, type EventOf, type Identity, type ImageAsset, type QuantagentEvent } from "@quantagent/core/types";
import type { XClient, XPost } from "@quantagent/core/types/clients";
import type { PostLaunchWorker, StartResult, WorkerContext } from "../context";
import { CLIENT_NEEDS, LauncherFailed, errorText, launcherFailureOf, requireClient, waitForDeployed } from "../shared";
import { addressesIn } from "../shield/match";
import { approvedText, askApproval } from "./approval";
import { MemoryPostedTextStore, type PostedTextStore } from "./dedup";
import {
  CA_PENDING_LINE,
  X_POST_MAX,
  buildCaPost,
  buildFlagPost,
  buildImagePost,
  buildMilestonePost,
  buildThreadDraft,
  clip,
  engagementOf,
  finalizeCaText,
  refreshSiteUrl,
  tickerTag,
  type PostDraft,
} from "./drafts";

export interface VoiceConfig {
  /** Replies per tick, so one burst of mentions never drains the X budget. Env VOICE_MAX_REPLIES_PER_TICK, default 5. */
  maxRepliesPerTick: number;
  /** Ask the Artist for a new image when none was posted for this long. Env VOICE_IMAGE_EVERY_MS, default 6h. */
  imageEveryMs: number;
  /** Minimum gap between two Voice.needsAngle. Default 1h. */
  angleCooldownMs: number;
  /** needsAngle when this tick's signal < ratio × mean of the previous `engagementHistory` ticks. Default 0.5. */
  engagementDropRatio: number;
  engagementHistory: number;
}

export const DEFAULT_VOICE_CONFIG: Readonly<VoiceConfig> = {
  maxRepliesPerTick: 5,
  imageEveryMs: 6 * 60 * 60_000,
  angleCooldownMs: 60 * 60_000,
  engagementDropRatio: 0.5,
  engagementHistory: 3,
};

export function voiceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const num = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    ...DEFAULT_VOICE_CONFIG,
    maxRepliesPerTick: num("VOICE_MAX_REPLIES_PER_TICK", DEFAULT_VOICE_CONFIG.maxRepliesPerTick),
    imageEveryMs: num("VOICE_IMAGE_EVERY_MS", DEFAULT_VOICE_CONFIG.imageEveryMs),
  };
}

export interface VoiceOptions {
  /** Where posted texts are remembered; in-memory by default, inject Redis/Postgres for production. */
  store?: PostedTextStore;
  now?: () => number;
  config?: Partial<VoiceConfig>;
  tickEveryMs?: number;
}

type PostKind = EventOf<"Voice.posted">["payload"]["kind"];

const WORKER = "Voice" as const;
const REPLY_SCHEMA = { type: "object", properties: { text: { type: "string" } }, required: ["text"] } as const;
const REPLY_SYSTEM = `You reply on X as a memecoin's own account. Reply to what the person said, in the coin's voice (its lore and hook are given).
Short (under 240 characters), specific, playful, no price predictions, no promises, no asking for anything, never a contract address other than the one given. Return strict JSON {"text":string}.`;

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (v: T) => void;
  reject!: (e: unknown) => void;
  settled = false;
  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = (v) => {
        this.settled = true;
        res(v);
      };
      this.reject = (e) => {
        this.settled = true;
        rej(e);
      };
    });
    this.promise.catch(() => undefined);
  }
}

export class VoiceWorker implements PostLaunchWorker {
  readonly name = WORKER;
  readonly tickEveryMs: number;
  readonly config: VoiceConfig;
  private readonly store: PostedTextStore;
  private readonly now: () => number;

  // launch inputs
  private identity: Identity | null = null;
  /** The latest Builder.published url; the Builder moves from the t0 slug to the ticker slug. */
  private siteUrl: string | null = null;
  /** True once the Builder published (or failed to) after Ideator.named: the url carries the name. */
  private siteNamed = false;
  private readonly images: ImageAsset[] = [];
  private deployed: EventOf<"Launcher.deployed">["payload"] | null = null;
  /** The Launcher's failure reason, recorded from on() so a late wait never misses it. */
  private launcherFailure: string | null = null;
  private liveAt: number | null = null;
  private artistFailed = false;
  private builderFailed = false;

  // launch flow
  private flowStarted = false;
  private readonly launchDone = new Deferred<Record<string, unknown>>();
  private threadRoot: XPost | null = null;
  private caPost: XPost | null = null;
  private chain: Promise<void> = Promise.resolve();

  // post-launch
  private angles: string[] = [];
  private readonly imageQueue: ImageAsset[] = [];
  private avatarSet = false;
  private bannerSet = false;
  private mentionSinceId: string | undefined;
  private readonly replied = new Set<string>();
  private readonly signals: number[] = [];
  private lastImagePostAt: number | null = null;
  private lastNeedsImageAt: number | null = null;
  private lastNeedsAngleAt: number | null = null;
  private repliesUnavailableNoted = false;
  private stopped = false;

  constructor(opts: VoiceOptions = {}) {
    this.store = opts.store ?? new MemoryPostedTextStore();
    this.now = opts.now ?? (() => Date.now());
    this.config = { ...voiceConfigFromEnv(), ...opts.config };
    this.tickEveryMs = opts.tickEveryMs ?? 5 * 60_000;
  }

  /* ───────────────────────────── lifecycle ───────────────────────────── */

  async start(ctx: WorkerContext): Promise<StartResult> {
    requireClient(ctx, "x", "Voice.post");
    ctx.progress("wait.inputs", "pre-drafting the announcement thread as soon as the name, the site link and two images are in", this.inputStatus());
    ctx.signal.addEventListener("abort", () => this.launchDone.reject(ctx.signal.reason ?? new Error("Voice aborted")), { once: true });
    this.maybeStartFlow(ctx);
    try {
      await waitForDeployed(ctx, () => this.deployed, () => this.launcherFailure);
    } catch (err) {
      if (err instanceof LauncherFailed) {
        this.launchDone.reject(err);
      }
      throw err;
    }
    this.maybeStartFlow(ctx);
    return this.launchDone.promise;
  }

  on(event: QuantagentEvent, ctx: WorkerContext): Promise<void> | void {
    this.launcherFailure ??= launcherFailureOf(event);
    switch (event.type) {
      case "Ideator.named":
        this.identity = event.payload.identity;
        this.maybeStartFlow(ctx);
        return;
      case "Ideator.angles":
        this.angles = event.payload.angles;
        ctx.progress("angles", `Ideator sent ${this.angles.length} new angle(s) for the next posts`, { angles: this.angles });
        return;
      case "Builder.published":
        this.siteUrl = event.payload.url;
        if (event.payload.trigger.split("+").includes("Ideator.named")) this.siteNamed = true;
        this.maybeStartFlow(ctx);
        return;
      case "Builder.patchFailed":
        // The named republish failed: the url we have is the best there will be.
        if (event.payload.trigger.split("+").includes("Ideator.named")) this.siteNamed = true;
        this.maybeStartFlow(ctx);
        return;
      case "Artist.imageReady":
        this.images.push(event.payload.asset);
        if (this.liveAt !== null) this.imageQueue.push(event.payload.asset);
        this.maybeStartFlow(ctx);
        return;
      case "Artist.logoReady":
        return this.enqueue(() => this.updateProfile(ctx, { avatarUrl: event.payload.asset.url }));
      case "Artist.bannerReady":
        return this.enqueue(() => this.updateProfile(ctx, { bannerUrl: event.payload.asset.url }));
      case "Launcher.deployed":
        if (!this.deployed) this.deployed = event.payload;
        this.maybeStartFlow(ctx);
        return;
      case "Launch.live":
        if (this.liveAt === null) this.liveAt = this.now();
        this.siteUrl = event.payload.siteUrl;
        return;
      case "Chain.milestone":
        return this.enqueue(() => this.postMilestone(ctx, event.payload));
      case "Shield.copycatFound":
        return this.enqueue(() => this.postFlag(ctx, event.payload.copycat));
      case "Worker.failed":
        if (event.worker === "Artist") this.artistFailed = true;
        if (event.worker === "Builder") this.builderFailed = true;
        if (event.worker === "Ideator" && !this.identity) {
          const err = new Error(`Ideator failed before naming the coin (${event.payload.reason}); nothing to announce`);
          this.launchDone.reject(err);
          throw err;
        }
        this.maybeStartFlow(ctx);
        return;
      default:
        return;
    }
  }

  async tick(ctx: WorkerContext): Promise<void> {
    if (this.stopped) return;
    await this.enqueue(async () => {
      const x = requireClient(ctx, "x", "Voice.post");
      await this.pollMentions(ctx, x);
      await this.postNextImage(ctx, x);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (!this.launchDone.settled) this.launchDone.reject(new Error("Voice stopped"));
  }

  /* ───────────────────────────── launch flow ───────────────────────────── */

  private inputStatus(): Record<string, unknown> {
    return { named: !!this.identity, site: !!this.siteUrl, siteNamed: this.siteNamed, images: this.images.length, deployed: !!this.deployed };
  }

  private tag(): string {
    return this.identity ? tickerTag(this.identity) : "the coin";
  }

  /**
   * The thread is drafted as soon as it can carry everything (name + the named site +
   * two images), or as soon as waiting would hold up the CA post (deployed, or
   * Artist/Builder failed). "Named site" = the Builder republished after Ideator.named,
   * so the link is the ticker page, not the t0 placeholder.
   */
  private maybeStartFlow(ctx: WorkerContext): void {
    if (this.flowStarted || !this.identity) return;
    const haveSite = (!!this.siteUrl && (this.siteNamed || !!this.deployed)) || this.builderFailed;
    const haveImages = this.images.length >= 2 || this.artistFailed || !!this.deployed;
    if (!haveSite || !haveImages) return;
    if (!this.siteUrl && !this.deployed) return; // builder failed: still give the Artist time until deploy
    this.flowStarted = true;
    void this.enqueue(() => this.runLaunchFlow(ctx));
  }

  private async runLaunchFlow(ctx: WorkerContext): Promise<void> {
    try {
      const x = requireClient(ctx, "x", "Voice.post");
      await this.postThread(ctx, x);
      await this.postCa(ctx, x);
      this.launchDone.resolve({
        threadPostId: this.threadRoot?.id ?? null,
        threadUrl: this.threadRoot?.url ?? null,
        caPostId: this.caPost?.id ?? null,
        caPostUrl: this.caPost?.url ?? null,
        coinCa: this.deployed?.coinCa ?? null,
      });
    } catch (err) {
      this.launchDone.reject(err);
      throw err;
    }
  }

  private async postThread(ctx: WorkerContext, x: XClient): Promise<void> {
    const identity = this.identity!;
    const images = this.images.slice(0, 2);
    const draft = buildThreadDraft({ identity, siteUrl: this.siteUrl ?? undefined, images, coinCa: this.deployed?.coinCa });
    const reason = `announce ${this.tag()}: hook, lore and ${this.siteUrl ? "the site link" : "no site (Builder failed)"} with ${images.length} image(s); CA ${this.deployed ? this.deployed.coinCa : "pending, posted separately on deploy"}`;
    ctx.progress("thread.draft", `announcement thread pre-drafted (${draft.posts.length} posts); waiting for one tap`, { posts: draft.posts.map((p) => p.text), images: images.map((i) => i.url) });

    const gate = await askApproval(ctx, {
      actionClass: "posts",
      title: `Post the ${this.tag()} announcement thread (${draft.posts.length} posts)`,
      draft: { kind: "thread", posts: draft.posts.map((p) => ({ text: p.text, imageUrls: p.imageUrls ?? [] })) },
      reason,
    });
    if (gate.skipped) {
      ctx.progress("thread.skipped", "user skipped the announcement thread; the CA post is still drafted", { approvalId: gate.approvalId });
      return;
    }
    const posts = this.mergeThreadEdit(gate.outcome.draft, draft.posts);
    const first = posts[0]!;
    if (await this.store.has(first.text)) {
      ctx.progress("thread.duplicate", "this exact thread text was already posted; never posting the same text twice", { text: first.text });
      return;
    }
    try {
      const withMedia = [];
      for (const p of posts) withMedia.push({ text: p.text, mediaIds: await this.upload(ctx, x, p.imageUrls ?? []) });
      const results = await x.thread({ posts: withMedia.map((p) => (p.mediaIds.length ? p : { text: p.text })) });
      for (const p of posts) await this.store.add(p.text);
      const root = results[0];
      if (!root) throw new Error("x.thread returned no posts");
      this.threadRoot = root;
      ctx.emit({
        type: "Voice.posted",
        reason: `${reason}; thread of ${results.length} posted, root ${root.id}`,
        payload: { postId: root.id, url: root.url, text: root.text, kind: "thread" },
      });
    } catch (err) {
      ctx.emit({ type: "Voice.postFailed", reason: `announcement thread failed: ${errorText(err)}`, payload: { text: first.text, error: errorText(err) } });
    }
  }

  /** Applies a user edit of the thread draft: texts from the edit, images from the original when the edit has none. */
  private mergeThreadEdit(edited: Record<string, unknown>, original: PostDraft[]): PostDraft[] {
    const list = Array.isArray(edited.posts) ? (edited.posts as unknown[]) : [];
    const out: PostDraft[] = [];
    list.forEach((item, i) => {
      if (!item || typeof item !== "object") return;
      const text = (item as { text?: unknown }).text;
      if (typeof text !== "string" || !text.trim()) return;
      const urls = (item as { imageUrls?: unknown }).imageUrls;
      const imageUrls = Array.isArray(urls) && urls.every((u) => typeof u === "string") ? (urls as string[]) : original[i]?.imageUrls;
      out.push({ text: clip(text.trim(), X_POST_MAX), ...(imageUrls && imageUrls.length ? { imageUrls } : {}) });
    });
    return out.length ? out : original;
  }

  private async postCa(ctx: WorkerContext, x: XClient): Promise<void> {
    const identity = this.identity!;
    const draftedSiteUrl = this.siteUrl ?? undefined;
    const pending = buildCaPost({ identity, siteUrl: draftedSiteUrl, coinCa: this.deployed?.coinCa });
    const known = !!this.deployed;
    ctx.progress(
      "ca.draft",
      known ? `CA post drafted with the deployed address ${this.deployed!.coinCa}` : `CA post pre-drafted with "${CA_PENDING_LINE}"; the real address is filled in the moment Launcher.deployed arrives`,
      { text: pending.text, coinCa: this.deployed?.coinCa ?? null },
    );
    const gate = await askApproval(ctx, {
      actionClass: "posts",
      title: known ? `Post the ${this.tag()} contract address` : `Post the ${this.tag()} contract address the moment it deploys`,
      draft: { kind: "ca", text: pending.text, coinCa: this.deployed?.coinCa ?? null, finalizedOnDeploy: !known },
      reason: known ? "the coin is deployed; the CA post is the one place the address is announced first" : "approved now, posted the instant the deploy confirms so the CA is never late",
    });
    if (gate.skipped) {
      ctx.progress("ca.skipped", "user skipped the CA post", { approvalId: gate.approvalId });
      return;
    }
    const deployed = await waitForDeployed(ctx, () => this.deployed, () => this.launcherFailure);
    this.deployed ??= deployed;
    // Finalize against the LATEST site url: the Builder may have moved to the ticker slug since the draft.
    const latestSiteUrl = this.siteUrl ?? undefined;
    const text = finalizeCaText(refreshSiteUrl(approvedText(gate, pending.text), draftedSiteUrl, latestSiteUrl), deployed.coinCa);
    if (draftedSiteUrl !== latestSiteUrl) {
      ctx.progress("ca.relinked", `CA post re-pointed from ${draftedSiteUrl ?? "no site link"} to the latest site url ${latestSiteUrl}`, { from: draftedSiteUrl ?? null, to: latestSiteUrl ?? null });
    }
    const foreign = addressesIn(text).filter((a) => a !== deployed.coinCa);
    if (foreign.length) {
      const error = `refusing to post: the draft contains an address that is not the deployed CA (${foreign.join(", ")})`;
      ctx.emit({ type: "Voice.postFailed", reason: error, payload: { text, error } });
      return;
    }
    if (await this.store.has(text)) {
      ctx.progress("ca.duplicate", "this exact CA text was already posted; never posting the same text twice", { text });
      return;
    }
    try {
      const post = await x.post({ text });
      await this.store.add(text);
      this.caPost = post;
      ctx.emit({
        type: "Voice.posted",
        reason: `contract address ${deployed.coinCa} announced (deploy tx ${deployed.txSignature}); post ${post.id}`,
        payload: { postId: post.id, url: post.url, text, kind: "ca" },
      });
    } catch (err) {
      ctx.emit({ type: "Voice.postFailed", reason: `CA post failed: ${errorText(err)}`, payload: { text, error: errorText(err) } });
    }
  }

  /* ───────────────────────────── shared posting ───────────────────────────── */

  private enqueue(job: () => Promise<void>): Promise<void> {
    const next = this.chain.then(job);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async upload(ctx: WorkerContext, x: XClient, urls: readonly string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const url of urls) {
      try {
        const { mediaId } = await x.uploadMedia({ url, ...(this.identity ? { alt: `${this.identity.name} ${this.tag()}` } : {}) });
        ids.push(mediaId);
      } catch (err) {
        ctx.progress("media.failed", `could not upload ${url}: ${errorText(err)}; posting without it`, { url });
      }
    }
    return ids;
  }

  /** One gated post: approval → dedup → x.post → Voice.posted / Voice.postFailed. Returns the post or null. */
  private async postGated(ctx: WorkerContext, x: XClient, input: { kind: PostKind; title: string; draft: PostDraft; reason: string; extra?: Record<string, unknown> }): Promise<XPost | null> {
    const { kind, draft } = input;
    const gate = await askApproval(ctx, {
      actionClass: "posts",
      title: input.title,
      draft: { kind, text: draft.text, imageUrls: draft.imageUrls ?? [], replyTo: draft.replyTo ?? null, ...input.extra },
      reason: input.reason,
    });
    if (gate.skipped) {
      ctx.progress(`${kind}.skipped`, `user skipped: ${input.title}`, { approvalId: gate.approvalId });
      return null;
    }
    const text = clip(approvedText(gate, draft.text), X_POST_MAX);
    if (await this.store.has(text)) {
      ctx.progress(`${kind}.duplicate`, "this exact text was already posted; never posting the same text twice", { text });
      return null;
    }
    try {
      const mediaIds = await this.upload(ctx, x, draft.imageUrls ?? []);
      const post = await x.post({ text, ...(mediaIds.length ? { mediaIds } : {}), ...(draft.replyTo ? { replyTo: draft.replyTo } : {}) });
      await this.store.add(text);
      ctx.emit({ type: "Voice.posted", reason: `${input.reason}; post ${post.id}`, payload: { postId: post.id, url: post.url, text, kind } });
      return post;
    } catch (err) {
      ctx.emit({ type: "Voice.postFailed", reason: `${kind} post failed: ${errorText(err)}`, payload: { text, error: errorText(err) } });
      return null;
    }
  }

  private async updateProfile(ctx: WorkerContext, input: { avatarUrl?: string; bannerUrl?: string }): Promise<void> {
    const x = requireClient(ctx, "x", "Voice.profile");
    const what = input.avatarUrl ? "avatar" : "banner";
    try {
      await x.updateProfile(input);
      if (input.avatarUrl) this.avatarSet = true;
      if (input.bannerUrl) this.bannerSet = true;
      ctx.emit({
        type: "Voice.profileUpdated",
        reason: `${what} set from the Artist's ${what === "avatar" ? "logo" : "banner"} (${input.avatarUrl ?? input.bannerUrl})`,
        payload: { avatar: this.avatarSet, banner: this.bannerSet },
      });
    } catch (err) {
      ctx.progress("profile.failed", `could not set the ${what}: ${errorText(err)}`, { ...input });
    }
  }

  private async postMilestone(ctx: WorkerContext, m: { kind: "mcap" | "holders"; value: number }): Promise<void> {
    if (!this.identity) {
      ctx.progress("milestone.skipped", "milestone arrived before the coin had a name", { ...m });
      return;
    }
    const x = requireClient(ctx, "x", "Voice.post");
    const draft = buildMilestonePost({ identity: this.identity, kind: m.kind, value: m.value, coinCa: this.deployed?.coinCa });
    await this.postGated(ctx, x, {
      kind: "milestone",
      title: `Post the ${m.kind} milestone (${m.value})`,
      draft,
      reason: `chart milestone: ${m.kind} crossed ${m.value}`,
      extra: { milestone: m },
    });
  }

  private async postFlag(ctx: WorkerContext, copycat: Copycat): Promise<void> {
    if (!this.identity) {
      ctx.progress("flag.skipped", "copycat found before the coin had a name; nothing public to flag yet", { copycat });
      return;
    }
    const x = requireClient(ctx, "x", "Voice.post");
    const draft = buildFlagPost({ identity: this.identity, copycat, canonicalCa: this.deployed?.coinCa ?? null, siteUrl: this.siteUrl ?? undefined });
    await this.postGated(ctx, x, {
      kind: "flag",
      title: `Flag the ${copycat.source} copycat publicly`,
      draft,
      reason: `Shield found a ${copycat.match} match on ${copycat.source} (score ${copycat.score}): ${copycat.url}`,
      extra: { copycat },
    });
  }

  /* ───────────────────────────── post-launch tick ───────────────────────────── */

  private async pollMentions(ctx: WorkerContext, x: XClient): Promise<void> {
    let mentions: XPost[];
    try {
      mentions = await x.mentions(this.mentionSinceId ? { sinceId: this.mentionSinceId } : {});
    } catch (err) {
      ctx.progress("mentions.failed", `could not read mentions: ${errorText(err)}`);
      return;
    }
    const fresh = mentions.filter((m) => m.authorId !== x.accountId && !this.replied.has(m.id));
    if (mentions.length) this.mentionSinceId = newestId(mentions);
    const engagement = engagementOf(fresh);
    ctx.progress("mentions", `${fresh.length} new mention(s), engagement ${engagement.toFixed(1)} per mention`, { mentions: fresh.length, engagement });
    this.checkEngagement(ctx, fresh.length, engagement);

    if (!fresh.length) return;
    const llm = ctx.clients.llm;
    if (!llm) {
      if (!this.repliesUnavailableNoted) {
        this.repliesUnavailableNoted = true;
        const ni = new NotImplemented("Voice.replies", "replies are drafted by the LLM and no llm client was injected", CLIENT_NEEDS.llm);
        ctx.progress("replies.unavailable", ni.message, { capability: ni.capability, needs: ni.needs });
      }
      return;
    }
    const identity = this.identity;
    if (!identity) return;
    for (const mention of fresh.slice(0, this.config.maxRepliesPerTick)) {
      if (this.stopped) return;
      let text: string;
      try {
        const res = await llm.complete({
          system: REPLY_SYSTEM,
          user: `Coin: ${identity.name} (${this.tag()})\nHook: ${identity.hook}\nLore: ${identity.lore}\nCA: ${this.deployed?.coinCa ?? "pending"}\nAngles: ${this.angles.join(" | ") || "none"}\n\nMention from ${mention.authorId}: "${mention.text}"`,
          schema: REPLY_SCHEMA,
          maxTokens: 300,
        });
        const json = (res.json ?? JSON.parse(res.text)) as { text?: unknown };
        if (typeof json.text !== "string" || !json.text.trim()) throw new Error("LLM returned no reply text");
        text = json.text.trim();
      } catch (err) {
        ctx.progress("reply.draftFailed", `could not draft a reply to ${mention.id}: ${errorText(err)}`, { mentionId: mention.id });
        continue;
      }
      this.replied.add(mention.id);
      await this.postGated(ctx, x, {
        kind: "reply",
        title: `Reply to a mention`,
        draft: { text, replyTo: mention.id },
        reason: `replying to mention ${mention.id} ("${clip(mention.text, 60)}")`,
        extra: { mention: { id: mention.id, text: mention.text, url: mention.url } },
      });
    }
  }

  private checkEngagement(ctx: WorkerContext, count: number, engagement: number): void {
    const signal = count + engagement;
    const history = this.signals.slice(-this.config.engagementHistory);
    this.signals.push(signal);
    if (this.signals.length > 50) this.signals.shift();
    if (history.length < this.config.engagementHistory) return;
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    if (mean <= 0 || signal >= mean * this.config.engagementDropRatio) return;
    const now = this.now();
    if (this.lastNeedsAngleAt !== null && now - this.lastNeedsAngleAt < this.config.angleCooldownMs) return;
    this.lastNeedsAngleAt = now;
    ctx.emit({
      type: "Voice.needsAngle",
      reason: `engagement dropped to ${signal.toFixed(1)} from a ${mean.toFixed(1)} average over the last ${history.length} checks; asking the Ideator for new angles`,
      payload: { mentions: count, engagement },
    });
  }

  private async postNextImage(ctx: WorkerContext, x: XClient): Promise<void> {
    if (!this.identity) return;
    const next = this.imageQueue.shift();
    const now = this.now();
    if (next) {
      const index = this.images.indexOf(next) + 1;
      const angle = this.angles.shift();
      const draft = buildImagePost({ identity: this.identity, asset: next, index, angle });
      const post = await this.postGated(ctx, x, {
        kind: "image",
        title: `Post new image #${index}`,
        draft,
        reason: angle ? `new image from the Artist with the Ideator's angle "${clip(angle, 40)}"` : `new image #${index} from the Artist`,
        extra: { asset: next },
      });
      if (post) this.lastImagePostAt = now;
      return;
    }
    const since = this.lastImagePostAt ?? this.liveAt ?? now;
    if (now - since < this.config.imageEveryMs) return;
    if (this.lastNeedsImageAt !== null && now - this.lastNeedsImageAt < this.config.imageEveryMs) return;
    this.lastNeedsImageAt = now;
    const brief = `${this.identity.name} (${this.tag()}) in the launch set's style: ${this.angles[0] ?? this.identity.hook}`;
    ctx.emit({
      type: "Voice.needsImage",
      reason: `no fresh image for ${Math.round((now - since) / 3_600_000)}h; asking the Artist for one`,
      payload: { brief },
    });
  }
}

/** X ids are snowflakes; when they are all numeric the largest is the newest, else take the first (newest-first order). */
function newestId(posts: XPost[]): string {
  const first = posts[0]!.id;
  if (!posts.every((p) => /^\d+$/.test(p.id))) return first;
  return posts.reduce((best, p) => (BigInt(p.id) > BigInt(best) ? p.id : best), first);
}
