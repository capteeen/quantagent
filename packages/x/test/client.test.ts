import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import type { XClient } from "@quantagent/core/types/clients";
import { oauth1AccountId, oauth1Header } from "../src/client/oauth1";
import { parseVolume } from "../src/client/xClient";
import { ACCOUNT_ID, buildClient, mockFetch, reply, tweetsOk } from "./helpers";

describe("XApiClient implements XClient", () => {
  it("is assignable to the core contract and scoped to one account", () => {
    const { client } = buildClient({ fetch: mockFetch(tweetsOk()) });
    const c: XClient = client;
    expect(c.accountId).toBe(ACCOUNT_ID);
  });
});

describe("post / thread", () => {
  it("post sends text, media ids and the reply anchor", async () => {
    const fetch = mockFetch(tweetsOk(7));
    const { client } = buildClient({ fetch });
    const p = await client.post({ text: "gm", mediaIds: ["m1", "m2"], replyTo: "5" });
    expect(p).toMatchObject({ id: "7", text: "gm", authorId: ACCOUNT_ID, url: "https://x.com/quantagent/status/7" });
    expect(fetch.calls[0]!.url.toString()).toBe("https://api.x.com/2/tweets");
    expect(fetch.calls[0]!.headers["authorization"]).toBe("Bearer access-token");
    expect(fetch.calls[0]!.body).toEqual({ text: "gm", media: { media_ids: ["m1", "m2"] }, reply: { in_reply_to_tweet_id: "5" } });
  });

  it("thread chains each post to the previous one via in_reply_to_tweet_id", async () => {
    const fetch = mockFetch(tweetsOk(1));
    const { client } = buildClient({ fetch });
    const posts = await client.thread({ posts: [{ text: "1/ hello" }, { text: "2/ CA: pending" }, { text: "3/ end", mediaIds: ["img"] }] });
    expect(posts.map((p) => p.id)).toEqual(["1", "2", "3"]);
    const bodies = fetch.calls.map((c) => c.body);
    expect(bodies[0]).toEqual({ text: "1/ hello" });
    expect(bodies[1]).toEqual({ text: "2/ CA: pending", reply: { in_reply_to_tweet_id: "1" } });
    expect(bodies[2]).toEqual({ text: "3/ end", media: { media_ids: ["img"] }, reply: { in_reply_to_tweet_id: "2" } });
  });
});

describe("reads", () => {
  const list = {
    data: [
      { id: "900", text: "@quantagent wen", author_id: "55", created_at: "2026-10-09T10:00:00.000Z", public_metrics: { like_count: 3, retweet_count: 1, reply_count: 0, impression_count: 120 } },
      { id: "901", text: "gm", author_id: "56", created_at: "2026-10-09T10:01:00.000Z" },
    ],
    includes: { users: [{ id: "55", username: "alice" }] },
    meta: { result_count: 2, newest_id: "901" },
  };

  it("mentions polls the account's mentions with since_id and maps posts", async () => {
    const fetch = mockFetch(() => ({ json: list }));
    const { client } = buildClient({ fetch });
    const posts = await client.mentions({ sinceId: "800" });
    const u = fetch.calls[0]!.url;
    expect(u.pathname).toBe(`/2/users/${ACCOUNT_ID}/mentions`);
    expect(u.searchParams.get("since_id")).toBe("800");
    expect(u.searchParams.get("max_results")).toBe("100");
    expect(u.searchParams.get("expansions")).toBe("author_id");
    expect(posts[0]).toEqual({
      id: "900",
      url: "https://x.com/alice/status/900",
      text: "@quantagent wen",
      authorId: "55",
      createdAt: "2026-10-09T10:00:00.000Z",
      metrics: { likes: 3, reposts: 1, replies: 0, impressions: 120 },
    });
    expect(posts[1]).toEqual({ id: "901", url: "https://x.com/i/web/status/901", text: "gm", authorId: "56", createdAt: "2026-10-09T10:01:00.000Z" });
  });

  it("mentions without sinceId omits the parameter; empty results stay empty", async () => {
    const fetch = mockFetch(() => ({ json: { meta: { result_count: 0 } } }));
    const { client } = buildClient({ fetch });
    expect(await client.mentions({})).toEqual([]);
    expect(fetch.calls[0]!.url.searchParams.has("since_id")).toBe(false);
  });

  it("search hits tweets/search/recent and clamps max_results to X's 10..100", async () => {
    const fetch = mockFetch(() => ({ json: list }));
    const { client } = buildClient({ fetch });
    const r = await client.search({ query: "$QNT -is:retweet", max: 1 });
    const u = fetch.calls[0]!.url;
    expect(u.pathname).toBe("/2/tweets/search/recent");
    expect(u.searchParams.get("query")).toBe("$QNT -is:retweet");
    expect(u.searchParams.get("max_results")).toBe("10");
    expect(r.length).toBe(1);
    await client.search({ query: "x", max: 500 });
    expect(fetch.calls[1]!.url.searchParams.get("max_results")).toBe("100");
  });

  it("users looks up ids in batches with public_metrics", async () => {
    const fetch = mockFetch((call) => ({
      json: { data: (call.url.searchParams.get("ids") ?? "").split(",").map((id) => ({ id, username: `u${id}`, public_metrics: { followers_count: Number(id) * 10 } })) },
    }));
    const { client } = buildClient({ fetch });
    const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
    const users = await client.users({ ids });
    expect(fetch.calls.length).toBe(2);
    expect(users.length).toBe(150);
    expect(users[0]).toEqual({ id: "1", handle: "u1", followers: 10 });
    expect(await client.users({ ids: [] })).toEqual([]);
  });
});

describe("trends", () => {
  it("uses X personalized trends when the tier allows", async () => {
    const fetch = mockFetch(() => ({
      json: { data: [{ category: "Crypto", post_count: "12.5K posts", trend_name: "#solana", trending_since: "x" }, { trend_name: "pump", post_count: "1,204 posts" }] },
    }));
    const { client } = buildClient({ fetch });
    const t = await client.trends();
    expect(fetch.calls[0]!.url.pathname).toBe("/2/users/personalized_trends");
    expect(t).toEqual([
      { name: "#solana", volume: 12_500, source: "personalized_trends", category: "Crypto" },
      { name: "pump", volume: 1204, source: "personalized_trends" },
    ]);
  });

  it("falls back to a search tally marked source=search when personalized trends are not on this tier", async () => {
    const fetch = mockFetch((call) => {
      if (call.url.pathname === "/2/users/personalized_trends") return { status: 403, json: { title: "Client Forbidden" } };
      return {
        json: {
          data: [
            { id: "1", text: "a", entities: { hashtags: [{ tag: "solana" }, { tag: "memecoin" }], cashtags: [{ tag: "sol" }] } },
            { id: "2", text: "b", entities: { hashtags: [{ tag: "solana" }] } },
            { id: "3", text: "c" },
          ],
        },
      };
    });
    const { client } = buildClient({ fetch, client: { trendQuery: "memecoin -is:retweet" } });
    const t = await client.trends();
    expect(fetch.calls[1]!.url.pathname).toBe("/2/tweets/search/recent");
    expect(fetch.calls[1]!.url.searchParams.get("query")).toBe("memecoin -is:retweet");
    expect(t[0]).toEqual({ name: "#solana", volume: 2, source: "search" });
    expect(t.map((x) => x.name)).toEqual(["#solana", "#memecoin", "$SOL"]);
    expect(t.every((x) => x.source === "search")).toBe(true);
  });

  it("parseVolume handles X's human formats", () => {
    expect(parseVolume("12.5K posts")).toBe(12_500);
    expect(parseVolume("2M posts")).toBe(2_000_000);
    expect(parseVolume("1,204 posts")).toBe(1204);
    expect(parseVolume(42)).toBe(42);
    expect(parseVolume(undefined)).toBeUndefined();
  });
});

describe("uploadMedia (v2 chunked)", () => {
  it("runs INIT → APPEND×n → FINALIZE → alt text and returns the media id", async () => {
    const bytes = new Uint8Array(10).map((_, i) => i);
    const assetFetch = mockFetch(() => new Response(bytes, { status: 200, headers: { "content-type": "image/png" } }));
    const fetch = mockFetch((call) => {
      if (call.url.pathname === "/2/media/upload/initialize") return { json: { data: { id: "med1", media_key: "3_med1" } } };
      if (call.url.pathname.endsWith("/finalize")) return { json: { data: { id: "med1" } } };
      return { json: {} };
    });
    const { client } = buildClient({ fetch, assetFetch });
    const r = await client.uploadMedia({ url: "https://cdn.example/logo.png", alt: "the logo" });
    expect(r).toEqual({ mediaId: "med1" });

    const paths = fetch.calls.map((c) => `${c.method} ${c.url.pathname}`);
    expect(paths).toEqual([
      "POST /2/media/upload/initialize",
      "POST /2/media/upload/med1/append",
      "POST /2/media/upload/med1/append",
      "POST /2/media/upload/med1/append",
      "POST /2/media/upload/med1/finalize",
      "POST /2/media/metadata",
    ]);
    expect(fetch.calls[0]!.body).toEqual({ total_bytes: 10, media_type: "image/png", media_category: "tweet_image" });
    const segs = fetch.calls.slice(1, 4).map((c) => (c.rawBody as FormData).get("segment_index"));
    expect(segs).toEqual(["0", "1", "2"]);
    const chunk0 = (fetch.calls[1]!.rawBody as FormData).get("media") as Blob;
    expect(chunk0.size).toBe(4);
    const chunk2 = (fetch.calls[3]!.rawBody as FormData).get("media") as Blob;
    expect(chunk2.size).toBe(2);
    expect(fetch.calls[5]!.body).toEqual({ id: "med1", metadata: { alt_text: { text: "the logo" } } });
  });

  it("polls STATUS while X is processing, then succeeds", async () => {
    const assetFetch = mockFetch(() => new Response(new Uint8Array(3), { headers: { "content-type": "video/mp4" } }));
    let polls = 0;
    const fetch = mockFetch((call) => {
      if (call.url.pathname === "/2/media/upload/initialize") return { json: { data: { id: "v1" } } };
      if (call.url.pathname.endsWith("/finalize")) return { json: { data: { id: "v1", processing_info: { state: "pending", check_after_secs: 2 } } } };
      if (call.url.searchParams.get("command") === "STATUS") {
        polls++;
        return { json: { data: { id: "v1", processing_info: { state: polls < 2 ? "in_progress" : "succeeded", check_after_secs: 1 } } } };
      }
      return { json: {} };
    });
    const { client, clock } = buildClient({ fetch, assetFetch });
    await client.uploadMedia({ url: "https://cdn.example/clip.mp4" });
    expect(polls).toBe(2);
    expect(clock.sleeps).toEqual([2000, 1000]);
    expect(fetch.calls[0]!.body).toMatchObject({ media_category: "tweet_video" });
  });

  it("a failed asset download is a visible error, not an empty upload", async () => {
    const assetFetch = mockFetch(() => ({ status: 404, text: "" }));
    const fetch = mockFetch(() => ({ json: {} }));
    const { client, dlq } = buildClient({ fetch, assetFetch });
    await expect(client.uploadMedia({ url: "https://cdn.example/missing.png" })).rejects.toMatchObject({ name: "XDeadLettered" });
    expect(fetch.calls.length).toBe(0);
    expect((await dlq.list())[0]?.error).toMatch(/HTTP 404/);
  });
});

describe("updateProfile (v1.1)", () => {
  const png = () => mockFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));

  it("posts base64 image/banner to the v1.1 endpoints with the bearer token", async () => {
    const fetch = mockFetch(() => ({ json: {} }));
    const { client } = buildClient({ fetch, assetFetch: png() });
    await client.updateProfile({ avatarUrl: "https://cdn/a.png", bannerUrl: "https://cdn/b.png" });
    expect(fetch.calls.map((c) => c.url.toString())).toEqual([
      "https://api.x.com/1.1/account/update_profile_image.json",
      "https://api.x.com/1.1/account/update_profile_banner.json",
    ]);
    expect((fetch.calls[0]!.body as URLSearchParams).get("image")).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    expect((fetch.calls[1]!.body as URLSearchParams).get("banner")).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    expect(fetch.calls[0]!.headers["authorization"]).toBe("Bearer access-token");
  });

  it("when X refuses the OAuth 2.0 token it throws NotImplemented naming the X_OAUTH1_* variables", async () => {
    const fetch = mockFetch(() => ({ status: 403, json: { errors: [{ message: "forbidden" }] } }));
    const { client, dlq } = buildClient({ fetch, assetFetch: png() });
    const err = await client.updateProfile({ avatarUrl: "https://cdn/a.png" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotImplemented);
    expect((err as NotImplemented).needs).toEqual([
      "X_OAUTH1_CONSUMER_KEY",
      "X_OAUTH1_CONSUMER_SECRET",
      "X_OAUTH1_ACCESS_TOKEN",
      "X_OAUTH1_ACCESS_TOKEN_SECRET",
    ]);
    expect(await dlq.list()).toEqual([]);
  });

  it("signs with OAuth 1.0a when credentials for the connected account are configured", async () => {
    const fetch = mockFetch(() => ({ json: {} }));
    const creds = { consumerKey: "ck", consumerSecret: "cs", accessToken: `${ACCOUNT_ID}-abc`, accessTokenSecret: "ts" };
    const { client } = buildClient({ fetch, assetFetch: png(), client: { oauth1: creds } });
    await client.updateProfile({ avatarUrl: "https://cdn/a.png" });
    expect(fetch.calls[0]!.headers["authorization"]).toMatch(/^OAuth oauth_consumer_key="ck"/);
    expect(fetch.calls[0]!.headers["authorization"]).toContain('oauth_token="1234567890-abc"');
  });

  it("refuses OAuth 1.0a credentials that belong to a different account", async () => {
    const fetch = mockFetch(() => ({ json: {} }));
    const creds = { consumerKey: "ck", consumerSecret: "cs", accessToken: "999-abc", accessTokenSecret: "ts" };
    const { client } = buildClient({ fetch, assetFetch: png(), client: { oauth1: creds } });
    await expect(client.updateProfile({ avatarUrl: "https://cdn/a.png" })).rejects.toBeInstanceOf(NotImplemented);
    expect(fetch.calls.length).toBe(0);
  });
});

describe("OAuth 1.0a signing", () => {
  it("reproduces the X developer docs signature vector", () => {
    const header = oauth1Header(
      {
        consumerKey: "xvz1evFS4wEEPTGEFPHBog",
        consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      {
        method: "POST",
        url: "https://api.twitter.com/1.1/statuses/update.json",
        params: { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
        nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        timestamp: 1318622958,
      },
    );
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
    expect(oauth1AccountId({ consumerKey: "", consumerSecret: "", accessToken: "370773112-Gm", accessTokenSecret: "" })).toBe("370773112");
  });
});

describe("empty states", () => {
  it("never invents posts: a 200 with no data is an empty list", async () => {
    const { client } = buildClient({ fetch: mockFetch(() => reply({ json: {} })) });
    expect(await client.search({ query: "x" })).toEqual([]);
    expect(await client.trends()).toEqual([]);
  });
});
