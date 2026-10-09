/**
 * OpenAI Images adapter (gpt-image-1 via REST). Needs OPENAI_API_KEY.
 * POST https://api.openai.com/v1/images/generations → data[0].b64_json
 * gpt-image-1 sizes: 1024x1024, 1536x1024 (landscape), 1024x1536 (portrait).
 * The adapter picks the closest orientation; the Artist fits the result to the
 * exact target with sharp when needed.
 */

import { NotImplemented } from "@quantagent/core/types";
import type { ImageAsset } from "@quantagent/core/types";
import type { ImageClient } from "@quantagent/core/types/clients";
import { env } from "../../shared";

export interface OpenAiImageOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function pickOpenAiSize(width: number, height: number): { size: string; width: number; height: number } {
  const ratio = width / height;
  if (ratio > 1.2) return { size: "1536x1024", width: 1536, height: 1024 };
  if (ratio < 0.83) return { size: "1024x1536", width: 1024, height: 1536 };
  return { size: "1024x1024", width: 1024, height: 1024 };
}

export function createOpenAiImageClient(opts: OpenAiImageOptions = {}): ImageClient {
  const apiKey = opts.apiKey ?? env("OPENAI_API_KEY");
  if (!apiKey) throw new NotImplemented("Artist.image.openai", "OPENAI_API_KEY is not set", ["OPENAI_API_KEY"]);
  const model = opts.model ?? env("OPENAI_IMAGE_MODEL") ?? "gpt-image-1";
  const baseUrl = (opts.baseUrl ?? env("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const f = opts.fetch ?? fetch;

  return {
    provider: `openai:${model}`,
    async generate(input): Promise<ImageAsset> {
      const { size, width, height } = pickOpenAiSize(input.width, input.height);
      const res = await f(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: input.prompt, n: 1, size, output_format: "png" }),
      });
      if (!res.ok) throw new Error(`openai images ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { created?: number; data?: { b64_json?: string; url?: string; revised_prompt?: string }[] };
      const first = json.data?.[0];
      if (!first) throw new Error("openai images returned no data");
      const url = first.b64_json ? `data:image/png;base64,${first.b64_json}` : first.url;
      if (!url) throw new Error("openai images returned neither b64_json nor url");
      return { url, kind: input.kind, width, height, externalId: `openai-${json.created ?? Date.now()}` };
    },
  };
}
