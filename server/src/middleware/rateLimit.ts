import rateLimit from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { env } from '../config/env';

const passthrough: RequestHandler = (_req, _res, next) => next();

const json429 = (message: string) => ({
  error: { code: 'RATE_LIMITED', message },
});

function limiter(opts: { windowMs: number; limit: number; message: string; key?: (req: Request) => string }): RequestHandler {
  if (!env.RATE_LIMIT_ENABLED) return passthrough;
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: json429(opts.message),
    keyGenerator: opts.key ?? ((req) => req.ip ?? 'unknown'),
    validate: false,
  });
}

export const authLimiter = limiter({
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT_PER_15MIN,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

export const apiLimiter = limiter({
  windowMs: 60_000,
  limit: env.API_RATE_LIMIT_PER_MINUTE,
  message: 'Too many requests. Please slow down.',
});

/** AI calls cost money: limit per authenticated user rather than per IP. */
export const aiLimiter = limiter({
  windowMs: 60_000,
  limit: env.AI_RATE_LIMIT_PER_MINUTE,
  message: 'AI triage rate limit reached. Try again in a minute.',
  key: (req) => req.auth?.userId ?? req.ip ?? 'unknown',
});
