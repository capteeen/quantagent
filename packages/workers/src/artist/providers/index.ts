/**
 * Image provider selection. IMAGE_PROVIDER=openai|fal|replicate picks the adapter;
 * each adapter throws NotImplemented naming its key when it is missing.
 */

import { NotImplemented } from "@quantagent/core/types";
import type { ImageClient } from "@quantagent/core/types/clients";
import { env } from "../../shared";
import { createFalImageClient } from "./fal";
import { createOpenAiImageClient } from "./openai";
import { createReplicateImageClient } from "./replicate";

export const IMAGE_PROVIDERS = ["openai", "fal", "replicate"] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

export const IMAGE_PROVIDER_KEYS: Record<ImageProvider, string> = {
  openai: "OPENAI_API_KEY",
  fal: "FAL_KEY",
  replicate: "REPLICATE_API_TOKEN",
};

export function imageClientFromEnv(opts: { provider?: string; fetch?: typeof fetch } = {}): ImageClient {
  const provider = opts.provider ?? env("IMAGE_PROVIDER");
  if (!provider) {
    throw new NotImplemented("Artist.image", "IMAGE_PROVIDER is not set", [
      "IMAGE_PROVIDER=openai|fal|replicate",
      ...IMAGE_PROVIDERS.map((p) => IMAGE_PROVIDER_KEYS[p]),
    ]);
  }
  const fetchOpt = opts.fetch ? { fetch: opts.fetch } : {};
  switch (provider) {
    case "openai":
      return createOpenAiImageClient(fetchOpt);
    case "fal":
      return createFalImageClient(fetchOpt);
    case "replicate":
      return createReplicateImageClient(fetchOpt);
    default:
      throw new NotImplemented("Artist.image", `IMAGE_PROVIDER "${provider}" is not one of ${IMAGE_PROVIDERS.join("|")}`, [
        "IMAGE_PROVIDER=openai|fal|replicate",
      ]);
  }
}

export { createFalImageClient, createOpenAiImageClient, createReplicateImageClient };
