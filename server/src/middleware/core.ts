import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError, type ZodTypeAny } from 'zod';
import { can, type Permission } from '@opspilot/shared';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors';
import { asyncHandler, isObjectId } from '../lib/http';
import { CSRF_COOKIE, CSRF_HEADER, verifyAccessToken } from '../lib/tokens';
import { safeEqual } from '../lib/crypto';
import { Membership, RefreshSession } from '../models';

export const allowedOrigins = (): string[] =>
  env.CLIENT_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Assigns a request id (honouring a sane inbound one) and echoes it on the response. */
export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.header('x-request-id');
  req.id = inbound && /^[\w.-]{8,64}$/.test(inbound) ? inbound : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
};

/** Verifies the bearer access token AND that its session family is still active (logout/revocation works). */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let claims;
  try {
    claims = verifyAccessToken(header.slice(7));
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw unauthorized('Access token expired', 'TOKEN_EXPIRED');
    throw unauthorized('Invalid access token', 'INVALID_TOKEN');
  }
  const active = await RefreshSession.exists({
    familyId: claims.familyId,
    userId: claims.userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!active) throw unauthorized('Session ended', 'SESSION_REVOKED');
  req.auth = { userId: claims.userId, familyId: claims.familyId };
  next();
});

/**
 * Resolves :orgId from the URL and proves the caller is a member. The role always comes from the
 * database — never from the client. Non-members get a 404 so organization ids cannot be probed.
 */
export const requireOrg: RequestHandler = asyncHandler(async (req, _res, next) => {
  const orgId = req.params.orgId;
  if (!req.auth) throw unauthorized();
  if (!isObjectId(orgId)) throw notFound('Organization');
  const membership = await Membership.findOne({ userId: req.auth.userId, organizationId: orgId }).lean();
  if (!membership) throw notFound('Organization');
  req.org = { orgId, membershipId: String(membership._id), role: membership.role as any };
  next();
});

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.org || !can(req.org.role, permission)) return next(forbidden());
    next();
  };

/** Double-submit CSRF check + Origin allow-list, for the cookie-authenticated endpoints only. */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  const origin = req.header('origin');
  if (origin && !allowedOrigins().includes(origin)) {
    return next(new AppError(403, 'CSRF_ORIGIN', 'Origin not allowed'));
  }
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.header(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) {
    return next(new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token'));
  }
  next();
};

type Schemas = { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'BAD_REQUEST';
    message = `Invalid ${err.path}`;
  } else if ((err as any)?.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'A record with these values already exists';
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
  } else if ((err as any)?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  } else if ((err as any)?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else if ((err as any)?.message === 'CORS_NOT_ALLOWED') {
    status = 403;
    code = 'CORS_NOT_ALLOWED';
    message = 'Origin not allowed';
  }

  if (status >= 500) logger.error({ err, requestId: req.id, path: req.path }, 'Unhandled error');
  res.status(status).json({ error: { code, message, details, requestId: req.id } });
};
