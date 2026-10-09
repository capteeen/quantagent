/**
 * Pure projections of a launch's event log for the CoinCard and coin page.
 * The contract address is only ever read from Launcher.deployed / Launch.live.
 */
import type { ImageAsset, Launch, QuantagentEvent, ShieldReport as ShieldReportData } from "@quantagent/core/types";
import type { Fetched } from "@quantagent/ui/kit";
import { lastEventOf } from "@/lib/launchStore";

export interface CoinView {
  name?: string;
  ticker?: string;
  logo: Fetched<ImageAsset>;
  xThread: Fetched<{ url: string; postId: string }>;
  shield: Fetched<ShieldReportData>;
}

export function coinView(state: Launch, events: readonly QuantagentEvent[]): CoinView {
  const named = lastEventOf(events, "Ideator.named");
  const logoReady = lastEventOf(events, "Artist.logoReady");
  const artist = state.workers.Artist;
  let logo: Fetched<ImageAsset>;
  if (logoReady) logo = { status: "ready", value: logoReady.payload.asset };
  else if (artist.status === "failed") logo = { status: "failed", error: artist.failReason ?? "Artist failed" };
  else if (artist.status === "running" || artist.status === "candidates" || artist.status === "awaitingApproval") logo = { status: "loading" };
  else {
    const failedGen = lastEventOf(events, "Artist.generationFailed");
    logo = failedGen ? { status: "failed", error: failedGen.payload.error } : { status: "none" };
  }

  const thread = events.find((e) => e.type === "Voice.posted" && (e.payload.kind === "thread" || e.payload.kind === "ca"));
  const voice = state.workers.Voice;
  let xThread: Fetched<{ url: string; postId: string }>;
  if (thread && thread.type === "Voice.posted") xThread = { status: "ready", value: { url: thread.payload.url, postId: thread.payload.postId } };
  else if (voice.status === "failed") xThread = { status: "failed", error: voice.failReason ?? "Voice failed" };
  else {
    const postFailed = lastEventOf(events, "Voice.postFailed");
    xThread = postFailed ? { status: "failed", error: postFailed.payload.error } : voice.status === "running" || voice.status === "awaitingApproval" ? { status: "loading" } : { status: "none" };
  }

  const report = lastEventOf(events, "Shield.report");
  const shieldWorker = state.workers.Shield;
  let shield: Fetched<ShieldReportData>;
  if (report) shield = { status: "ready", value: report.payload.report };
  else if (shieldWorker.status === "failed") shield = { status: "failed", error: shieldWorker.failReason ?? "Shield failed" };
  else if (shieldWorker.status === "running") shield = { status: "loading" };
  else shield = { status: "none" };

  const view: CoinView = { logo, xThread, shield };
  if (named) {
    view.name = named.payload.identity.name;
    view.ticker = named.payload.identity.ticker;
  }
  return view;
}
