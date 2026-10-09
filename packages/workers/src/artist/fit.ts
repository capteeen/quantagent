/**
 * Fits provider output to the exact target size (cover-crop) with sharp when the
 * provider could not render that size. If sharp is unavailable the bytes are kept
 * as generated and the real dimensions are reported; nothing is substituted.
 */

export interface Fitted {
  bytes: Uint8Array;
  width: number;
  height: number;
  contentType: string;
  fitted: boolean;
}

type Sharp = typeof import("sharp");
let sharpPromise: Promise<Sharp | null> | undefined;

async function loadSharp(): Promise<Sharp | null> {
  if (!sharpPromise) {
    sharpPromise = import("sharp")
      .then((m) => (m as unknown as { default?: Sharp }).default ?? (m as unknown as Sharp))
      .catch(() => null);
  }
  return sharpPromise;
}

export async function fitImage(
  bytes: Uint8Array,
  contentType: string,
  reported: { width: number; height: number },
  target: { width: number; height: number },
): Promise<Fitted> {
  const sharp = await loadSharp();
  if (!sharp) return { bytes, width: reported.width, height: reported.height, contentType, fitted: false };
  const img = sharp(Buffer.from(bytes));
  const meta = await img.metadata();
  const width = meta.width ?? reported.width;
  const height = meta.height ?? reported.height;
  if (width === target.width && height === target.height) return { bytes, width, height, contentType, fitted: false };
  const out = await img.resize(target.width, target.height, { fit: "cover", position: "attention" }).png().toBuffer();
  return { bytes: new Uint8Array(out), width: target.width, height: target.height, contentType: "image/png", fitted: true };
}
