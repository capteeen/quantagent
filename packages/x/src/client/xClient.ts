/**
 * XApiClient: the @quantagent/core XClient contract over X API v2, scoped to
 * ONE connected account. It cannot act as any other account.
 */
import { NotImplemented } from "@quantagent/core/types";
import type { XAccountSummary, XClient, XPost } from "@quantagent/core/types/clients";
import { XAccountNotConnected, XApiError, XBudgetPaused, XDeadLettered, XThreadFailed, errorMessage } from "../errors";
import type { FetchLike } from "../oauth/oauth";
import type { DeadLetter, DeadLetterQueue } from "../ratelimit/dlq";
import type { XHttp, XLogger } from "./http";
import { downloadAsset, uploadMediaChunked, type MediaUploadOptions } from "./media";
import { OAUTH1_ENV_VARS, oauth1AccountId, oauth1Header, type OAuth1Credentials } from "./oauth1";

export const TWEET_FIELDS = "id,text,author_id,created_at,public_metrics,entities";
export const DEFAULT_TREND_QUERY = "(solana OR memecoin OR pumpfun OR \"pump.fun\") -is:retweet lang:en";

export interface XTrend {
  name: string;
  volume?: number;
  /** Where the trend came from: X's personalized trends endpoint, or our own recent-search tally. */
  source: "personalized_trends" | "search";
  category?: string;
}

export interface XApiClientOptions {
  http: XHttp;
  dlq: DeadLetterQueue;
  /** Recent-search query used when personalized trends are not available on this tier. */
  trendQuery?: string;
  /** OAuth 1.0a credentials for the v1.1 profile endpoints (see README caveat). */
  oauth1?: OAuth1Credentials | null;
  media?: MediaUploadOptions;
  /** Fetch used to download assets (avatar/banner/media) — not X API calls. */
  assetFetch?: FetchLike;
  now?: () => number;
  log?: XLogger;
}

interface TweetData {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; impression_count?: number };
  entities?: { hashtags?: { tag: string }[]; cashtags?: { tag: string }[] };
}

interface TweetList {
  data?: TweetData[];
  includes?: { users?: { id: string; username: string }[] };
  meta?: { result_count?: number; newest_id?: string; next_token?: string };
}

/** Errors that are NOT retriable through the DLQ: nothing X could later accept. */
function isTerminal(err: unknown): boolean {
  return (
    err instanceof XBudgetPaused ||
    err instanceof NotImplemented ||
    err instanceof XAccountNotConnected ||
    (err instanceof XApiError && (err.status === 400 || err.status === 401 || err.status === 403 || err.status === 404))
  );
}

export class XApiClient implements XClient {
  readonly accountId: string;
  private readonly http: XHttp;
  private readonly dlq: DeadLetterQueue;
  private readonly trendQuery: string;
  private readonly oauth1: OAuth1Credentials | null;
  private readonly mediaOpts: MediaUploadOptions;
  private readonly assetFetch: FetchLike;
  private readonly now: () => number;
  private readonly log: XLogger;

  constructor(opts: XApiClientOptions) {
    this.http = opts.http;
    this.accountId = opts.http.accountId;
    this.dlq = opts.dlq;
    this.trendQuery = opts.trendQuery ?? DEFAULT_TREND_QUERY;
    this.oauth1 = opts.oauth1 ?? null;
    this.mediaOpts = opts.media ?? {};
    this.assetFetch = opts.assetFetch ?? opts.media?.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    // Failed writes for this account are replayed through this client.
    this.dlq.setHandler(this.accountId, "post", (e) => this.replay(e));
    this.dlq.setHandler(this.accountId, "thread", (e) => this.replay(e));
    this.dlq.setHandler(this.accountId, "uploadMedia", (e) => this.replay(e));
    this.dlq.setHandler(this.accountId, "updateProfile", (e) => this.replay(e));
  }

  /* ───────────────────────── writes ───────────────────────── */

  async post(input: { text: string; mediaIds?: string[]; replyTo?: string }): Promise<XPost> {
    try {
      return await this.postOnce(input);
    } catch (err) {
      if (isTerminal(err)) throw err;
      throw await this.deadLetter("post", input, err);
    }
  }

  private async postOnce(input: { text: string; mediaIds?: string[]; replyTo?: string }): Promise<XPost> {
    const body: Record<string, unknown> = { text: input.text };
    if (input.mediaIds?.length) body["media"] = { media_ids: input.mediaIds };
    if (input.replyTo) body["reply"] = { in_reply_to_tweet_id: input.replyTo };
    const res = await this.http.request<{ data?: { id?: string; text?: string } }>({
      method: "POST",
      path: "/2/tweets",
      route: "POST /2/tweets",
      json: body,
    });
    const id = res.data?.data?.id;
    if (!id) throw new XApiError(res.status, "POST /2/tweets", res.data, res.headers);
    const handle = await this.http.auth.handle();
    return {
      id,
      url: postUrl(id, handle),
      text: res.data?.data?.text ?? input.text,
      authorId: this.accountId,
      createdAt: new Date(this.now()).toISOString(),
    };
  }

  /**
   * Posts in order, each replying to the previous (in_reply_to_tweet_id).
   * `replyTo` lets a thread continue under an existing post (used by DLQ replay).
   */
  async thread(input: { posts: { text: string; mediaIds?: string[] }[]; replyTo?: string }): Promise<XPost[]> {
    const posted: XPost[] = [];
    let replyTo = input.replyTo;
    for (let i = 0; i < input.posts.length; i++) {
      const p = input.posts[i] as { text: string; mediaIds?: string[] };
      const req: { text: string; mediaIds?: string[]; replyTo?: string } = { text: p.text };
      if (p.mediaIds) req.mediaIds = p.mediaIds;
      if (replyTo) req.replyTo = replyTo;
      try {
        const out = await this.postOnce(req);
        posted.push(out);
        replyTo = out.id;
      } catch (err) {
        if (isTerminal(err)) throw new XThreadFailed(posted, i, err);
        const remaining: { posts: { text: string; mediaIds?: string[] }[]; replyTo?: string } = {
          posts: input.posts.slice(i),
        };
        if (replyTo) remaining.replyTo = replyTo;
        const dl = await this.deadLetter("thread", remaining, err);
        throw new XThreadFailed(posted, i, err, dl.dlqId);
      }
    }
    return posted;
  }

  async uploadMedia(input: { url: string; alt?: string }): Promise<{ mediaId: string }> {
    try {
      return await uploadMediaChunked(this.http, input, { ...this.mediaOpts, fetch: this.assetFetch });
    } catch (err) {
      if (isTerminal(err)) throw err;
      throw await this.deadLetter("uploadMedia", input, err);
    }
  }

  /**
   * v1.1 account/update_profile_image + update_profile_banner.
   * Caveat: these legacy endpoints accept OAuth 1.0a user context; many apps get
   * 401/403 with an OAuth 2.0 bearer. We try the bearer first and, if X refuses,
   * throw NotImplemented naming the X_OAUTH1_* variables that unblock it.
   */
  async updateProfile(input: { avatarUrl?: string; bannerUrl?: string }): Promise<void> {
    if (!input.avatarUrl && !input.bannerUrl) return;
    try {
      if (input.avatarUrl) await this.v1Profile("update_profile_image", "image", input.avatarUrl);
      if (input.bannerUrl) await this.v1Profile("update_profile_banner", "banner", input.bannerUrl);
    } catch (err) {
      if (err instanceof XApiError && (err.status === 401 || err.status === 403) && !this.oauth1) {
        throw new NotImplemented(
          "x.updateProfile",
          `X refused the OAuth 2.0 token on v1.1 ${err.route} (HTTP ${err.status}); profile image/banner updates need OAuth 1.0a user context for the connected account`,
          [...OAUTH1_ENV_VARS],
        );
      }
      if (isTerminal(err)) throw err;
      throw await this.deadLetter("updateProfile", input, err);
    }
  }

  private async v1Profile(endpoint: "update_profile_image" | "update_profile_banner", field: "image" | "banner", url: string) {
    const asset = await downloadAsset(url, this.assetFetch);
    const b64 = Buffer.from(asset.bytes).toString("base64");
    const apiUrl = `https://api.x.com/1.1/account/${endpoint}.json`;
    const params: Record<string, string> = { [field]: b64 };
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    let auth: "oauth2" | "preset" = "oauth2";
    if (this.oauth1) {
      const owner = oauth1AccountId(this.oauth1);
      if (owner && owner !== this.accountId) {
        throw new NotImplemented(
          "x.updateProfile",
          `X_OAUTH1_ACCESS_TOKEN belongs to account ${owner}, not the connected account ${this.accountId}; profile updates only ever touch the connected account`,
          [...OAUTH1_ENV_VARS],
        );
      }
      headers["authorization"] = oauth1Header(this.oauth1, { method: "POST", url: apiUrl, params });
      auth = "preset";
    }
    await this.http.request({
      method: "POST",
      path: apiUrl,
      route: `POST /1.1/account/${endpoint}`,
      headers,
      body: new URLSearchParams(params).toString(),
      auth,
    });
  }

  /* ───────────────────────── reads ───────────────────────── */

  async mentions(input: { sinceId?: string }): Promise<XPost[]> {
    const query: Record<string, string | number | undefined> = {
      max_results: 100,
      "tweet.fields": TWEET_FIELDS,
      expansions: "author_id",
      "user.fields": "username",
    };
    if (input.sinceId) query["since_id"] = input.sinceId;
    const res = await this.http.request<TweetList>({
      method: "GET",
      path: `/2/users/${this.accountId}/mentions`,
      route: "GET /2/users/:id/mentions",
      query,
    });
    return toPosts(res.data);
  }

  async search(input: { query: string; max?: number }): Promise<XPost[]> {
    const max = Math.max(10, Math.min(100, input.max ?? 50));
    const res = await this.http.request<TweetList>({
      method: "GET",
      path: "/2/tweets/search/recent",
      route: "GET /2/tweets/search/recent",
      query: {
        query: input.query,
        max_results: max,
        "tweet.fields": TWEET_FIELDS,
        expansions: "author_id",
        "user.fields": "username",
      },
    });
    return toPosts(res.data).slice(0, input.max ?? 50);
  }

  /**
   * X's personalized trends (GET /2/users/personalized_trends) when the tier
   * allows it; otherwise a hashtag/cashtag tally over recent search for
   * `trendQuery`, with `source: "search"` so nobody mistakes it for X's list.
   */
  async trends(): Promise<XTrend[]> {
    try {
      const res = await this.http.request<{
        data?: { trend_name?: string; post_count?: string | number; category?: string }[];
      }>({
        method: "GET",
        path: "/2/users/personalized_trends",
        route: "GET /2/users/personalized_trends",
      });
      const rows = res.data?.data ?? [];
      return rows
        .filter((r) => typeof r.trend_name === "string" && r.trend_name)
        .map((r) => {
          const t: XTrend = { name: r.trend_name as string, source: "personalized_trends" };
          const v = parseVolume(r.post_count);
          if (v !== undefined) t.volume = v;
          if (r.category) t.category = r.category;
          return t;
        });
    } catch (err) {
      if (!(err instanceof XApiError && (err.isTierError || err.status === 404))) throw err;
    }
    const res = await this.http.request<TweetList>({
      method: "GET",
      path: "/2/tweets/search/recent",
      route: "GET /2/tweets/search/recent",
      query: { query: this.trendQuery, max_results: 100, "tweet.fields": "entities,public_metrics" },
    });
    const counts = new Map<string, number>();
    for (const t of res.data?.data ?? []) {
      for (const h of t.entities?.hashtags ?? []) bump(counts, `#${h.tag}`);
      for (const c of t.entities?.cashtags ?? []) bump(counts, `$${c.tag.toUpperCase()}`);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, volume]) => ({ name, volume, source: "search" as const }));
  }

  async users(input: { ids: string[] }): Promise<XAccountSummary[]> {
    if (input.ids.length === 0) return [];
    const out: XAccountSummary[] = [];
    for (let i = 0; i < input.ids.length; i += 100) {
      const res = await this.http.request<{
        data?: { id: string; username: string; public_metrics?: { followers_count?: number } }[];
      }>({
        method: "GET",
        path: "/2/users",
        route: "GET /2/users",
        query: { ids: input.ids.slice(i, i + 100).join(","), "user.fields": "public_metrics,username" },
      });
      for (const u of res.data?.data ?? []) {
        out.push({ id: u.id, handle: u.username, followers: u.public_metrics?.followers_count ?? 0 });
      }
    }
    return out;
  }

  /** Monthly budget readout for /status. */
  async budget(): Promise<{ used: number; limit: number; resetsAt: string; paused: boolean }> {
    const s = await this.http.budgetStatus();
    return { used: s.used, limit: s.limit, resetsAt: s.resetsAt, paused: s.paused };
  }

  /* ───────────────────────── DLQ plumbing ───────────────────────── */

  /** Re-executes a dead-lettered write with its original input. */
  async replay(entry: DeadLetter): Promise<unknown> {
    if (entry.accountId !== this.accountId) {
      throw new Error(`x.dlq: entry ${entry.id} belongs to ${entry.accountId}, this client is ${this.accountId}`);
    }
    switch (entry.op) {
      case "post":
        return this.postOnce(entry.input as { text: string; mediaIds?: string[]; replyTo?: string });
      case "thread":
        return this.threadOnce(entry.input as { posts: { text: string; mediaIds?: string[] }[]; replyTo?: string });
      case "uploadMedia":
        return uploadMediaChunked(this.http, entry.input as { url: string; alt?: string }, { ...this.mediaOpts, fetch: this.assetFetch });
      case "updateProfile": {
        const input = entry.input as { avatarUrl?: string; bannerUrl?: string };
        if (input.avatarUrl) await this.v1Profile("update_profile_image", "image", input.avatarUrl);
        if (input.bannerUrl) await this.v1Profile("update_profile_banner", "banner", input.bannerUrl);
        return undefined;
      }
      default:
        throw new Error(`x.dlq: unknown op ${entry.op}`);
    }
  }

  /** Thread without dead-lettering (used on replay so a failure stays on the same entry). */
  private async threadOnce(input: { posts: { text: string; mediaIds?: string[] }[]; replyTo?: string }): Promise<XPost[]> {
    const posted: XPost[] = [];
    let replyTo = input.replyTo;
    for (const p of input.posts) {
      const req: { text: string; mediaIds?: string[]; replyTo?: string } = { text: p.text };
      if (p.mediaIds) req.mediaIds = p.mediaIds;
      if (replyTo) req.replyTo = replyTo;
      const out = await this.postOnce(req);
      posted.push(out);
      replyTo = out.id;
    }
    return posted;
  }

  private async deadLetter(op: string, input: unknown, cause: unknown): Promise<XDeadLettered> {
    const entry = await this.dlq.add({ accountId: this.accountId, op, input, error: cause });
    this.log({ type: "deadLetter", accountId: this.accountId, op, dlqId: entry.id, error: errorMessage(cause) });
    return new XDeadLettered(entry.id, op, cause);
  }
}

/* ───────────────────────── mapping helpers ───────────────────────── */

export function postUrl(id: string, handle: string | undefined): string {
  return handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`;
}

export function toPosts(list: TweetList | null | undefined): XPost[] {
  const users = new Map<string, string>();
  for (const u of list?.includes?.users ?? []) users.set(u.id, u.username);
  return (list?.data ?? []).map((t) => {
    const post: XPost = {
      id: t.id,
      url: postUrl(t.id, t.author_id ? users.get(t.author_id) : undefined),
      text: t.text,
      authorId: t.author_id ?? "",
      createdAt: t.created_at ?? "",
    };
    if (t.public_metrics) {
      const m = t.public_metrics;
      const metrics: NonNullable<XPost["metrics"]> = {
        likes: m.like_count ?? 0,
        reposts: m.retweet_count ?? 0,
        replies: m.reply_count ?? 0,
      };
      if (typeof m.impression_count === "number") metrics.impressions = m.impression_count;
      post.metrics = metrics;
    }
    return post;
  });
}

/** "12.5K posts" → 12500, "1,204 posts" → 1204, 42 → 42. */
export function parseVolume(v: string | number | undefined): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  const m = /([\d.,]+)\s*([KkMm])?/.exec(v);
  if (!m) return undefined;
  const n = Number((m[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  const mult = m[2]?.toUpperCase() === "K" ? 1_000 : m[2]?.toUpperCase() === "M" ? 1_000_000 : 1;
  return Math.round(n * mult);
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}
