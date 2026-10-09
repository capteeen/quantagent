import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import { imageClientFromEnv } from "./index";
import { createOpenAiImageClient, pickOpenAiSize } from "./openai";
import { createFalImageClient, seedFromStyleRef } from "./fal";
import { aspectRatioFor, createReplicateImageClient } from "./replicate";
import { fetchStub, TINY_PNG } from "../../testing/fakes";

const REQ = { prompt: "a cat", kind: "logo" as const, width: 1024, height: 1024 };

describe("provider selection", () => {
  it("throws NotImplemented naming IMAGE_PROVIDER and every key when unset", () => {
    const saved = process.env.IMAGE_PROVIDER;
    delete process.env.IMAGE_PROVIDER;
    try {
      expect(() => imageClientFromEnv()).toThrow(NotImplemented);
      try {
        imageClientFromEnv();
      } catch (e) {
        expect((e as NotImplemented).needs).toEqual(["IMAGE_PROVIDER=openai|fal|replicate", "OPENAI_API_KEY", "FAL_KEY", "REPLICATE_API_TOKEN"]);
      }
    } finally {
      if (saved !== undefined) process.env.IMAGE_PROVIDER = saved;
    }
  });
  it("each adapter throws NotImplemented with its own key when the key is missing", () => {
    const saved = { ...process.env };
    delete process.env.OPENAI_API_KEY;
    delete process.env.FAL_KEY;
    delete process.env.REPLICATE_API_TOKEN;
    try {
      for (const [provider, key] of [["openai", "OPENAI_API_KEY"], ["fal", "FAL_KEY"], ["replicate", "REPLICATE_API_TOKEN"]] as const) {
        try {
          imageClientFromEnv({ provider });
          expect.fail("should throw");
        } catch (e) {
          expect(e).toBeInstanceOf(NotImplemented);
          expect((e as NotImplemented).needs).toEqual([key]);
        }
      }
      expect(() => imageClientFromEnv({ provider: "midjourney" })).toThrow(/not one of/);
    } finally {
      process.env = saved;
    }
  });
});

describe("openai adapter", () => {
  it("maps sizes to gpt-image-1 orientations", () => {
    expect(pickOpenAiSize(1024, 1024).size).toBe("1024x1024");
    expect(pickOpenAiSize(1500, 500).size).toBe("1536x1024");
    expect(pickOpenAiSize(500, 1500).size).toBe("1024x1536");
  });
  it("posts to /images/generations with the bearer key and returns a data: url from b64_json", async () => {
    const stub = fetchStub([{ match: "/images/generations", body: { created: 123, data: [{ b64_json: TINY_PNG.toString("base64") }] } }]);
    const client = createOpenAiImageClient({ apiKey: "sk-test", fetch: stub.fetch });
    const asset = await client.generate({ ...REQ, width: 1500, height: 500 });
    expect(stub.calls[0]!.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(stub.calls[0]!.body as string);
    expect(body).toMatchObject({ model: "gpt-image-1", size: "1536x1024", n: 1 });
    expect(asset.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(asset.externalId).toBe("openai-123");
    expect(asset.width).toBe(1536);
  });
  it("surfaces provider errors", async () => {
    const stub = fetchStub([{ match: "/images/generations", status: 429, body: "rate limited" }]);
    await expect(createOpenAiImageClient({ apiKey: "k", fetch: stub.fetch }).generate(REQ)).rejects.toThrow(/429/);
  });
});

describe("fal adapter", () => {
  it("posts to fal.run/<model> with Key auth, pins the seed from styleRef", async () => {
    const stub = fetchStub([{ match: "fal.run/fal-ai/flux/dev", body: { images: [{ url: "https://fal.media/x.png", width: 1024, height: 1024 }], seed: 7, request_id: "req-1" } }]);
    const client = createFalImageClient({ apiKey: "fal-test", fetch: stub.fetch });
    const asset = await client.generate({ ...REQ, styleRef: "seed:7" });
    expect(stub.calls[0]!.headers.authorization).toBe("Key fal-test");
    expect(JSON.parse(stub.calls[0]!.body as string)).toMatchObject({ prompt: "a cat", image_size: { width: 1024, height: 1024 }, seed: 7 });
    expect(asset).toMatchObject({ url: "https://fal.media/x.png", externalId: "req-1" });
    expect(seedFromStyleRef("https://cdn/x.png")).toBeUndefined();
  });
});

describe("replicate adapter", () => {
  it("creates a prediction with Prefer: wait and polls until succeeded", async () => {
    let polls = 0;
    const stub = fetchStub([
      { match: "/predictions", body: { id: "p1", status: "processing", urls: { get: "https://api.replicate.com/v1/poll/p1" } } },
      { match: "/poll/p1", body: { id: "p1", status: "succeeded", output: ["https://replicate.delivery/x.png"] } },
    ]);
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/poll/")) polls++;
      return stub.fetch(input, init);
    }) as typeof fetch;
    const client = createReplicateImageClient({ apiToken: "r8-test", fetch: f, pollMs: 1 });
    const asset = await client.generate({ ...REQ, width: 1500, height: 500 });
    expect(stub.calls[0]!.headers.authorization).toBe("Bearer r8-test");
    expect(stub.calls[0]!.headers.prefer).toBe("wait");
    expect(JSON.parse(stub.calls[0]!.body as string).input.aspect_ratio).toBe("3:1");
    expect(polls).toBe(1);
    expect(asset).toMatchObject({ url: "https://replicate.delivery/x.png", externalId: "p1" });
    expect(aspectRatioFor(1024, 1024)).toBe("1:1");
  });
  it("fails a failed prediction with its error", async () => {
    const stub = fetchStub([{ match: "/predictions", body: { id: "p2", status: "failed", error: "NSFW" } }]);
    await expect(createReplicateImageClient({ apiToken: "k", fetch: stub.fetch }).generate(REQ)).rejects.toThrow(/NSFW/);
  });
});
