import type { Request, Response, NextFunction } from 'express';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(options: { windowMs?: number; max?: number; keyPrefix?: string } = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 120;
  const prefix = options.keyPrefix ?? 'api';
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${prefix}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + windowMs }; buckets.set(key, bucket); }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) { res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000))); res.status(429).json({ error: 'Too many requests. Please try again later.' }); return; }
    next();
  };
}

export function cleanupRateLimitBuckets() {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}
