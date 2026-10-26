import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@opspilot/shared';
import { Types } from 'mongoose';
import { badRequest } from './errors';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export interface AuthContext {
  userId: string;
  familyId: string;
}

export interface OrgContext {
  orgId: string;
  membershipId: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    auth?: AuthContext;
    org?: OrgContext;
  }
}

export interface Actor {
  userId: string;
  orgId: string;
  role: Role;
  ip?: string;
  requestId?: string;
}

export function actorFrom(req: Request): Actor {
  if (!req.auth || !req.org) throw new Error('actorFrom called on an unauthenticated / non-org request');
  return { userId: req.auth.userId, orgId: req.org.orgId, role: req.org.role, ip: req.ip, requestId: req.id };
}

export function oid(value: string | undefined, label = 'id'): Types.ObjectId {
  if (!value || !Types.ObjectId.isValid(value) || String(new Types.ObjectId(value)) !== value.toLowerCase()) {
    throw badRequest(`Invalid ${label}`);
  }
  return new Types.ObjectId(value);
}

export const isObjectId = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
