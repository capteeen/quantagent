/**
 * Replicate adapter. Needs REPLICATE_API_TOKEN. Model via REPLICATE_MODEL
 * (default black-forest-labs/flux-schnell).
 * POST https://api.replicate.com/v1/models/<owner>/<name>/predictions with
 * header `Prefer: wait` and { input: { prompt, aspect_ratio, seed } }; polls
 * `urls.get` until status is succeeded/failed/canceled.
 */

import { NotImplemented } from "@quantagent/core/types";
import type { ImageAsset } from "@quantagent/core/types";
import type { ImageClient } from "@quantagent/core/types/clients";
import { env, sleep } from "../../shared";
import { seedFromStyleRef } from "./fal";

export interface ReplicateImageOptions {
  apiToken?: string;
  model?: string;
  fetch?: typeof fetch;
  pollMs?: number;
  maxWaitMs?: number;
}

export function aspectRatioFor(width: number, height: number): string {
  const r = width / height;
  if (r >= 2.8) return "3:1";
  if (r >= 1.6) return "16:9";
  if (r >= 1.2) return "3:2";
  if (r <= 0.36) return "1:3";
  if (r <= 0.63) return "9:16";
  if (r <= 0.83) return "2:3";
  return "1:1";
}

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[];
  error?: string | null;
  urls?: { get?: string };
}

export function createReplicateImageClient(opts: ReplicateImageOptions = {}): ImageClient {
  const token = opts.apiToken ?? env("REPLICATE_API_TOKEN");
  if (!token) throw new NotImplemented("Artist.image.replicate", "REPLICATE_API_TOKEN is not set", ["REPLICATE_API_TOKEN"]);
  const model = opts.model ?? env("REPLICATE_MODEL") ?? "black-forest-labs/flux-schnell";
  const f = opts.fetch ?? fetch;
  const pollMs = opts.pollMs ?? 1500;
  const maxWaitMs = opts.maxWaitMs ?? 120_000;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  return {
    provider: `replicate:${model}`,
    async generate(input): Promise<ImageAsset> {
      const seed = seedFromStyleRef(input.styleRef);
      const res = await f(`https://api.replicate.com/v1/models/${model}/predictions`, {
        method: "POST",
        headers: { ...headers, prefer: "wait" },
        body: JSON.stringify({
          input: {
            prompt: input.prompt,
            aspect_ratio: aspectRatioFor(input.width, input.height),
            num_outputs: 1,
            output_format: "png",
            ...(seed !== undefined ? { seed } : {}),
          },
        }),
      });
      if (!res.ok) throw new Error(`replicate ${res.status}: ${(await res.text()).slice(0, 300)}`);
      let pred = (await res.json()) as Prediction;
      const t0 = Date.now();
      while (pred.status === "starting" || pred.status === "processing") {
        if (Date.now() - t0 > maxWaitMs) throw new Error(`replicate prediction ${pred.id} still ${pred.status} after ${maxWaitMs}ms`);
        if (!pred.urls?.get) throw new Error(`replicate prediction ${pred.id} has no poll url`);
        await sleep(pollMs);
        const poll = await f(pred.urls.get, { headers });
        if (!poll.ok) throw new Error(`replicate poll ${poll.status}`);
        pred = (await poll.json()) as Prediction;
      }
      if (pred.status !== "succeeded") throw new Error(`replicate prediction ${pred.id} ${pred.status}: ${pred.error ?? "no error text"}`);
      const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      if (!url) throw new Error(`replicate prediction ${pred.id} succeeded without output`);
      return { url, kind: input.kind, width: input.width, height: input.height, externalId: pred.id };
    },
  };
}
