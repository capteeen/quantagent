/**
 * Perceptual hash (pHash): greyscale → 32×32 → DCT-II → top-left 8×8 (DC
 * excluded from the mean) → 64 bits → 16 hex chars. Hamming distance between
 * two hashes approximates visual difference (0 identical, ~32 unrelated).
 * Decoding uses sharp, falling back to jimp when sharp's native binary is
 * unavailable. The DCT and bit packing are pure so tests cover them exactly.
 */

export const PHASH_SIZE = 32;
export const PHASH_LOW = 8;
export const PHASH_BITS = PHASH_LOW * PHASH_LOW;

const COS = (() => {
  const t: number[][] = [];
  for (let u = 0; u < PHASH_SIZE; u++) {
    t[u] = [];
    for (let x = 0; x < PHASH_SIZE; x++) t[u]![x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PHASH_SIZE));
  }
  return t;
})();

/** `gray` is 32×32 row-major luminance (0–255). Returns 16 lowercase hex chars. */
export function phashFromGray(gray: ArrayLike<number>): string {
  if (gray.length !== PHASH_SIZE * PHASH_SIZE) throw new Error(`phash expects ${PHASH_SIZE * PHASH_SIZE} pixels, got ${gray.length}`);
  // Separable DCT: rows then columns, only the first PHASH_LOW frequencies are needed.
  const rows: number[][] = [];
  for (let y = 0; y < PHASH_SIZE; y++) {
    const row: number[] = [];
    for (let u = 0; u < PHASH_LOW; u++) {
      let s = 0;
      for (let x = 0; x < PHASH_SIZE; x++) s += (gray[y * PHASH_SIZE + x] as number) * COS[u]![x]!;
      row[u] = s;
    }
    rows[y] = row;
  }
  const low: number[] = [];
  for (let v = 0; v < PHASH_LOW; v++) {
    for (let u = 0; u < PHASH_LOW; u++) {
      let s = 0;
      for (let y = 0; y < PHASH_SIZE; y++) s += rows[y]![u]! * COS[v]![y]!;
      low[v * PHASH_LOW + u] = s;
    }
  }
  let mean = 0;
  for (let i = 1; i < PHASH_BITS; i++) mean += low[i]!;
  mean /= PHASH_BITS - 1;
  let bits = 0n;
  for (let i = 0; i < PHASH_BITS; i++) bits = (bits << 1n) | (low[i]! > mean ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export function hammingHex(a: string, b: string): number {
  const ah = a.trim().toLowerCase();
  const bh = b.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(ah) || !/^[0-9a-f]+$/.test(bh)) throw new Error("hashes must be hex");
  if (ah.length !== bh.length) throw new Error(`hash lengths differ: ${ah.length} vs ${bh.length}`);
  let x = BigInt(`0x${ah}`) ^ BigInt(`0x${bh}`);
  let d = 0;
  while (x > 0n) {
    d += Number(x & 1n);
    x >>= 1n;
  }
  return d;
}

/** 1 for identical, 0 for maximally different (hex length × 4 bits). */
export function similarityFromHamming(distance: number, bits = PHASH_BITS): number {
  return Math.max(0, 1 - distance / bits);
}

export type GrayDecoder = (bytes: Uint8Array) => Promise<Uint8Array>;

let decoder: GrayDecoder | null = null;

async function sharpDecoder(): Promise<GrayDecoder> {
  const mod = await import("sharp");
  const sharp = (mod.default ?? mod) as unknown as (input: Buffer) => {
    greyscale(): { resize(w: number, h: number, o: { fit: "fill" }): { raw(): { toBuffer(): Promise<Buffer> } } };
  };
  return async (bytes) => {
    const buf = await sharp(Buffer.from(bytes)).greyscale().resize(PHASH_SIZE, PHASH_SIZE, { fit: "fill" }).raw().toBuffer();
    return new Uint8Array(buf);
  };
}

async function jimpDecoder(): Promise<GrayDecoder> {
  const mod = (await import("jimp")) as unknown as {
    Jimp: { read(b: Buffer): Promise<{ greyscale(): unknown; resize(o: { w: number; h: number }): unknown; bitmap: { data: Uint8Array } }> };
  };
  return async (bytes) => {
    const img = await mod.Jimp.read(Buffer.from(bytes));
    img.greyscale();
    img.resize({ w: PHASH_SIZE, h: PHASH_SIZE });
    const rgba = img.bitmap.data;
    const gray = new Uint8Array(PHASH_SIZE * PHASH_SIZE);
    for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4]!;
    return gray;
  };
}

/** sharp first, jimp if sharp cannot load. */
export async function grayDecoder(): Promise<GrayDecoder> {
  if (decoder) return decoder;
  try {
    decoder = await sharpDecoder();
  } catch {
    decoder = await jimpDecoder();
  }
  return decoder;
}

export async function phashImage(bytes: Uint8Array): Promise<string> {
  const dec = await grayDecoder();
  return phashFromGray(await dec(bytes));
}
