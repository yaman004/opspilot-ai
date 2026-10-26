import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env } from '../config/env';

export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

interface AccessPayload {
  sub: string;
  fid: string;
  typ: 'access';
}

export function signAccessToken(userId: string, familyId: string): string {
  const payload: AccessPayload = { sub: userId, fid: familyId, typ: 'access' };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'opspilot',
  });
}

export function verifyAccessToken(token: string): { userId: string; familyId: string; exp: number } {
  const p = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'opspilot' }) as AccessPayload & {
    exp: number;
  };
  if (p.typ !== 'access' || !p.sub || !p.fid) throw new jwt.JsonWebTokenError('Wrong token type');
  return { userId: p.sub, familyId: p.fid, exp: p.exp };
}

const baseCookie = () => ({
  secure: env.cookieSecure,
  sameSite: env.COOKIE_SAMESITE,
  domain: env.COOKIE_DOMAIN,
});

/** Refresh token: HttpOnly, scoped to the auth routes. CSRF token: readable by JS (double-submit). */
export function setAuthCookies(res: Response, refreshToken: string, csrfToken: string): void {
  const maxAge = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseCookie(), httpOnly: true, path: '/api/auth', maxAge });
  res.cookie(CSRF_COOKIE, csrfToken, { ...baseCookie(), httpOnly: false, path: '/', maxAge });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), httpOnly: true, path: '/api/auth' });
  res.clearCookie(CSRF_COOKIE, { ...baseCookie(), httpOnly: false, path: '/' });
}
