/**
 * B3 BUILDER
 * Starts at t=0 from the prompt: renders the static template (template.ts) and
 * publishes it through ctx.clients.hosting immediately with "CA: pending launch"
 * and a live indicator, BEFORE the coin exists. Then patches + republishes on:
 *   Ideator.named      → title / ticker / lore (and moves to the <ticker> slug)
 *   Artist.logoReady   → favicon / hero / OG image
 *   Artist.bannerReady → header
 *   Artist.imageReady  → gallery
 *   Launcher.deployed  → CA block, pump.fun buy button, chart embed
 *   Launcher failed    → the "CA: pending launch" block becomes "launch failed: <reason>"
 *                        (trigger "Launcher.failed"); the Builder then finishes instead
 *                        of waiting forever, so the launch can report Launch.failed
 *   Voice.posted       → feed (announcement thread embed)
 *   Chain.milestone    → live stat strip
 *   Shield.copycatFound→ "verify the real CA" banner
 * Every publish emits Builder.published { url, deployId, trigger }; a failed one
 * emits Builder.patchFailed { trigger, error }. Publishes are serialized and
 * coalesced so a burst of events becomes one republish with the latest state.
 */

import type { QuantagentEvent } from "@quantagent/core/types";
import type { HostingClient } from "@quantagent/core/types/clients";
import type { StartResult, Worker, WorkerContext } from "../context";
import { LauncherFailed, errorText, requireClient, slugify, waitForDeployed } from "../shared";
import { OG_PATH, ogDataUrl, renderOgSvg } from "./og";
import { emptySiteState, render, type SiteState } from "./template";

export interface BuilderOptions {
  /** A domain the user owns; connected through the hosting provider's domains API after the first publish. */
  customDomain?: string;
  /** Clock for `updatedAt` (tests). */
  now?: () => Date;
}

export interface BuilderOutputs extends Record<string, unknown> {
  url: string;
  slug: string;
  deploys: number;
  failures: number;
  coinCa: string | null;
  /** Why no CA will ever reach the page (the Launcher's failure reason), or null. */
  launchFailed: string | null;
}

const WORKER = "Builder" as const;

export class BuilderWorker implements Worker {
  readonly name = WORKER;
  private state!: SiteState;
  private slug = "";
  /** The last slug the host accepted; publishes fall back to it when a new slug is refused. */
  private servedSlug = "";
  private url: string | undefined;
  private deploys = 0;
  private failures = 0;
  private inFlight: Promise<void> | null = null;
  private pendingTrigger: string | null = null;
  private stopped = false;
  private readonly opts: BuilderOptions;

  constructor(opts: BuilderOptions = {}) {
    this.opts = opts;
  }

  /** Current page state (read-only view for tests / the app). */
  get siteState(): Readonly<SiteState> {
    return this.state;
  }

  async start(ctx: WorkerContext): Promise<StartResult> {
    const hosting = requireClient(ctx, "hosting", "Builder.publish");
    const now = (this.opts.now ?? (() => new Date()))().toISOString();
    this.state = emptySiteState(ctx.launchId, ctx.prompt, now);
    this.slug = `q-${slugify(ctx.launchId)}`.slice(0, 24).replace(/-+$/, "");
    // Subscribe before the first publish so a deploy during it is never missed. The wait
    // races the Launcher's failure (and Launch.failed / abort): a dead Launcher must never
    // leave this worker, and with it the whole launch, hanging on an event that never comes.
    const deployedP = waitForDeployed(ctx);
    deployedP.catch(() => undefined);
    ctx.progress("scaffold", `scaffolding the site from the prompt; CA block reads "pending launch" until the Launcher deploys`);
    await this.publish(ctx, hosting, "t0");
    if (!this.url) throw new Error("initial publish failed; the Voice has no site link to post");

    if (this.opts.customDomain) {
      try {
        const { verification } = await hosting.connectCustomDomain({ slug: this.slug, domain: this.opts.customDomain });
        ctx.progress("domain", `custom domain ${this.opts.customDomain} requested; verification: ${verification}`, {
          domain: this.opts.customDomain,
          verification,
        });
      } catch (err) {
        ctx.progress("domain.failed", `custom domain ${this.opts.customDomain} could not be connected: ${errorText(err)}`, { error: errorText(err) });
      }
    }

    // Stay "running" until the CA is on the page; post-launch patches continue through on().
    ctx.progress("await.deployed", "published; waiting for Launcher.deployed to patch the CA block");
    try {
      const deployed = await deployedP;
      this.state.launch = { coinCa: deployed.coinCa, txSignature: deployed.txSignature, cluster: ctx.options.cluster };
      await this.publish(ctx, hosting, "Launcher.deployed");
    } catch (err) {
      if (!(err instanceof LauncherFailed)) throw err;
      // No coin will ever come: say so on the page instead of "pending launch" forever, then finish.
      this.state.launchFailed = err.launcherReason;
      ctx.progress("launch.failed", `Launcher failed before deploying (${err.launcherReason}); replacing "CA: pending launch" with the failure on the page`, {
        reason: err.launcherReason,
      });
      await this.publish(ctx, hosting, "Launcher.failed");
    }
    return this.outputs();
  }

  private outputs(): BuilderOutputs {
    return {
      url: this.url as string,
      slug: this.slug,
      deploys: this.deploys,
      failures: this.failures,
      coinCa: this.state.launch?.coinCa ?? null,
      launchFailed: this.state.launchFailed ?? null,
    };
  }

  async on(event: QuantagentEvent, ctx: WorkerContext): Promise<void> {
    if (this.stopped || !this.state) return;
    if (event.type === "Launcher.deployed") return; // handled in start() so Worker.done waits for it
    const hosting = requireClient(ctx, "hosting", "Builder.publish");
    await this.applyAndPublish(ctx, hosting, event);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.inFlight?.catch(() => undefined);
  }

  /* ───────────── internals ───────────── */

  /** Applies an event to the site state; returns the trigger name when a republish is needed. */
  private apply(event: QuantagentEvent): string | null {
    const s = this.state;
    switch (event.type) {
      case "Ideator.named":
        s.identity = event.payload.identity;
        this.slug = slugify(event.payload.identity.ticker);
        return event.type;
      case "Artist.logoReady":
        s.logo = event.payload.asset;
        return event.type;
      case "Artist.bannerReady":
        s.banner = event.payload.asset;
        return event.type;
      case "Artist.imageReady":
        s.gallery.push(event.payload.asset);
        return event.type;
      case "Voice.posted":
        s.posts.push({ postId: event.payload.postId, url: event.payload.url, text: event.payload.text, kind: event.payload.kind });
        return event.type;
      case "Chain.milestone":
        s.milestones.push({ ...event.payload, at: event.at });
        return event.type;
      case "Shield.copycatFound":
        s.copycats.push(event.payload.copycat);
        return event.type;
      default:
        return null;
    }
  }

  private async applyAndPublish(ctx: WorkerContext, hosting: HostingClient, event: QuantagentEvent): Promise<void> {
    const trigger = this.apply(event);
    if (!trigger) return;
    await this.publish(ctx, hosting, trigger);
  }

  /** Serialized + coalesced publish: a trigger arriving mid-publish queues exactly one more publish. */
  private publish(ctx: WorkerContext, hosting: HostingClient, trigger: string): Promise<void> {
    if (this.inFlight) {
      this.pendingTrigger = this.pendingTrigger ? `${this.pendingTrigger}+${trigger}` : trigger;
      return this.inFlight;
    }
    const run = async (t: string): Promise<void> => {
      await this.publishOnce(ctx, hosting, t);
      if (this.pendingTrigger && !this.stopped) {
        const next = this.pendingTrigger;
        this.pendingTrigger = null;
        await run(next);
      }
    };
    this.inFlight = run(trigger).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async publishOnce(ctx: WorkerContext, hosting: HostingClient, trigger: string): Promise<void> {
    const now = (this.opts.now ?? (() => new Date()))().toISOString();
    this.state.updatedAt = now;
    this.state.ogImagePath = OG_PATH;
    const caStatus = this.state.launch ? "CA live" : this.state.launchFailed ? "launch failed" : "CA pending";
    const svg = renderOgSvg({
      ...(this.state.identity ? { identity: this.state.identity } : {}),
      ...(this.state.logo ? { logo: this.state.logo } : {}),
      pending: !this.state.launch,
      ...(this.state.launchFailed ? { failed: true } : {}),
    });
    const html = render(this.state);
    ctx.progress("publish", `publishing ${this.slug} (trigger ${trigger}, ${html.length} bytes, ${caStatus})`, { trigger, slug: this.slug });
    try {
      const { url, deployId } = await hosting.publish({ slug: this.slug, html, assets: [{ path: OG_PATH, url: ogDataUrl(svg) }] });
      this.url = url;
      this.servedSlug = this.slug;
      this.state.siteUrl = url;
      this.deploys++;
      ctx.emit({
        type: "Builder.published",
        reason: `site published at ${url} (deploy ${deployId}) after ${trigger}${
          this.state.launch ? ` with CA ${this.state.launch.coinCa}` : this.state.launchFailed ? "; launch failed, no CA" : "; CA pending launch"
        }`,
        payload: { url, deployId, trigger },
      });
    } catch (err) {
      this.failures++;
      ctx.emit({
        type: "Builder.patchFailed",
        reason: `publish after ${trigger} failed: ${errorText(err)}`,
        payload: { trigger, error: errorText(err) },
      });
      // A new slug the host refuses must not strand the content: fall back to the slug it last served,
      // so the CA block and every later patch still reach a page that exists.
      if (this.servedSlug && this.slug !== this.servedSlug && !this.stopped) {
        const refused = this.slug;
        this.slug = this.servedSlug;
        ctx.progress("publish.fallback", `host refused slug ${refused}; publishing to ${this.servedSlug} instead`, { refused, slug: this.servedSlug, trigger });
        await this.publishOnce(ctx, hosting, `${trigger}:fallback`);
      }
    }
  }
}

export function createBuilder(opts?: BuilderOptions): BuilderWorker {
  return new BuilderWorker(opts);
}
