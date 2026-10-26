import type { Request, Response } from 'express';
import { acceptInvitationSchema } from '@opspilot/shared';
import { asyncHandler } from '../lib/http';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from '../lib/tokens';
import { unauthorized } from '../lib/errors';
import { User, type UserDoc } from '../models';
import * as auth from '../services/auth';
import { acceptInvitationForUser, previewInvitation } from '../services/invitations';
import { toUserDto } from '../services/serializers';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.header('user-agent') });

function respondWithSession(res: Response, status: number, out: { session: auth.IssuedSession; body: unknown }) {
  setAuthCookies(res, out.session.refreshToken, out.session.csrfToken);
  res.status(status).json(out.body);
}

export const register = asyncHandler(async (req, res) => {
  respondWithSession(res, 201, await auth.register(req.body, meta(req)));
});

export const login = asyncHandler(async (req, res) => {
  respondWithSession(res, 200, await auth.login(req.body, meta(req)));
});

export const refresh = asyncHandler(async (req, res) => {
  try {
    respondWithSession(res, 200, await auth.refresh(req.cookies?.[REFRESH_COOKIE], meta(req)));
  } catch (err) {
    // A rejected refresh ends the session in this browser — but a benign race must keep the (newer) cookie.
    if ((err as { code?: string }).code !== 'REFRESH_RACE') clearAuthCookies(res);
    throw err;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);
  res.status(204).end();
});

export const logoutAll = asyncHandler(async (req, res) => {
  await auth.logoutEverywhere(req.auth!.userId);
  clearAuthCookies(res);
  res.status(204).end();
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await auth.requestPasswordReset(req.body.email);
  // Same response whether or not the account exists.
  res.status(202).json({ message: 'If an account exists for that email, a reset link has been sent.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await auth.resetPassword(req.body.token, req.body.password);
  res.json({ message: 'Password updated. Please sign in.' });
});

export const me = asyncHandler(async (req, res) => {
  const user = (await User.findById(req.auth!.userId).lean()) as unknown as UserDoc | null;
  if (!user) throw unauthorized();
  res.json({ user: toUserDto(user), memberships: await auth.loadMemberships(String(user._id)) });
});

export const updateMe = asyncHandler(async (req, res) => {
  res.json({ user: await auth.updateProfile(req.auth!.userId, req.body) });
});

export const changePassword = asyncHandler(async (req, res) => {
  await auth.changePassword(req.auth!.userId, req.body.currentPassword, req.body.newPassword);
  res.json({ message: 'Password changed' });
});

export const invitationPreview = asyncHandler(async (req, res) => {
  const token = acceptInvitationSchema.parse({ token: req.query.token }).token;
  res.json(await previewInvitation(token));
});

export const acceptInvitation = asyncHandler(async (req, res) => {
  const user = (await User.findById(req.auth!.userId).lean()) as unknown as UserDoc | null;
  if (!user) throw unauthorized();
  const out = await acceptInvitationForUser(req.body.token, user);
  res.json({ ...out, memberships: await auth.loadMemberships(String(user._id)) });
});
