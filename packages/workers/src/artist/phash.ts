/**
 * DCT perceptual hash (pHash): 32×32 grayscale → 2D DCT → top-left 8×8 (DC excluded)
 * → bits above the median → 64-bit hex string. The Shield compares logos with it.
 *
 * Decoding uses `sharp`; if sharp failed to install (native binary), `jimp` is tried;
 * if neither is available the hash is NotImplemented, never faked.
 */

import { NotImplemented } from "@quantagent/core/types";

export const PHASH_SIZE = 32;
export const PHASH_LOW = 8;

/** Pure: 1024 gray values (row-major, 0–255) → 16 hex chars. */
export function phashFromGray(gray: ArrayLike<number>): string {
  const n = PHASH_SIZE;
  if (gray.length !== n * n) throw new Error(`phashFromGray expects ${n * n} values, got ${gray.length}`);
  const dct = dct2d(gray, n);
  const vals: number[] = [];
  for (let y = 0; y < PHASH_LOW; y++) {
    for (let x = 0; x < PHASH_LOW; x++) {
      if (x === 0 && y === 0) continue; // drop the DC term
      vals.push(dct[y * n + x] as number);
    }
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const median = (sorted[Math.floor(sorted.length / 2) - 1]! + sorted[Math.floor(sorted.length / 2)]!) / 2;
  let bits = 0n;
  // 63 AC coefficients + the DC slot (always 0) = 64 bits
  bits <<= 1n; // DC slot
  for (const v of vals) bits = (bits << 1n) | (v > median ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

/** Hamming distance between two hex hashes (0 = identical, 64 = opposite). */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let d = 0;
  while (x) {
    d += Number(x & 1n);
    x >>= 1n;
  }
  return d;
}

/** 0–1 similarity derived from the Hamming distance. */
export function phashSimilarity(a: string, b: string): number {
  return 1 - hammingDistance(a, b) / 64;
}

function dct2d(src: ArrayLike<number>, n: number): Float64Array {
  const cos = new Float64Array(n * n);
  for (let u = 0; u < n; u++) for (let x = 0; x < n; x++) cos[u * n + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n));
  const alpha = (u: number) => (u === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n));
  // rows
  const tmp = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let u = 0; u < n; u++) {
      let s = 0;
      for (let x = 0; x < n; x++) s += (src[y * n + x] as number) * (cos[u * n + x] as number);
      tmp[y * n + u] = alpha(u) * s;
    }
  }
  // cols
  const out = new Float64Array(n * n);
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      let s = 0;
      for (let y = 0; y < n; y++) s += (tmp[y * n + u] as number) * (cos[v * n + y] as number);
      out[v * n + u] = alpha(v) * s;
    }
  }
  return out;
}

type GrayDecoder = (bytes: Uint8Array) => Promise<Uint8Array>;
let decoder: GrayDecoder | undefined;

/** Loads sharp, else jimp, else throws NotImplemented. Cached after first success. */
export async function loadGrayDecoder(): Promise<GrayDecoder> {
  if (decoder) return decoder;
  const errors: string[] = [];
  try {
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default;
    decoder = async (bytes) => {
      const buf = await sharp(Buffer.from(bytes)).resize(PHASH_SIZE, PHASH_SIZE, { fit: "fill" }).grayscale().raw().toBuffer();
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    };
    return decoder;
  } catch (err) {
    errors.push(`sharp: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const modName = "jimp"; // variable so TypeScript does not require the optional module to resolve
    const jimpMod = (await import(modName)) as { Jimp?: JimpLike; default?: JimpLike };
    const Jimp = jimpMod.Jimp ?? jimpMod.default;
    if (!Jimp) throw new Error("jimp module has no Jimp export");
    decoder = async (bytes) => {
      const img = await Jimp.read(Buffer.from(bytes));
      img.resize({ w: PHASH_SIZE, h: PHASH_SIZE }).greyscale();
      const out = new Uint8Array(PHASH_SIZE * PHASH_SIZE);
      const data = img.bitmap.data;
      for (let i = 0; i < out.length; i++) out[i] = data[i * 4] as number;
      return out;
    };
    return decoder;
  } catch (err) {
    errors.push(`jimp: ${err instanceof Error ? err.message : String(err)}`);
  }
  throw new NotImplemented("Artist.phash", `no image decoder available (${errors.join("; ")})`, [
    "pnpm add sharp (native) or pnpm add jimp in @quantagent/workers",
  ]);
}

interface JimpLike {
  read(buf: Buffer): Promise<{
    resize(o: { w: number; h: number }): { greyscale(): unknown };
    bitmap: { data: Uint8Array };
  }>;
}

/** pHash of encoded image bytes (PNG/JPEG/WebP). */
export async function phashFromBytes(bytes: Uint8Array): Promise<string> {
  const decode = await loadGrayDecoder();
  return phashFromGray(await decode(bytes));
}

/** pHash of an image at a URL. */
export async function phashFromUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return phashFromBytes(new Uint8Array(await res.arrayBuffer()));
}
