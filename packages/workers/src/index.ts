/**
 * @quantagent/workers — public API.
 * All eight workers plus their pure helpers.
 */

export type {
  ApprovalInput,
  ApprovalOutcome,
  ClientsInput,
  CtxEmitInput,
  PostLaunchWorker,
  ResolvedLaunchOptions,
  StartResult,
  Worker,
  WorkerClients,
  WorkerContext,
} from "./context";

// Ideator
export { IdeatorWorker, createIdeator, type IdeatorOptions, type IdeatorOutputs } from "./ideator/ideator";
export { checkIdentityConstraints, findDenied, PROTECTED_BRAND_DENY, REAL_PERSON_DENY, TICKER_MAX } from "./ideator/constraints";

// Artist
export { ArtistWorker, createArtist, type ArtistOptions, type ArtistOutputs } from "./artist/artist";
export { assertContentOk, checkContent, ContentRuleViolation, SAFETY_SUFFIX, type ContentCheck } from "./artist/rules";
export { hammingDistance, phashFromBytes, phashFromGray, phashFromUrl, phashSimilarity } from "./artist/phash";
export { createS3Store, objectStoreFromEnv, fetchBytes, S3_ENV, type ObjectStore, type S3StoreOptions } from "./artist/storage";
export {
  IMAGE_PROVIDERS,
  IMAGE_PROVIDER_KEYS,
  createFalImageClient,
  createOpenAiImageClient,
  createReplicateImageClient,
  imageClientFromEnv,
  type ImageProvider,
} from "./artist/providers/index";

// Builder
export { BuilderWorker, createBuilder, type BuilderOptions, type BuilderOutputs } from "./builder/builder";
export { render, emptySiteState, pumpFunUrl, chartEmbedUrl, type SiteState, type SiteLaunch, type SitePost } from "./builder/template";
export { renderOgSvg, OG_PATH } from "./builder/og";
export {
  HOSTING_PROVIDERS,
  createCloudflareHosting,
  createVercelHosting,
  hostingClientFromEnv,
  type HostingProvider,
} from "./builder/hosting/index";
export { CF_ENV } from "./builder/hosting/cloudflare";
export { VERCEL_ENV } from "./builder/hosting/vercel";

// Launcher
export { LauncherWorker, createLauncher, QSD_SKIPPED_REASON, DEFAULT_DEV_BUY_SOL, type LauncherOutputs } from "./launcher/launcher";

// Voice
export { VoiceWorker, DEFAULT_VOICE_CONFIG, voiceConfigFromEnv, type VoiceOptions, type VoiceConfig } from "./voice/voice";
export { MemoryPostedTextStore, type PostedTextStore } from "./voice/dedup";
export {
  buildThreadDraft,
  buildCaPost,
  buildMilestonePost,
  buildImagePost,
  buildFlagPost,
  finalizeCaText,
  type PostDraft,
  type ThreadDraft,
} from "./voice/drafts";

// Trader
export { TraderWorker, PRICE_FEED_NEEDS, type TraderOptions, type PriceFeed } from "./trader/trader";
export {
  decide,
  assertSameCoin,
  canSell,
  sellLockRemainingMs,
  trailingHigh,
  pushSample,
  traderConfigFromEnv,
  DEFAULT_TRADER_CONFIG,
  WrongCoin,
  type TraderConfig,
  type TraderState,
  type TraderTick,
  type TradeDecision,
  type PriceSample,
} from "./trader/decide";

// Shield
export { ShieldWorker, type ShieldOptions } from "./shield/shield";
export { extractKeywords, addressesIn, postToCopycat, buildReport } from "./shield/match";

// Recruiter
export { RecruiterWorker, REPLY_MAX_CHARS, type RecruiterOptions } from "./recruiter/recruiter";
export { recruitScore, rankAccounts, RateWindow, hourlyCapFromEnv, DEFAULT_HOURLY_CAP } from "./recruiter/rank";

// Shared helpers
export { CLIENT_NEEDS, requireClient, findBase58Addresses, isBase58Address, slugify, waitForDeployed, LauncherFailed, launcherFailureOf } from "./shared";

import { createArtist } from "./artist/artist";
import { createBuilder } from "./builder/builder";
import { createIdeator } from "./ideator/ideator";
import { createLauncher } from "./launcher/launcher";
import { VoiceWorker, type VoiceOptions } from "./voice/voice";
import { TraderWorker, type TraderOptions } from "./trader/trader";
import { ShieldWorker, type ShieldOptions } from "./shield/shield";
import { RecruiterWorker, type RecruiterOptions } from "./recruiter/recruiter";
import type { Worker } from "./context";

/** The four launch-time workers owned by B1, fresh instances (one set per launch). */
export function createLaunchWorkers(): Worker[] {
  return [createIdeator(), createArtist(), createBuilder(), createLauncher()];
}

export interface CreateWorkersOptions {
  voice?: VoiceOptions;
  trader?: TraderOptions;
  shield?: ShieldOptions;
  recruiter?: RecruiterOptions;
}

/** All eight workers, fresh instances, in spec order. One set per launch. */
export function createWorkers(opts: CreateWorkersOptions = {}): Worker[] {
  return [
    createIdeator(),
    createArtist(),
    createBuilder(),
    createLauncher(),
    new VoiceWorker(opts.voice ?? {}),
    new TraderWorker(opts.trader ?? {}),
    new ShieldWorker(opts.shield ?? {}),
    new RecruiterWorker(opts.recruiter ?? {}),
  ];
}
