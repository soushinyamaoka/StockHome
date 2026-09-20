// Email-address rate limiting for login and registration.
// @fastify/rate-limit does not support stacking multiple instances on one route,
// so it handles the IP limit while this handler enforces the account limit.
import type { FastifyReply, FastifyRequest } from 'fastify';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface AccountRateLimitOptions {
  namespace: string;
  max: number;
  windowMs: number;
  extractEmail: (body: unknown) => string | undefined;
}

export function resetAccountRateLimitStoreForTest(): void {
  buckets.clear();
}

export function createAccountRateLimitPreHandler(options: AccountRateLimitOptions) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const rawEmail = options.extractEmail(req.body);
    if (!rawEmail) return;

    const key = `${options.namespace}:${rawEmail.trim().toLowerCase()}`;
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
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
