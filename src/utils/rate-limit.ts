import { HttpError } from "./httpError";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function assertRateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > max) {
    throw new HttpError(429, "Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.");
  }
}
