import { describe, expect, it } from "vitest";
import type { Identity } from "@quantagent/core/types";
import { createArtist } from "./artist";
import { assertContentOk, checkContent, ContentRuleViolation } from "./rules";
import { hammingDistance, phashFromBytes, phashFromGray, phashSimilarity, PHASH_SIZE } from "./phash";
import { extensionFor, fetchBytes, type ObjectStore } from "./storage";
import { bannerBrief, characterBrief, logoCandidateBrief, namedLogoBrief, STYLE_DIRECTIONS } from "./briefs";
import { fakeImage, harness, TINY_PNG } from "../testing/fakes";

const IDENTITY: Identity = { name: "Qubit Cat", ticker: "QCAT", lore: "two boxes", hook: "based", trend: "none" };

function memoryStore(): ObjectStore & { objects: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    kind: "memory",
    objects,
    async put({ key, bytes, contentType }) {
      objects.set(key, { bytes, contentType });
      return { url: `https://cdn.test/${key}` };
    },
  };
}

describe("Artist content rules (in code)", () => {
  it("blocks real people, protected brands, sexual and violent briefs", () => {
    expect(checkContent("a cute cat astronaut").ok).toBe(true);
    expect(checkContent("Elon Musk as a cat").violations[0]).toMatch(/real person/);
    expect(checkContent("a photo of a famous person").violations.join()).toMatch(/depict a real person/);
    expect(checkContent("pikachu in a lab").violations[0]).toMatch(/protected brand/);
    expect(checkContent("a nude cat").violations[0]).toMatch(/sexual/);
    expect(checkContent("a cat with a gun").violations[0]).toMatch(/violent/);
    expect(() => assertContentOk("spongebob")).toThrow(ContentRuleViolation);
  });
  it("every brief carries the safety suffix", () => {
    for (const b of [logoCandidateBrief("cat", STYLE_DIRECTIONS[0]!), namedLogoBrief("cat", IDENTITY, "x"), bannerBrief("cat", IDENTITY, "x"), characterBrief("cat", IDENTITY, "x", 3)]) {
      expect(b).toMatch(/No real people/);
    }
  });
});

describe("pHash", () => {
  it("is deterministic, 16 hex chars, and distinguishes different images", () => {
    const n = PHASH_SIZE * PHASH_SIZE;
    const gradient = Array.from({ length: n }, (_, i) => (i % PHASH_SIZE) * 8);
    const checker = Array.from({ length: n }, (_, i) => ((Math.floor(i / PHASH_SIZE) + i) % 2) * 255);
    const a = phashFromGray(gradient);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(phashFromGray(gradient)).toBe(a);
    expect(hammingDistance(a, a)).toBe(0);
    expect(phashSimilarity(a, a)).toBe(1);
    expect(hammingDistance(a, phashFromGray(checker))).toBeGreaterThan(8);
    expect(() => phashFromGray([1, 2, 3])).toThrow(/expects/);
  });
  it("hashes real PNG bytes through the decoder", async () => {
    const h = await phashFromBytes(new Uint8Array(TINY_PNG));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("storage helpers", () => {
  it("decodes data: urls and maps content types to extensions", async () => {
    const { bytes, contentType } = await fetchBytes(`data:image/png;base64,${TINY_PNG.toString("base64")}`);
    expect(contentType).toBe("image/png");
    expect(Buffer.from(bytes).equals(TINY_PNG)).toBe(true);
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/webp")).toBe("webp");
    expect(extensionFor("image/png")).toBe("png");
  });
});

describe("ArtistWorker", () => {
  it("candidates from the prompt → collapse → re-render on Ideator.named → logo, banner, 6–12 images", async () => {
    const image = fakeImage();
    const store = memoryStore();
    const h = harness(createArtist({ store, characterCount: 6, logoCandidates: 3 }), { prompt: "a cat that runs a quantum lab", clients: { image } });
    const finished = h.start();
    const cands = await h.waitFor("Worker.candidates");
    expect(cands.worker).toBe("Artist");
    expect(cands.payload.candidates).toHaveLength(3);
    expect(cands.payload.candidates.every((c) => c.thumbnailUrl?.startsWith("https://cdn.test/"))).toBe(true);
    // nothing with the name yet: every call so far was prompt-only
    expect(image.calls.every((c) => !c.prompt.includes("QCAT"))).toBe(true);
    h.collapse("Artist", 1);
    expect(h.ofType("Artist.logoReady")).toHaveLength(0);
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity: IDENTITY } });
    expect(await finished).toBe("done");

    const logo = h.ofType("Artist.logoReady")[0]!;
    expect(logo.payload.asset.kind).toBe("logo");
    expect(logo.payload.asset.url).toMatch(/^https:\/\/cdn\.test\/launch-test-0001\/logo-/);
    expect(logo.payload.asset.phash).toMatch(/^[0-9a-f]{16}$/);
    expect(logo.reason).toMatch(/QCAT/);
    const named = image.calls.find((c) => c.prompt.includes("Qubit Cat"));
    expect(named?.styleRef).toBe(cands.payload.candidates[1]!.thumbnailUrl);
    expect(h.ofType("Artist.bannerReady")).toHaveLength(1);
    expect(h.ofType("Artist.bannerReady")[0]!.payload.asset.kind).toBe("banner");
    expect(h.ofType("Artist.imageReady")).toHaveLength(6);
    expect(h.ofType("Artist.generationFailed")).toHaveLength(0);
    expect(store.objects.size).toBe(3 + 1 + 1 + 6);
    const done = h.ofType("Worker.done")[0]!;
    expect((done.payload.outputs as { images: unknown[] }).images).toHaveLength(6);
    expect(h.events.every((e) => e.reason.length > 0)).toBe(true);
    // banner is fitted to 1500x500 by sharp
    expect(h.ofType("Artist.bannerReady")[0]!.payload.asset.width).toBe(1500);
    await h.stop();
  });

  it("logs a failed generation as Artist.generationFailed and never replaces it", async () => {
    const image = fakeImage({ fail: (input) => (input.kind === "banner" || input.prompt.includes("image 2:") ? "provider 500" : undefined) });
    const h = harness(createArtist({ store: memoryStore(), characterCount: 6, logoCandidates: 2 }), { clients: { image } });
    const finished = h.start();
    await h.waitFor("Worker.candidates");
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity: IDENTITY } });
    h.collapse("Artist");
    expect(await finished).toBe("done");
    expect(h.ofType("Artist.bannerReady")).toHaveLength(0);
    expect(h.ofType("Artist.imageReady")).toHaveLength(5);
    const failed = h.ofType("Artist.generationFailed");
    expect(failed).toHaveLength(2);
    expect(failed.every((f) => f.reason.includes("no replacement image") && f.payload.error.includes("provider 500"))).toBe(true);
    const outputs = h.ofType("Worker.done")[0]!.payload.outputs as { banner: unknown; failed: unknown[] };
    expect(outputs.banner).toBeNull();
    expect(outputs.failed).toHaveLength(2);
    await h.stop();
  });

  it("never calls the provider when the prompt breaks content rules", async () => {
    const image = fakeImage();
    const h = harness(createArtist({ store: memoryStore() }), { prompt: "spiderman but naked", clients: { image } });
    expect(await h.start()).toBe("failed");
    expect(image.calls).toHaveLength(0);
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/ContentRuleViolation/);
    await h.stop();
  });

  it("fails with NotImplemented naming IMAGE_PROVIDER keys when no image client is wired", async () => {
    const h = harness(createArtist({ store: memoryStore() }), { clients: {} });
    expect(await h.start()).toBe("failed");
    expect(h.ofType("Worker.failed")[0]!.reason).toMatch(/IMAGE_PROVIDER/);
    await h.stop();
  });

  it("fails with NotImplemented naming S3_* vars when storage is not configured", async () => {
    const saved = { ...process.env };
    for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_PUBLIC_URL"]) delete process.env[k];
    try {
      const h = harness(createArtist(), { clients: { image: fakeImage() } });
      expect(await h.start()).toBe("failed");
      const reason = h.ofType("Worker.failed")[0]!.reason;
      expect(reason).toMatch(/NotImplemented/);
      expect(reason).toMatch(/S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_PUBLIC_URL/);
      await h.stop();
    } finally {
      process.env = saved;
    }
  });

  it("renders one image on Voice.needsImage and Builder.needsAsset after launch, rules still enforced", async () => {
    const image = fakeImage();
    const h = harness(createArtist({ store: memoryStore(), characterCount: 6, logoCandidates: 2 }), { clients: { image } });
    const finished = h.start();
    await h.waitFor("Worker.candidates");
    h.collapse("Artist");
    h.emit({ type: "Ideator.named", reason: "test", payload: { identity: IDENTITY } });
    await finished;
    const before = h.ofType("Artist.imageReady").length;
    h.emit({ type: "Voice.needsImage", reason: "test", payload: { brief: "mascot drinking coffee at dawn" } });
    h.emit({ type: "Builder.needsAsset", reason: "test", payload: { brief: "mascot with a gun" } });
    await h.settle();
    expect(h.ofType("Artist.imageReady")).toHaveLength(before + 1);
    expect(h.ofType("Artist.generationFailed").at(-1)!.payload.error).toMatch(/violent/);
    expect(h.run.status).toBe("done");
    await h.stop();
  });
});
