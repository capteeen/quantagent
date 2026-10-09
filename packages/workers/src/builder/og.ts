/**
 * OG image (1200×630) as SVG from the logo + ticker, so the site link unfurls on X.
 * Published as an asset next to the page (`og.svg`). Pure.
 */

import type { Identity, ImageAsset } from "@quantagent/core/types";
import { esc } from "./template";

export const OG_PATH = "og.svg";

export function renderOgSvg(input: { identity?: Identity; logo?: ImageAsset; pending: boolean; failed?: boolean }): string {
  const name = input.identity?.name ?? "quantagent launch";
  const ticker = input.identity ? `$${input.identity.ticker}` : "identity undetermined";
  const status = input.failed ? "launch failed: no contract address" : input.pending ? "CA: pending launch" : "live on pump.fun";
  const logo = input.logo
    ? `<image href="${esc(input.logo.url)}" x="80" y="135" width="360" height="360" preserveAspectRatio="xMidYMid slice" clip-path="url(#r)"/>`
    : `<rect x="80" y="135" width="360" height="360" rx="48" fill="#0B0F14" stroke="rgba(255,255,255,0.1)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><clipPath id="r"><rect x="80" y="135" width="360" height="360" rx="48"/></clipPath>
<radialGradient id="g" cx="50%" cy="0%" r="80%"><stop offset="0" stop-color="#4DD0E1" stop-opacity="0.18"/><stop offset="1" stop-color="#06080A" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="630" fill="#06080A"/>
<rect width="1200" height="630" fill="url(#g)"/>
${logo}
<g font-family="JetBrains Mono, ui-monospace, Menlo, monospace" fill="#E8ECF1">
<text x="500" y="270" font-size="64" font-weight="700">${esc(name)}</text>
<text x="500" y="340" font-size="40" fill="#4DD0E1">${esc(ticker)}</text>
<text x="500" y="410" font-size="24" fill="${input.failed ? "#FF3B30" : input.pending ? "#FFB300" : "#7CFF6B"}">${esc(status)}</text>
<text x="500" y="470" font-size="18" fill="#8A94A6">quantagent.fun · chosen by a verifiable quantum draw</text>
</g>
</svg>`;
}

export function ogDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
