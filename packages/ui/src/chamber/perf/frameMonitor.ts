/**
 * Rolling frame-time monitor. Pure: push deltas, read the median. The degradation
 * ladder (degradation.ts) decides what to do with the number.
 */
export class FrameTimeMonitor {
  private readonly buf: Float32Array;
  private head = 0;
  private count = 0;

  constructor(public readonly windowSize = 120) {
    this.buf = new Float32Array(windowSize);
  }

  push(deltaMs: number): void {
    if (!(deltaMs > 0) || !Number.isFinite(deltaMs)) return;
    this.buf[this.head] = deltaMs;
    this.head = (this.head + 1) % this.windowSize;
    if (this.count < this.windowSize) this.count++;
  }

  get samples(): number {
    return this.count;
  }

  /** Median frame time in ms, or null before any sample. */
  median(): number | null {
    if (this.count === 0) return null;
    const arr = Array.from(this.buf.subarray(0, this.count)).sort((a, b) => a - b);
    const mid = arr.length >> 1;
    return arr.length % 2 ? arr[mid]! : (arr[mid - 1]! + arr[mid]!) / 2;
  }

  /** Median fps, or null. */
  fps(): number | null {
    const m = this.median();
    return m === null ? null : 1000 / m;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
  }
}

export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const arr = [...values].sort((a, b) => a - b);
  const mid = arr.length >> 1;
  return arr.length % 2 ? arr[mid]! : (arr[mid - 1]! + arr[mid]!) / 2;
}
