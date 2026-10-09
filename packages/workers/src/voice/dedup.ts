/**
 * Store of texts the Voice has already posted. The Voice never posts the same text twice.
 * In-memory by default; the integrator can inject a persistent store (Redis/Postgres)
 * that satisfies PostedTextStore.
 */

export interface PostedTextStore {
  has(text: string): Promise<boolean> | boolean;
  add(text: string): Promise<void> | void;
}

/** Whitespace-insensitive, case-sensitive key so "gm  frens" and "gm frens" collide. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export class MemoryPostedTextStore implements PostedTextStore {
  private readonly texts = new Set<string>();

  has(text: string): boolean {
    return this.texts.has(normalizeText(text));
  }

  add(text: string): void {
    this.texts.add(normalizeText(text));
  }

  get size(): number {
    return this.texts.size;
  }
}
