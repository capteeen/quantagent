/**
 * Static single-page template in the QSD aesthetic: void #06080A, glass panels,
 * JetBrains Mono, inline CSS, no JS build. `render(state)` is pure: the same state
 * always gives the same HTML. Named blocks fill as events arrive; empty blocks render
 * honestly empty ("pending launch", "no images yet"), never with placeholder content.
 * When the Launcher fails the CA block says "launch failed: <reason>" instead of
 * pretending a CA is still coming.
 *
 * CA rule: the only contract address that can ever appear is `state.launch.coinCa`.
 * Every other string goes through `esc()`, and nothing else in the template is a
 * base58 token of address length (builder.test.ts checks the rendered HTML).
 */

import type { Copycat, Identity, ImageAsset } from "@quantagent/core/types";
import { findBase58Addresses } from "../shared";

export interface SitePost {
  postId: string;
  url: string;
  text: string;
  kind: "thread" | "ca" | "reply" | "image" | "milestone" | "flag";
}

export interface SiteLaunch {
  coinCa: string;
  txSignature: string;
  cluster: "devnet" | "mainnet-beta";
}

export interface SiteState {
  launchId: string;
  prompt: string;
  identity?: Identity;
  logo?: ImageAsset;
  banner?: ImageAsset;
  gallery: ImageAsset[];
  launch?: SiteLaunch;
  /** The Launcher's failure reason: no CA will ever come. Mutually exclusive with `launch`. */
  launchFailed?: string;
  posts: SitePost[];
  milestones: { kind: "mcap" | "holders"; value: number; at: string }[];
  copycats: Copycat[];
  /** Canonical url of this page (for og:url). */
  siteUrl?: string;
  /** Path of the OG asset published next to the page. */
  ogImagePath?: string;
  xHandle?: string;
  updatedAt: string;
}

export function emptySiteState(launchId: string, prompt: string, updatedAt: string): SiteState {
  return { launchId, prompt, gallery: [], posts: [], milestones: [], copycats: [], updatedAt };
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/**
 * A failure reason as shown on the page: escaped, and with any address-length base58
 * token masked, so the only address the page can ever carry stays `launch.coinCa`.
 */
export function failureText(reason: string): string {
  let text = reason;
  for (const token of findBase58Addresses(reason)) text = text.split(token).join("[address]");
  return esc(text);
}

export function pumpFunUrl(coinCa: string): string {
  return `https://pump.fun/coin/${coinCa}`;
}

export function chartEmbedUrl(coinCa: string): string {
  return `https://dexscreener.com/solana/${coinCa}?embed=1&theme=dark&trades=0&info=0`;
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

const CSS = `
:root{--void:#06080A;--ink:#E8ECF1;--mute:#8A94A6;--line:rgba(255,255,255,.08);--glass:rgba(255,255,255,.04);--glow:#4DD0E1;--live:#7CFF6B;--warn:#FF3B30;--amber:#FFB300}
*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--void);color:var(--ink);font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
body{min-height:100vh;background:radial-gradient(1200px 600px at 50% -10%,rgba(77,208,225,.10),transparent 60%),var(--void)}
a{color:var(--glow);text-decoration:none}a:hover{text-decoration:underline}
main{max-width:720px;margin:0 auto;padding:16px 16px 64px}
.glass{background:var(--glass);border:1px solid var(--line);border-radius:16px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:20px;margin-top:16px}
.banner{border-radius:16px;overflow:hidden;border:1px solid var(--line);aspect-ratio:3/1;background:#0B0F14}
.banner img{width:100%;height:100%;object-fit:cover;display:block}
.hero{display:flex;gap:16px;align-items:center}
.logo{width:88px;height:88px;border-radius:20px;border:1px solid var(--line);background:#0B0F14;flex:none;object-fit:cover}
.logo.empty{display:grid;place-items:center;color:var(--mute);font-size:11px;text-align:center}
h1{font-size:26px;letter-spacing:-.02em;line-height:1.1}
.ticker{color:var(--glow);font-size:14px;margin-top:4px}
.hook{color:var(--mute);margin-top:8px}
.label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}
.ca{display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap}
.ca code{font-size:13px;word-break:break-all;background:rgba(0,0,0,.35);padding:8px 10px;border-radius:10px;border:1px solid var(--line);flex:1;min-width:0}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.dot.pending{background:var(--amber);box-shadow:0 0 0 0 rgba(255,179,0,.6);animation:pulse 1.6s infinite}
.dot.live{background:var(--live);box-shadow:0 0 12px rgba(124,255,107,.7)}
.dot.failed{background:var(--warn);box-shadow:0 0 12px rgba(255,59,48,.6)}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,179,0,.6)}70%{box-shadow:0 0 0 12px rgba(255,179,0,0)}100%{box-shadow:0 0 0 0 rgba(255,179,0,0)}}
.btn{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:12px;background:var(--live);color:#06080A;font-weight:700;text-decoration:none!important}
.btn.disabled{background:rgba(255,255,255,.08);color:var(--mute);cursor:not-allowed}
.chart{margin-top:12px;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:#0B0F14}
.chart iframe{width:100%;height:420px;border:0;display:block}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:10px}
.stat{background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:12px;padding:12px}
.stat b{display:block;font-size:20px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:10px}
.gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;border:1px solid var(--line);background:#0B0F14;display:block}
.feed{margin-top:10px;display:grid;gap:10px}
.post{background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:12px;padding:12px;font-size:14px}
.post .kind{color:var(--mute);font-size:11px;letter-spacing:.1em;text-transform:uppercase}
.warn{border-color:rgba(255,59,48,.5);background:rgba(255,59,48,.08)}
.warn .label{color:var(--warn)}
.empty{color:var(--mute);font-size:13px;margin-top:8px}
.lore{margin-top:8px;white-space:pre-wrap}
footer{margin-top:24px;color:var(--mute);font-size:12px;text-align:center}
`;

/* ───────────── blocks ───────────── */

export function headBlock(s: SiteState): string {
  const name = s.identity ? `${s.identity.name} ($${s.identity.ticker})` : "quantagent launch";
  const desc = s.identity ? s.identity.hook : "A coin being launched by eight workers in parallel. Identity undetermined until launch.";
  const og = s.ogImagePath && s.siteUrl ? `${s.siteUrl.replace(/\/$/, "")}/${s.ogImagePath}` : s.logo?.url;
  const favicon = s.logo ? `<link rel="icon" href="${esc(s.logo.url)}">` : "";
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${esc(name)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(name)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    s.siteUrl ? `<meta property="og:url" content="${esc(s.siteUrl)}">` : "",
    og ? `<meta property="og:image" content="${esc(og)}">` : "",
    `<meta name="twitter:card" content="${og ? "summary_large_image" : "summary"}">`,
    og ? `<meta name="twitter:image" content="${esc(og)}">` : "",
    favicon,
    `<link rel="preconnect" href="https://fonts.googleapis.com">`,
    `<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">`,
    `<style>${CSS}</style>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function bannerBlock(s: SiteState): string {
  if (!s.banner) return "";
  return `<div class="banner" data-block="banner"><img src="${esc(s.banner.url)}" alt="${esc(s.identity?.name ?? "banner")}" width="${s.banner.width}" height="${s.banner.height}"></div>`;
}

export function heroBlock(s: SiteState): string {
  const logo = s.logo
    ? `<img class="logo" src="${esc(s.logo.url)}" alt="logo" width="88" height="88">`
    : `<div class="logo empty">logo<br>rendering</div>`;
  const title = s.identity ? esc(s.identity.name) : "name undetermined";
  const ticker = s.identity ? `$${esc(s.identity.ticker)}` : "awaiting the quantum draw";
  const hook = s.identity ? esc(s.identity.hook) : esc(s.prompt || "launching from an empty prompt and live trends");
  return `<section class="glass hero" data-block="hero">${logo}<div><h1>${title}</h1><div class="ticker">${ticker}</div><p class="hook">${hook}</p></div></section>`;
}

export function caBlock(s: SiteState): string {
  if (!s.launch && s.launchFailed) {
    return `<section class="glass warn" data-block="ca"><div class="label">Contract address</div><div class="ca"><span class="dot failed" title="failed"></span><code>launch failed: ${failureText(s.launchFailed)}</code></div><p class="empty">No coin was deployed, so there is no contract address. Anything claiming to be this coin's CA is not ours.</p></section>`;
  }
  if (!s.launch) {
    return `<section class="glass" data-block="ca"><div class="label">Contract address</div><div class="ca"><span class="dot pending" title="live"></span><code>CA: pending launch</code></div><span class="btn disabled">Buy on pump.fun — pending launch</span></section>`;
  }
  const ca = s.launch.coinCa;
  const net = s.launch.cluster === "devnet" ? " · devnet" : "";
  return `<section class="glass" data-block="ca"><div class="label">Contract address${net}</div><div class="ca"><span class="dot live" title="live"></span><code>${ca}</code></div><a class="btn" href="${pumpFunUrl(ca)}" rel="noopener">Buy on pump.fun</a><div class="chart" data-block="chart"><iframe src="${chartEmbedUrl(ca)}" title="chart" loading="lazy"></iframe></div></section>`;
}

export function loreBlock(s: SiteState): string {
  if (!s.identity) return `<section class="glass" data-block="lore"><div class="label">Lore</div><p class="empty">The Ideator is still writing. Five candidates, one quantum draw.</p></section>`;
  return `<section class="glass" data-block="lore"><div class="label">Lore</div><p class="lore">${esc(s.identity.lore)}</p>${s.identity.trend && s.identity.trend !== "none" ? `<p class="empty">rides the live trend “${esc(s.identity.trend)}”</p>` : ""}</section>`;
}

export function statsBlock(s: SiteState): string {
  if (!s.launch) return "";
  const latest = (kind: "mcap" | "holders") => [...s.milestones].reverse().find((m) => m.kind === kind);
  const mcap = latest("mcap");
  const holders = latest("holders");
  if (!mcap && !holders) return "";
  return `<section class="glass" data-block="stats"><div class="label">Live</div><div class="stats">${
    mcap ? `<div class="stat"><span class="label">market cap</span><b>$${formatCompact(mcap.value)}</b></div>` : ""
  }${holders ? `<div class="stat"><span class="label">holders</span><b>${formatCompact(holders.value)}</b></div>` : ""}</div></section>`;
}

export function galleryBlock(s: SiteState): string {
  const imgs = s.gallery.filter((g) => g.kind === "character");
  const body = imgs.length
    ? `<div class="gallery">${imgs.map((g, i) => `<img src="${esc(g.url)}" alt="character ${i + 1}" loading="lazy">`).join("")}</div>`
    : `<p class="empty">No images yet. The Artist renders them one by one.</p>`;
  return `<section class="glass" data-block="gallery"><div class="label">Gallery</div>${body}</section>`;
}

export function feedBlock(s: SiteState): string {
  if (s.posts.length === 0) {
    return `<section class="glass" data-block="feed"><div class="label">From the account</div><p class="empty">Nothing posted yet.</p></section>`;
  }
  const items = s.posts
    .slice(-12)
    .reverse()
    .map((p) => `<a class="post" href="${esc(p.url)}" rel="noopener"><div class="kind">${esc(p.kind)}</div>${esc(p.text)}</a>`)
    .join("");
  const thread = s.posts.find((p) => p.kind === "thread");
  const embed = thread
    ? `<blockquote class="twitter-tweet" data-theme="dark"><a href="${esc(thread.url)}">${esc(thread.text)}</a></blockquote><script async src="https://platform.twitter.com/widgets.js"></script>`
    : "";
  return `<section class="glass" data-block="feed"><div class="label">From the account</div>${embed}<div class="feed">${items}</div></section>`;
}

export function copycatBanner(s: SiteState): string {
  if (s.copycats.length === 0) return "";
  const ca = s.launch ? `<code>${s.launch.coinCa}</code>` : s.launchFailed ? `<code>launch failed: no contract address</code>` : `<code>CA: pending launch</code>`;
  return `<section class="glass warn" data-block="copycat"><div class="label">Verify the real CA</div><p>${s.copycats.length} copycat${s.copycats.length === 1 ? "" : "s"} detected using this name, ticker or logo. The only real contract address is the one on this page:</p><div class="ca">${ca}</div></section>`;
}

export function footerBlock(s: SiteState): string {
  return `<footer data-block="footer">launched by quantagent · identity chosen by a verifiable quantum draw · updated ${esc(s.updatedAt)}</footer>`;
}

/** Pure render of the whole page. */
export function render(s: SiteState): string {
  return `<!doctype html>
<html lang="en">
<head>
${headBlock(s)}
</head>
<body>
<main>
${copycatBanner(s)}
${bannerBlock(s)}
${heroBlock(s)}
${caBlock(s)}
${statsBlock(s)}
${loreBlock(s)}
${galleryBlock(s)}
${feedBlock(s)}
${footerBlock(s)}
</main>
</body>
</html>
`;
}
