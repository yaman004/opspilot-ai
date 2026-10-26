import { canAssignRole, hasRole, type InvitationDto, type Role } from '@opspilot/shared';
import { env } from '../config/env';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { randomToken, sha256 } from '../lib/crypto';
import { Invitation, Membership, Organization, Team, User, type InvitationDoc, type UserDoc } from '../models';
import type { Actor } from '../lib/http';
import { audit, writeAudit } from './audit';
import { sendMail } from './mailer';
import { notify } from './notifications';
import { toInvitationDto } from './serializers';

const INVITE_TTL_DAYS = 7;

export async function createInvitation(
  actor: Actor,
  input: { email: string; role: Role; teamIds?: string[] },
): Promise<InvitationDto> {
  if (!canAssignRole(actor.role, 'viewer', input.role, false)) {
    throw forbidden('Your role cannot invite members with this role');
  }
  const org = await Organization.findById(actor.orgId).lean();
  if (!org) throw notFound('Organization');

  const domains = org.settings?.allowedEmailDomains ?? [];
  const domain = input.email.split('@')[1] ?? '';
  if (domains.length && !domains.includes(domain)) {
    throw new AppError(422, 'EMAIL_DOMAIN_NOT_ALLOWED', `This organization only allows invitations to: ${domains.join(', ')}`);
  }

  const existingUser = await User.findOne({ email: input.email }, { _id: 1 }).lean();
  if (existingUser && (await Membership.exists({ organizationId: actor.orgId, userId: existingUser._id }))) {
    throw conflict('This person is already a member', 'ALREADY_MEMBER');
  }
  if (input.teamIds?.length) {
    const count = await Team.countDocuments({ _id: { $in: input.teamIds }, organizationId: actor.orgId });
    if (count !== new Set(input.teamIds).size) throw badRequest('One or more teams do not belong to this organization');
  }

  // Re-inviting replaces any earlier pending invitation for the same address.
  await Invitation.updateMany(
    { organizationId: actor.orgId, email: input.email, status: 'pending' },
    { $set: { status: 'revoked' } },
  );

  const token = randomToken(32);
  const doc = await Invitation.create({
    organizationId: actor.orgId,
    email: input.email,
    role: input.role,
    teamIds: input.teamIds ?? [],
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    invitedBy: actor.userId,
  });
  const acceptUrl = `${env.APP_URL}/accept-invite?token=${token}`;
  await sendMail({
    to: input.email,
    subject: `You're invited to ${org.name} on OpsPilot AI`,
    text: `You have been invited to join ${org.name} as ${input.role}. Accept within ${INVITE_TTL_DAYS} days: ${acceptUrl}`,
  });
  await audit(actor, 'invitation.created', 'invitation', String(doc._id), { email: input.email, role: input.role });

  const dto = toInvitationDto(doc.toObject() as unknown as InvitationDoc);
  // Without SMTP nobody receives the email, so in non-production the link is returned to the admin directly.
  if (!env.isProd && !env.SMTP_URL) dto.devAcceptUrl = acceptUrl;
  return dto;
}

export async function listInvitations(orgId: string): Promise<InvitationDto[]> {
  const rows = await Invitation.find({ organizationId: orgId }).sort({ createdAt: -1 }).limit(100).lean();
  return rows.map((r) => toInvitationDto(r as unknown as InvitationDoc));
}

export async function revokeInvitation(actor: Actor, invitationId: string): Promise<void> {
  const inv = await Invitation.findOneAndUpdate(
    { _id: invitationId, organizationId: actor.orgId, status: 'pending' },
    { $set: { status: 'revoked' } },
  );
  if (!inv) throw notFound('Invitation');
  await audit(actor, 'invitation.revoked', 'invitation', invitationId, { email: inv.email });
}

async function findValid(token: string): Promise<InvitationDoc> {
  const inv = await Invitation.findOne({ tokenHash: sha256(token) }).lean();
  if (!inv || inv.status !== 'pending') throw new AppError(400, 'INVALID_INVITATION', 'This invitation is no longer valid');
  if (inv.expiresAt < new Date()) throw new AppError(400, 'INVITATION_EXPIRED', 'This invitation has expired');
  return inv as unknown as InvitationDoc;
}

/** Public: lets the accept screen show which organization and email the link is for. */
export async function previewInvitation(token: string) {
  const inv = await findValid(token);
  const [org, inviter] = await Promise.all([
    Organization.findById(inv.organizationId, { name: 1 }).lean(),
    User.findById(inv.invitedBy, { name: 1 }).lean(),
  ]);
  return { email: inv.email, role: inv.role, organizationName: org?.name ?? 'Organization', invitedBy: inviter?.name ?? null };
}

/** Accepts an invitation on behalf of `user`. The invited email must match the account's email. */
export async function acceptInvitationForUser(token: string, user: Pick<UserDoc, '_id' | 'email' | 'name'>) {
  const inv = await findValid(token);
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new AppError(403, 'INVITATION_EMAIL_MISMATCH', `This invitation was sent to a different email address`);
  }
  // Claim the invitation atomically so a token can only be redeemed once.
  const claimed = await Invitation.findOneAndUpdate(
    { _id: inv._id, status: 'pending' },
    { $set: { status: 'accepted', acceptedBy: user._id } },
  );
  if (!claimed) throw new AppError(400, 'INVALID_INVITATION', 'This invitation is no longer valid');

  await Membership.updateOne(
    { userId: user._id, organizationId: inv.organizationId },
    { $setOnInsert: { role: inv.role } },
    { upsert: true },
  );
  if (inv.teamIds?.length) {
    await Team.updateMany(
      { _id: { $in: inv.teamIds }, organizationId: inv.organizationId },
      { $addToSet: { memberIds: user._id } },
    );
  }
  await writeAudit({
    orgId: String(inv.organizationId),
    actorId: String(user._id),
    action: 'invitation.accepted',
    entityType: 'invitation',
    entityId: String(inv._id),
    metadata: { email: inv.email, role: inv.role },
  });
  await notify({
    orgId: String(inv.organizationId),
    userIds: [String(inv.invitedBy)],
    type: 'member_invited',
    title: `${user.name} joined`,
    body: `${inv.email} accepted the invitation as ${inv.role}.`,
    minRole: 'admin',
  });
  return { organizationId: String(inv.organizationId), role: inv.role as Role };
}

export const canManageInvites = (role: Role) => hasRole(role, 'admin');
