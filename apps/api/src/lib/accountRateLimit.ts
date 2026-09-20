// Email-address rate limiting for login and registration.
// @fastify/rate-limit does not support stacking multiple instances on one route,
// so it handles the IP limit while this handler enforces the account limit.
import type { FastifyReply, FastifyRequest } from 'fastify';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bounded TTL store: this is a safety valve against unbounded growth from
// requests using many distinct email values.
let maxEntries = 5000;

export interface AccountRateLimitOptions {
  namespace: string;
  max: number;
  windowMs: number;
  extractEmail: (body: unknown) => string | undefined;
}

export function resetAccountRateLimitStoreForTest(): void {
  buckets.clear();
  maxEntries = 5000;
}

export function setMaxEntriesForTest(value: number): void {
  maxEntries = value;
}

export function getAccountRateLimitStoreSizeForTest(): number {
  return buckets.size;
}

function purgeExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function makeRoomForNewEntry(now: number): void {
  if (buckets.size < maxEntries) return;

  purgeExpired(now);
  while (buckets.size >= maxEntries) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey === undefined) break;
    buckets.delete(oldestKey);
  }
}

export function createAccountRateLimitPreHandler(options: AccountRateLimitOptions) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const rawEmail = options.extractEmail(req.body);
    if (typeof rawEmail !== 'string') return;
    const trimmed = rawEmail.trim();
    if (trimmed === '') return;

    const key = `${options.namespace}:${trimmed.toLowerCase()}`;
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      makeRoomForNewEntry(now);
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return;
    }

    existing.count += 1;
    if (existing.count > options.max) {
      const retryAfterSec = Math.ceil((existing.resetAt - now) / 1000);
      reply.header('Retry-After', String(retryAfterSec));
      return reply.code(429).send({
        message: '試行回数が多すぎます。しばらくしてから再度お試しください',
      });
    }
  };
}
