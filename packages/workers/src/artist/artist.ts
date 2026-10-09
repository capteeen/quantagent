/**
 * B2 ARTIST
 * Starts from the prompt alone at t=0: N logo candidates in different style
 * directions → Worker.candidates (ctx.collapse) → the quantum draw picks one.
 * Once Ideator.named arrives the chosen style is re-rendered with the final name
 * → Artist.logoReady; then the banner (Artist.bannerReady) and 6–12 character
 * images (Artist.imageReady each) in the same style. If the Ideator dies before
 * naming the coin (its Worker.failed, or Launch.failed), the Artist keeps what it
 * made from the prompt alone, records why the set is incomplete and finishes instead
 * of waiting forever.
 *
 * Content rules run in code before every generation (rules.ts). Every output is
 * stored in object storage (storage.ts) and emitted as a public url with a pHash.
 * A failed generation is logged as Artist.generationFailed and never replaced.
 * Post-launch: Voice.needsImage(brief) / Builder.needsAsset(brief) → one image.
 */

import type { Candidate, Identity, ImageAsset, QuantagentEvent } from "@quantagent/core/types";
import type { ImageClient } from "@quantagent/core/types/clients";
import type { StartResult, Worker, WorkerContext } from "../context";
import { errorText, mapConcurrent, requireClient, truncate } from "../shared";
import {
  BANNER_SIZE,
  CHARACTER_SIZE,
  LOGO_SIZE,
  STYLE_DIRECTIONS,
  bannerBrief,
  characterBrief,
  logoCandidateBrief,
  namedLogoBrief,
  requestedImageBrief,
} from "./briefs";
import { fitImage } from "./fit";
import { phashFromBytes } from "./phash";
import { assertContentOk } from "./rules";
import { extensionFor, fetchBytes, objectStoreFromEnv, type ObjectStore } from "./storage";

export interface ArtistOptions {
  /** Logo candidates for the quantum draw. Default 4. */
  logoCandidates?: number;
  /** Character images, clamped to 6–12. Default 8. */
  characterCount?: number;
  /** Parallel generations. Default 3. */
  concurrency?: number;
  /** Object storage; default reads S3_* env on first use. */
  store?: ObjectStore;
  /** fetch used to pull provider outputs. */
  fetch?: typeof fetch;
}

export interface ArtistOutputs extends Record<string, unknown> {
  logo: ImageAsset | null;
  banner: ImageAsset | null;
  images: ImageAsset[];
  failed: { brief: string; error: string }[];
  style: string;
  /** Why the named logo / banner / character set never happened (the Ideator failed), or null. */
  incomplete: string | null;
}

const WORKER = "Artist" as const;

interface LogoCandidate {
  asset: ImageAsset;
  style: string;
}

export class ArtistWorker implements Worker {
  readonly name = WORKER;
  private readonly opts: { logoCandidates: number; characterCount: number; concurrency: number; store?: ObjectStore; fetch?: typeof fetch };
  private store: ObjectStore | undefined;
  private identity: Identity | undefined;
  private style: string = STYLE_DIRECTIONS[0] as string;
  private styleRef: string | undefined;
  private stopped = false;
  private counter = 0;
  private namedResolve: ((i: Identity) => void) | undefined;
  private namedReject: ((e: Error) => void) | undefined;
  private readonly named: Promise<Identity>;

  constructor(opts: ArtistOptions = {}) {
    this.opts = {
      logoCandidates: Math.max(2, opts.logoCandidates ?? 4),
      characterCount: Math.min(12, Math.max(6, opts.characterCount ?? 8)),
      concurrency: Math.max(1, opts.concurrency ?? 3),
      ...(opts.store ? { store: opts.store } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    };
    this.store = opts.store;
    this.named = new Promise<Identity>((resolve, reject) => {
      this.namedResolve = resolve;
      this.namedReject = reject;
    });
    this.named.catch(() => undefined); // a name that never comes is handled in start()
  }

  /** The name will never arrive (Ideator failed, launch failed, or this worker aborted). */
  private nameGone(reason: string): void {
    if (this.identity) return;
    this.namedReject?.(new Error(reason));
  }

  async start(ctx: WorkerContext): Promise<StartResult> {
    const image = requireClient(ctx, "image", "Artist.generate");
    ctx.progress("rules", "checking the prompt against content rules before any generation");
    assertContentOk(ctx.prompt); // throws ContentRuleViolation → Worker.failed
    const store = this.getStore();
    ctx.progress("provider", `image provider ${image.provider}, storage ${store.kind}`, { provider: image.provider, storage: store.kind });

    // 1. Prompt-only logo candidates in distinct style directions.
    const styles = STYLE_DIRECTIONS.slice(0, this.opts.logoCandidates);
    ctx.progress("logo.candidates", `rendering ${styles.length} logo candidates from the prompt alone`, { styles });
    const results = await mapConcurrent(styles, this.opts.concurrency, (style, i) =>
      this.generate(ctx, image, store, { brief: logoCandidateBrief(ctx.prompt, style), kind: "logo", ...LOGO_SIZE, label: `logo-candidate-${i + 1}` }),
    );
    const candidates: Candidate<LogoCandidate>[] = [];
    results.forEach((r, i) => {
      const style = styles[i] as string;
      if (r.status === "fulfilled") {
        candidates.push({
          id: `artist-logo-${i + 1}`,
          value: { asset: r.value, style },
          reason: `prompt-only logo in style "${truncate(style, 40)}"`,
          thumbnailUrl: r.value.url,
          label: `style ${i + 1}`,
        });
      }
    });
    if (candidates.length === 0) throw new Error(`every logo candidate failed to generate (${results.length} attempts)`);
    if (this.stopped) return;

    // 2. Quantum draw (or the user's pick) collapses the style.
    const { chosen, proof } = await ctx.collapse(candidates, `${candidates.length} logo candidates ready for the quantum draw`);
    this.style = chosen.value.style;
    this.styleRef = chosen.value.asset.url;
    ctx.progress("logo.collapsed", `${proof ? "quantum draw" : "user pick"} chose ${chosen.id}: "${truncate(this.style, 50)}"`, {
      candidateId: chosen.id,
      style: this.style,
    });

    // 3. Re-render with the final name once the Ideator has it.
    ctx.progress("await.named", "waiting for Ideator.named to re-render the logo with the final name");
    const onAbort = () => this.nameGone(ctx.signal.reason instanceof Error ? ctx.signal.reason.message : "Artist aborted while waiting for the name");
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    let identity: Identity;
    try {
      identity = await this.named;
    } catch (err) {
      // No name will ever come: the prompt-only candidates are real generations, keep them and finish.
      const reason = err instanceof Error ? err.message : String(err);
      ctx.progress("named.unavailable", `no name will come (${reason}); finishing with the quantum-drawn prompt-only logo ${chosen.id}, no banner or character set`, {
        reason,
        candidateId: chosen.id,
        candidates: candidates.map((c) => c.value.asset.url),
      });
      const outputs: ArtistOutputs = { logo: chosen.value.asset, banner: null, images: this.images, failed: [], style: this.style, incomplete: reason };
      return outputs;
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
    }
    this.identity = identity;
    let logo: ImageAsset;
    try {
      logo = await this.generate(ctx, image, store, {
        brief: namedLogoBrief(ctx.prompt, identity, this.style),
        kind: "logo",
        ...LOGO_SIZE,
        label: "logo",
      });
      ctx.emit({ type: "Artist.logoReady", reason: `logo re-rendered for ${identity.name} ($${identity.ticker}) in the drawn style`, payload: { asset: logo } });
    } catch (err) {
      // The drawn candidate is a real generation from the prompt, not a stock replacement.
      logo = chosen.value.asset;
      ctx.emit({
        type: "Artist.logoReady",
        reason: `re-render with the name failed (${errorText(err)}); shipping the quantum-drawn prompt-only logo ${chosen.id}`,
        payload: { asset: logo },
      });
    }
    this.styleRef = logo.url;

    // 4. Banner and character set in the same style, in parallel lanes.
    const failed: { brief: string; error: string }[] = [];
    const bannerBriefText = bannerBrief(ctx.prompt, identity, this.style);
    const briefs = Array.from({ length: this.opts.characterCount }, (_, i) => characterBrief(ctx.prompt, identity, this.style, i));
    ctx.progress("set", `rendering banner + ${briefs.length} character images in the drawn style`);
    const jobs: (() => Promise<void>)[] = [
      async () => {
        try {
          const banner = await this.generate(ctx, image, store, { brief: bannerBriefText, kind: "banner", ...BANNER_SIZE, label: "banner" });
          this.banner = banner;
          ctx.emit({ type: "Artist.bannerReady", reason: `X header rendered for ${identity.name}`, payload: { asset: banner } });
        } catch (err) {
          failed.push({ brief: bannerBriefText, error: errorText(err) });
        }
      },
      ...briefs.map((brief, i) => async () => {
        try {
          const asset = await this.generate(ctx, image, store, { brief, kind: "character", ...CHARACTER_SIZE, label: `character-${i + 1}` });
          this.images.push(asset);
          ctx.emit({ type: "Artist.imageReady", reason: `character image ${i + 1}/${briefs.length} rendered`, payload: { asset } });
        } catch (err) {
          failed.push({ brief, error: errorText(err) });
        }
      }),
    ];
    await mapConcurrent(jobs, this.opts.concurrency, (job) => job());

    const outputs: ArtistOutputs = { logo, banner: this.banner ?? null, images: this.images, failed, style: this.style, incomplete: null };
    ctx.progress("set.done", `${this.images.length}/${briefs.length} character images, banner ${this.banner ? "ok" : "failed"}, ${failed.length} failures logged`);
    return outputs;
  }

  private banner: ImageAsset | undefined;
  private images: ImageAsset[] = [];

  async on(event: QuantagentEvent, ctx: WorkerContext): Promise<void> {
    if (this.stopped) return;
    switch (event.type) {
      case "Ideator.named":
        this.identity = event.payload.identity;
        this.namedResolve?.(event.payload.identity);
        return;
      case "Worker.failed":
        if (event.worker === "Ideator") this.nameGone(`Ideator failed before naming the coin: ${event.payload.reason}`);
        return;
      case "Launch.failed":
        this.nameGone(`launch failed before the coin was named: ${event.payload.reason}`);
        return;
      case "Voice.needsImage":
      case "Builder.needsAsset": {
        const image = requireClient(ctx, "image", "Artist.generate");
        const brief = requestedImageBrief(ctx.prompt, this.identity, this.style, event.payload.brief);
        ctx.progress("request", `${event.type === "Voice.needsImage" ? "Voice" : "Builder"} asked for an image: ${truncate(event.payload.brief, 60)}`);
        try {
          const asset = await this.generate(ctx, image, this.getStore(), { brief, kind: "character", ...CHARACTER_SIZE, label: "requested" });
          this.images.push(asset);
          ctx.emit({ type: "Artist.imageReady", reason: `image rendered for ${event.type}: ${truncate(event.payload.brief, 60)}`, payload: { asset } });
        } catch {
          // already logged as Artist.generationFailed by generate()
        }
        return;
      }
      default:
        return;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  /* ───────────── internals ───────────── */

  private getStore(): ObjectStore {
    if (!this.store) this.store = objectStoreFromEnv();
    return this.store;
  }

  /**
   * One generation: content rules → provider → fetch bytes → fit → pHash → store.
   * Emits Artist.generationFailed and rethrows on any failure. Never substitutes.
   */
  private async generate(
    ctx: WorkerContext,
    image: ImageClient,
    store: ObjectStore,
    job: { brief: string; kind: ImageAsset["kind"]; width: number; height: number; label: string },
  ): Promise<ImageAsset> {
    const n = ++this.counter;
    try {
      assertContentOk(job.brief);
      ctx.progress(`generate.${job.label}`, `generating ${job.kind} #${n} via ${image.provider}`, { brief: job.brief });
      const raw = await image.generate({
        prompt: job.brief,
        kind: job.kind,
        width: job.width,
        height: job.height,
        ...(this.styleRef ? { styleRef: this.styleRef } : {}),
      });
      const { bytes, contentType } = await fetchBytes(raw.url, this.opts.fetch ?? fetch);
      const fitted = await fitImage(bytes, contentType, raw, { width: job.width, height: job.height });
      let phash: string | undefined;
      try {
        phash = await phashFromBytes(fitted.bytes);
      } catch (err) {
        ctx.progress("phash.unavailable", `no perceptual hash for ${job.label}: ${errorText(err)}`);
      }
      const key = `${ctx.launchId}/${job.label}-${n}.${extensionFor(fitted.contentType)}`;
      const { url } = await store.put({ key, bytes: fitted.bytes, contentType: fitted.contentType });
      const asset: ImageAsset = {
        url,
        kind: job.kind,
        width: fitted.width,
        height: fitted.height,
        externalId: raw.externalId,
        ...(phash ? { phash } : {}),
      };
      ctx.progress(`stored.${job.label}`, `${job.kind} #${n} stored at ${url}${fitted.fitted ? " (fitted to target size)" : ""}`, {
        url,
        externalId: raw.externalId,
        ...(phash ? { phash } : {}),
      });
      return asset;
    } catch (err) {
      ctx.emit({
        type: "Artist.generationFailed",
        reason: `${job.kind} #${n} (${job.label}) failed: ${errorText(err)}; no replacement image`,
        payload: { brief: job.brief, error: errorText(err) },
      });
      throw err;
    }
  }
}

export function createArtist(opts?: ArtistOptions): ArtistWorker {
  return new ArtistWorker(opts);
}
