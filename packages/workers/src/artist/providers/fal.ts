/**
 * fal.ai adapter. Needs FAL_KEY. Model via FAL_MODEL (default fal-ai/flux/dev).
 * POST https://fal.run/<model> with { prompt, image_size: {width,height}, num_images: 1, seed }
 * → { images: [{ url, width, height }], seed, request_id }
 * `styleRef` of the form "seed:<n>" pins the seed so a set stays consistent.
 */

import { NotImplemented } from "@quantagent/core/types";
import type { ImageAsset } from "@quantagent/core/types";
import type { ImageClient } from "@quantagent/core/types/clients";
import { env } from "../../shared";

export interface FalImageOptions {
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
}

export function seedFromStyleRef(styleRef?: string): number | undefined {
  const m = styleRef?.match(/^seed:(\d+)$/);
  return m ? Number(m[1]) : undefined;
}

export function createFalImageClient(opts: FalImageOptions = {}): ImageClient {
  const apiKey = opts.apiKey ?? env("FAL_KEY");
  if (!apiKey) throw new NotImplemented("Artist.image.fal", "FAL_KEY is not set", ["FAL_KEY"]);
  const model = (opts.model ?? env("FAL_MODEL") ?? "fal-ai/flux/dev").replace(/^\/+/, "");
  const f = opts.fetch ?? fetch;

  return {
    provider: `fal:${model}`,
    async generate(input): Promise<ImageAsset> {
      const seed = seedFromStyleRef(input.styleRef);
      const res = await f(`https://fal.run/${model}`, {
        method: "POST",
        headers: { authorization: `Key ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          prompt: input.prompt,
          image_size: { width: input.width, height: input.height },
          num_images: 1,
          ...(seed !== undefined ? { seed } : {}),
        }),
      });
      if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as {
        images?: { url: string; width?: number; height?: number }[];
        seed?: number;
        request_id?: string;
      };
      const img = json.images?.[0];
      if (!img?.url) throw new Error("fal returned no image");
      return {
        url: img.url,
        kind: input.kind,
        width: img.width ?? input.width,
        height: img.height ?? input.height,
        externalId: json.request_id ?? `fal-seed-${json.seed ?? "unknown"}`,
      };
    },
  };
}
