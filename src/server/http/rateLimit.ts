type Bucket = { windowStartMs: number; count: number };

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private limitPerMinute: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const windowMs = 60_000;
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStartMs >= windowMs) {
      this.buckets.set(key, { windowStartMs: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.limitPerMinute;
  }
}

