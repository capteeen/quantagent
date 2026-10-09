/**
 * X API v2 chunked media upload:
 *   POST /2/media/upload/initialize           {total_bytes, media_type, media_category}
 *   POST /2/media/upload/{id}/append          multipart: media (chunk), segment_index
 *   POST /2/media/upload/{id}/finalize
 *   GET  /2/media/upload?command=STATUS&media_id=  (while processing_info says so)
 *   POST /2/media/metadata                    alt text
 *
 * The bytes come from the asset url the Artist produced; they are fetched
 * here, never trusted to be on disk.
 */
import { XApiError } from "../errors";
import type { FetchLike } from "../oauth/oauth";
import type { XHttp } from "./http";

export const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;

export interface MediaUploadOptions {
  /** Bytes per APPEND segment. X accepts up to 5 MB. */
  chunkBytes?: number;
  /** Fetch used to download the source asset (defaults to global fetch). */
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Max STATUS polls while X processes video/gif. Default 30. */
  maxStatusPolls?: number;
}

export type MediaCategory = "tweet_image" | "tweet_gif" | "tweet_video";

export function mediaCategoryFor(contentType: string): MediaCategory {
  const ct = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (ct === "image/gif") return "tweet_gif";
  if (ct.startsWith("image/")) return "tweet_image";
  if (ct.startsWith("video/")) return "tweet_video";
  throw new Error(`x.uploadMedia: unsupported content-type "${contentType}"`);
}

const EXT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

export function guessContentType(url: string, headerValue: string | null): string {
  if (headerValue && headerValue !== "application/octet-stream" && headerValue !== "binary/octet-stream") {
    return headerValue;
  }
  const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
  const t = EXT_TYPES[ext];
  if (!t) throw new Error(`x.uploadMedia: cannot determine media type of ${url}`);
  return t;
}

export interface DownloadedAsset {
  bytes: Uint8Array;
  contentType: string;
}

export async function downloadAsset(url: string, fetchImpl: FetchLike): Promise<DownloadedAsset> {
  const res = await fetchImpl(url, { method: "GET" });
  if (!res.ok) throw new Error(`x.uploadMedia: fetching ${url} failed with HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`x.uploadMedia: ${url} returned 0 bytes`);
  return { bytes, contentType: guessContentType(url, res.headers.get("content-type")) };
}

interface MediaData {
  data?: { id?: string; media_key?: string; processing_info?: { state?: string; check_after_secs?: number; error?: { message?: string } } };
}

/** Runs INIT → APPEND* → FINALIZE (→ STATUS*) (→ alt text). Returns the media id for POST /2/tweets. */
export async function uploadMediaChunked(
  http: XHttp,
  input: { url: string; alt?: string },
  opts: MediaUploadOptions = {},
): Promise<{ mediaId: string }> {
  const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const asset = await downloadAsset(input.url, opts.fetch ?? fetch);
  const category = mediaCategoryFor(asset.contentType);

  const init = await http.request<MediaData>({
    method: "POST",
    path: "/2/media/upload/initialize",
    route: "POST /2/media/upload/initialize",
    json: { total_bytes: asset.bytes.byteLength, media_type: asset.contentType, media_category: category },
  });
  const mediaId = init.data?.data?.id;
  if (!mediaId) throw new XApiError(init.status, "POST /2/media/upload/initialize", init.data, init.headers);

  let segment = 0;
  for (let offset = 0; offset < asset.bytes.byteLength; offset += chunkBytes) {
    const chunk = asset.bytes.slice(offset, Math.min(offset + chunkBytes, asset.bytes.byteLength));
    const form = new FormData();
    form.set("segment_index", String(segment));
    form.set("media", new Blob([chunk], { type: asset.contentType }), `segment-${segment}`);
    await http.request({
      method: "POST",
      path: `/2/media/upload/${mediaId}/append`,
      route: "POST /2/media/upload/:id/append",
      body: form,
    });
    segment += 1;
  }

  const fin = await http.request<MediaData>({
    method: "POST",
    path: `/2/media/upload/${mediaId}/finalize`,
    route: "POST /2/media/upload/:id/finalize",
  });

  let info = fin.data?.data?.processing_info;
  let polls = 0;
  const maxPolls = opts.maxStatusPolls ?? 30;
  while (info && info.state && info.state !== "succeeded") {
    if (info.state === "failed") {
      throw new Error(`x.uploadMedia: X failed to process media ${mediaId}: ${info.error?.message ?? "unknown"}`);
    }
    if (polls++ >= maxPolls) throw new Error(`x.uploadMedia: media ${mediaId} still processing after ${maxPolls} polls`);
    await sleep((info.check_after_secs ?? 1) * 1000);
    const st = await http.request<MediaData>({
      method: "GET",
      path: "/2/media/upload",
      route: "GET /2/media/upload (STATUS)",
      query: { command: "STATUS", media_id: mediaId },
    });
    info = st.data?.data?.processing_info;
  }

  if (input.alt) {
    await http.request({
      method: "POST",
      path: "/2/media/metadata",
      route: "POST /2/media/metadata",
      json: { id: mediaId, metadata: { alt_text: { text: input.alt.slice(0, 1000) } } },
    });
  }
  return { mediaId };
}
