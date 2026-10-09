/**
 * Object storage for generated images: S3-compatible (R2, MinIO, AWS) via
 * @aws-sdk/client-s3. Env: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY,
 * S3_PUBLIC_URL (base the bucket is served from), optional S3_REGION (default "auto").
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env, requireEnv } from "../shared";

export interface ObjectStore {
  readonly kind: string;
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<{ url: string }>;
}

export const S3_ENV = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_PUBLIC_URL"] as const;

export interface S3StoreOptions {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicUrl: string;
  region?: string;
  client?: Pick<S3Client, "send">;
}

export function createS3Store(o: S3StoreOptions): ObjectStore {
  const client =
    o.client ??
    new S3Client({
      endpoint: o.endpoint,
      region: o.region ?? "auto",
      forcePathStyle: true,
      credentials: { accessKeyId: o.accessKey, secretAccessKey: o.secretKey },
    });
  const base = o.publicUrl.replace(/\/$/, "");
  return {
    kind: "s3",
    async put({ key, bytes, contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: o.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      return { url: `${base}/${key.split("/").map(encodeURIComponent).join("/")}` };
    },
  };
}

/** Throws NotImplemented listing the missing S3_* vars. */
export function objectStoreFromEnv(): ObjectStore {
  const e = requireEnv("Artist.storage", [...S3_ENV]);
  const region = env("S3_REGION");
  return createS3Store({
    endpoint: e.S3_ENDPOINT!,
    bucket: e.S3_BUCKET!,
    accessKey: e.S3_ACCESS_KEY!,
    secretKey: e.S3_SECRET_KEY!,
    publicUrl: e.S3_PUBLIC_URL!,
    ...(region ? { region } : {}),
  });
}

/** Bytes of a data: or http(s) url. */
export async function fetchBytes(url: string, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) throw new Error("malformed data: url");
    const contentType = m[1] ?? "application/octet-stream";
    const payload = m[3] ?? "";
    const bytes = m[2] ? new Uint8Array(Buffer.from(payload, "base64")) : new TextEncoder().encode(decodeURIComponent(payload));
    return { bytes, contentType };
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get("content-type")?.split(";")[0] ?? "image/png",
  };
}

export function extensionFor(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "png";
}
