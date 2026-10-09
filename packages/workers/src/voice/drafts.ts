/**
 * Pure draft builders for the Voice. Every text here is rendered from real launch data
 * (identity, site url, deployed CA, chain milestones). Nothing is invented.
 */

import type { BundleFlag, Copycat, Identity, ImageAsset } from "@quantagent/core/types";

export const X_POST_MAX = 280;

export interface PostDraft {
  text: string;
  imageUrls?: string[];
  replyTo?: string;
}

export interface ThreadDraft {
  posts: PostDraft[];
}

export const CA_PENDING_LINE = "CA: pending launch";

/** Trim to `max` characters at a word boundary with an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function tickerTag(identity: Identity): string {
  return `$${identity.ticker.replace(/^\$/, "").toUpperCase()}`;
}

export function pumpFunUrl(coinCa: string): string {
  return `https://pump.fun/coin/${coinCa}`;
}

/**
 * Announcement thread: hook (+ image 1), lore (+ image 2), site link with the CA line.
 * The CA line is "pending launch" until the Launcher deploys; never any other address.
 */
export function buildThreadDraft(input: {
  identity: Identity;
  /** Missing only when the Builder failed; the thread then carries no link. */
  siteUrl?: string | undefined;
  images: ImageAsset[];
  coinCa?: string | undefined;
}): ThreadDraft {
  const { identity, siteUrl, images, coinCa } = input;
  const tag = tickerTag(identity);
  const [img1, img2] = images;
  const hook = clip(`${identity.hook}\n\n${tag}`, X_POST_MAX);
  const lore = clip(identity.lore, X_POST_MAX);
  const caLine = coinCa ? `CA: ${coinCa}` : `${CA_PENDING_LINE} — posted here the moment it confirms.`;
  const site = clip([`${identity.name} ${tag}`, siteUrl, caLine].filter(Boolean).join("\n\n"), X_POST_MAX);
  const posts: PostDraft[] = [
    { text: hook, ...(img1 ? { imageUrls: [img1.url] } : {}) },
    { text: lore, ...(img2 ? { imageUrls: [img2.url] } : {}) },
    { text: site },
  ];
  return { posts };
}

/** The CA post. With no CA yet, the text carries the pending line so the card can be pre-drafted. */
export function buildCaPost(input: { identity: Identity; siteUrl?: string | undefined; coinCa?: string | undefined }): PostDraft {
  const { identity, siteUrl, coinCa } = input;
  const tag = tickerTag(identity);
  const lines = coinCa
    ? [`${tag} is live.`, "", `CA: ${coinCa}`, "", pumpFunUrl(coinCa)]
    : [`${tag} is launching.`, "", CA_PENDING_LINE];
  if (siteUrl) lines.push(siteUrl);
  return { text: lines.join("\n") };
}

/**
 * Re-points a drafted text at the LATEST site url: the Builder starts at a t0 slug and
 * moves to the ticker slug on Ideator.named, so a draft approved earlier may carry a
 * link to the placeholder page. A text with no link yet gets the latest one appended.
 */
export function refreshSiteUrl(text: string, drafted: string | undefined, latest: string | undefined): string {
  if (!latest || drafted === latest) return text;
  if (drafted && text.includes(drafted)) return text.split(drafted).join(latest);
  if (text.includes(latest)) return text;
  return `${text.trimEnd()}\n${latest}`;
}

export function formatUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.?0+$/, "")}K`;
  return `$${Math.round(value)}`;
}

export function buildMilestonePost(input: {
  identity: Identity;
  kind: "mcap" | "holders";
  value: number;
  coinCa?: string | undefined;
}): PostDraft {
  const tag = tickerTag(input.identity);
  const body =
    input.kind === "holders"
      ? `${tag} just crossed ${input.value.toLocaleString("en-US")} holders.`
      : `${tag} just crossed ${formatUsd(input.value)} market cap.`;
  const lines = [body];
  if (input.coinCa) lines.push("", `CA: ${input.coinCa}`);
  return { text: clip(lines.join("\n"), X_POST_MAX) };
}

export function buildImagePost(input: { identity: Identity; asset: ImageAsset; index: number; angle?: string | undefined }): PostDraft {
  const tag = tickerTag(input.identity);
  const lead = input.angle ? clip(input.angle, 200) : `${input.identity.name} drop #${input.index}`;
  return { text: clip(`${lead}\n\n${tag}`, X_POST_MAX), imageUrls: [input.asset.url] };
}

export function buildFlagPost(input: {
  identity: Identity;
  copycat: Copycat;
  canonicalCa: string | null;
  siteUrl?: string | undefined;
}): PostDraft {
  const tag = tickerTag(input.identity);
  const where = input.copycat.source === "pump.fun" ? "that pump.fun coin" : "that post";
  const lines = input.canonicalCa
    ? [`⚠️ ${tag} has exactly one contract address:`, "", input.canonicalCa, "", `${where} is not us: ${input.copycat.url}`]
    : [`⚠️ ${tag} has not launched yet. ${where} is not us: ${input.copycat.url}`, "", "The real CA will be posted here first."];
  if (input.siteUrl) lines.push("", `Verify: ${input.siteUrl}`);
  return { text: clip(lines.join("\n"), X_POST_MAX) };
}

export function buildBundleFlagPost(input: { identity: Identity; flag: BundleFlag; canonicalCa: string }): PostDraft {
  const tag = tickerTag(input.identity);
  const what = input.flag.kind === "bundled-launch" ? "bundled buys at launch" : "a dev-wallet anomaly";
  return {
    text: clip(`Transparency note for ${tag}: the Shield detected ${what}. Evidence: ${input.flag.evidence}\n\nCA: ${input.canonicalCa}`, X_POST_MAX),
  };
}

/** Average interactions per post over the window. Posts without metrics count as zero. */
export function engagementOf(posts: { metrics?: { likes: number; reposts: number; replies: number } | undefined }[]): number {
  if (posts.length === 0) return 0;
  const total = posts.reduce((sum, p) => sum + (p.metrics ? p.metrics.likes + p.metrics.reposts + p.metrics.replies : 0), 0);
  return total / posts.length;
}

/**
 * Turns an approved (possibly user-edited) CA draft into the final text once the coin
 * is deployed: the pending line becomes the real CA, the pump.fun link is added, and
 * the CA is guaranteed to be present even if the edit removed the line.
 */
export function finalizeCaText(approved: string, coinCa: string): string {
  let text = approved.replace(/is launching\./i, "is live.");
  if (text.includes(CA_PENDING_LINE)) text = text.replace(CA_PENDING_LINE, `CA: ${coinCa}`);
  if (!text.includes(coinCa)) text = `${text.trimEnd()}\n\nCA: ${coinCa}`;
  const pump = pumpFunUrl(coinCa);
  if (!text.includes(pump)) text = `${text.trimEnd()}\n\n${pump}`;
  if (text.length <= X_POST_MAX) return text;
  // Over the limit: the address and the pump.fun link are the point of this post; keep them.
  const essentials = `\n\nCA: ${coinCa}\n\n${pump}`;
  const head = text.replace(`CA: ${coinCa}`, "").replace(pump, "").replace(/\n{3,}/g, "\n\n").trim();
  return `${clip(head, X_POST_MAX - essentials.length)}${essentials}`;
}
