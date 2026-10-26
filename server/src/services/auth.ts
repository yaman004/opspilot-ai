import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { AuthResponse, MembershipDto } from '@opspilot/shared';
import { env } from '../config/env';
import { Membership, Organization, RefreshSession, User, type OrganizationDoc, type UserDoc } from '../models';
import { AppError, conflict, unauthorized } from '../lib/errors';
import { randomToken, sha256 } from '../lib/crypto';
import { signAccessToken } from '../lib/tokens';
import { sendMail } from './mailer';
import { toOrganizationDto, toUserDto } from './serializers';
import { acceptInvitationForUser } from './invitations';
import { logger } from '../config/logger';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const REFRESH_RACE_GRACE_MS = 15_000;
// Valid bcrypt hash of a random string: lets us spend equal time for unknown users.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, env.BCRYPT_ROUNDS);

async function issueSession(userId: string, meta: SessionMeta, familyId: string = randomUUID()): Promise<IssuedSession & { hash: string }> {
  const refreshToken = randomToken(48);
  const hash = sha256(refreshToken);
  await RefreshSession.create({
    userId,
    familyId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { accessToken: signAccessToken(userId, familyId), refreshToken, csrfToken: randomToken(24), hash };
}

export async function buildAuthResponse(user: UserDoc, accessToken: string): Promise<AuthResponse> {
  return {
    accessToken,
    expiresInSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    user: toUserDto(user),
    memberships: await loadMemberships(String(user._id)),
  };
}

export async function loadMemberships(userId: string): Promise<MembershipDto[]> {
  const memberships = await Membership.find({ userId }).sort({ createdAt: 1 }).lean();
  if (!memberships.length) return [];
  const orgs = await Organization.find({ _id: { $in: memberships.map((m) => m.organizationId) } }).lean();
  const byId = new Map(orgs.map((o) => [String(o._id), o as unknown as OrganizationDoc]));
  return memberships
    .filter((m) => byId.has(String(m.organizationId)))
    .map((m) => ({
      id: String(m._id),
      role: m.role as MembershipDto['role'],
      organization: toOrganizationDto(byId.get(String(m.organizationId)) as OrganizationDoc),
    }));
}

export async function register(
  input: { name: string; email: string; password: string; inviteToken?: string },
  meta: SessionMeta,
) {
  if (await User.exists({ email: input.email })) throw conflict('An account with this email already exists', 'EMAIL_IN_USE');
  const passwordHash = await hashPassword(input.password);
  let user: UserDoc;
  try {
    user = (await User.create({ name: input.name, email: input.email, passwordHash })).toObject() as unknown as UserDoc;
  } catch (err: any) {
    if (err?.code === 11000) throw conflict('An account with this email already exists', 'EMAIL_IN_USE');
    throw err;
  }
  if (input.inviteToken) {
    // Validates the token belongs to this exact email; a failure here must not leave a half-set-up account.
    try {
      await acceptInvitationForUser(input.inviteToken, user);
    } catch (err) {
      await User.deleteOne({ _id: user._id });
      throw err;
    }
  }
  const session = await issueSession(String(user._id), meta);
  return { session, body: await buildAuthResponse(user, session.accessToken) };
}

export async function login(input: { email: string; password: string }, meta: SessionMeta) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  const now = new Date();
  if (user?.lockedUntil && user.lockedUntil > now) {
    throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.');
  }
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    if (user) {
      const failed = (user.failedLoginCount ?? 0) + 1;
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
            lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
          },
        },
      );
    }
    throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
  const session = await issueSession(String(user._id), meta);
  const fresh = (await User.findById(user._id).lean()) as unknown as UserDoc;
  return { session, body: await buildAuthResponse(fresh, session.accessToken) };
}

/**
 * Rotates the refresh token. Presenting a token that was already rotated is treated as theft:
 * the entire token family is revoked. A short grace window avoids punishing two tabs that refresh
 * at the same moment (the loser just gets a retryable 401).
 */
export async function refresh(rawToken: string | undefined, meta: SessionMeta) {
  if (!rawToken) throw unauthorized('No session', 'NO_REFRESH_TOKEN');
  const hash = sha256(rawToken);
  const existing = await RefreshSession.findOne({ tokenHash: hash });
  if (!existing) throw unauthorized('Invalid session', 'INVALID_REFRESH_TOKEN');

  const now = new Date();
  if (existing.revokedAt) {
    if (existing.replacedByHash && now.getTime() - existing.revokedAt.getTime() < REFRESH_RACE_GRACE_MS) {
      throw unauthorized('Session was just refreshed, retry', 'REFRESH_RACE');
    }
    await RefreshSession.updateMany({ familyId: existing.familyId, revokedAt: null }, { $set: { revokedAt: now } });
    logger.warn({ userId: String(existing.userId), familyId: existing.familyId }, 'Refresh token reuse detected; family revoked');
    throw unauthorized('Session expired, please sign in again', 'REFRESH_REUSE');
  }
  if (existing.expiresAt <= now) throw unauthorized('Session expired', 'REFRESH_EXPIRED');

  const user = (await User.findById(existing.userId).lean()) as unknown as UserDoc | null;
  if (!user) throw unauthorized('Invalid session', 'INVALID_REFRESH_TOKEN');

  const next = await issueSession(String(user._id), meta, existing.familyId);
  const claimed = await RefreshSession.findOneAndUpdate(
    { _id: existing._id, revokedAt: null },
    { $set: { revokedAt: now, replacedByHash: next.hash } },
  );
  if (!claimed) {
    await RefreshSession.deleteOne({ tokenHash: next.hash });
    throw unauthorized('Session was just refreshed, retry', 'REFRESH_RACE');
  }
  return { session: next, body: await buildAuthResponse(user, next.accessToken) };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const s = await RefreshSession.findOne({ tokenHash: sha256(rawToken) });
  if (s) await RefreshSession.updateMany({ familyId: s.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function logoutEverywhere(userId: string): Promise<void> {
  await RefreshSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await User.findOne({ email });
  if (!user) return; // never reveal whether the account exists
  const token = randomToken(32);
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: new Date(Date.now() + 3_600_000) } },
  );
  await sendMail({
    to: user.email,
    subject: 'Reset your OpsPilot AI password',
    text: `Use this link within 1 hour to reset your password: ${env.APP_URL}/reset-password?token=${token}`,
  });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const user = await User.findOne({
    passwordResetTokenHash: sha256(token),
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpiresAt');
  if (!user) throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired');
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await hashPassword(password),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    },
  );
  await logoutEverywhere(String(user._id));
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
    throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
  }
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(next) } });
}

export async function updateProfile(userId: string, patch: { name?: string; timezone?: string; themePreference?: string }) {
  const user = await User.findByIdAndUpdate(userId, { $set: patch }, { new: true }).lean();
  if (!user) throw unauthorized();
  return toUserDto(user as unknown as UserDoc);
}
