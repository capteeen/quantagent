/**
 * Classic token bucket. Time is injected so tests are deterministic.
 */
export interface BucketOptions {
  /** Burst size. */
  capacity: number;
  /** Steady-state refill, tokens per second. */
  refillPerSecond: number;
}

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly opts: BucketOptions,
    private readonly now: () => number = Date.now,
  ) {
    if (opts.capacity <= 0 || opts.refillPerSecond <= 0) {
      throw new Error("TokenBucket: capacity and refillPerSecond must be > 0");
    }
    this.tokens = opts.capacity;
    this.last = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = Math.max(0, t - this.last);
    this.last = t;
    this.tokens = Math.min(this.opts.capacity, this.tokens + (elapsed / 1000) * this.opts.refillPerSecond);
  }

  /** Takes one token if available. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milliseconds until one token is available (0 if now). */
  msUntilToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.opts.refillPerSecond) * 1000);
  }

  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  get capacity(): number {
    return this.opts.capacity;
  }
}
