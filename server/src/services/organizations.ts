import {
  DEFAULT_ESCALATION_RULES,
  DEFAULT_SLA_TARGETS,
  canAssignRole,
  canRemoveMember,
  hasRole,
  SOCKET_EVENTS,
  type MemberDto,
  type Role,
  type UpsertSlaPolicyInput,
} from '@opspilot/shared';
import {
  AiAnalysis,
  Attachment,
  AuditLog,
  Comment,
  Incident,
  Invitation,
  Membership,
  Notification,
  Organization,
  SlaPolicy,
  Team,
  User,
  type OrganizationDoc,
  type SlaPolicyDoc,
  type UserDoc,
} from '../models';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { randomToken } from '../lib/crypto';
import type { Actor } from '../lib/http';
import { audit } from './audit';
import { emitToUser, evictUserFromOrg } from './realtime';
import { toOrganizationDto, toSlaPolicyDto, toUserDto } from './serializers';
import { getStorage } from './storage';
import { logger } from '../config/logger';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34) || 'org';

export async function createOrganization(userId: string, input: { name: string; slug?: string }) {
  let slug = input.slug ?? slugify(input.name);
  if (slug.length < 3) slug = `${slug}-org`;
  if (await Organization.exists({ slug })) {
    if (input.slug) throw conflict('This URL name is already taken', 'SLUG_TAKEN');
    slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  }
  const org = await Organization.create({ name: input.name, slug, createdBy: userId });
  await Membership.create({ userId, organizationId: org._id, role: 'owner' });
  await SlaPolicy.create({
    organizationId: org._id,
    name: 'Default SLA policy',
    targets: DEFAULT_SLA_TARGETS,
    escalationRules: DEFAULT_ESCALATION_RULES,
    isDefault: true,
    updatedBy: userId,
  });
  await audit({ orgId: String(org._id), userId }, 'organization.created', 'organization', String(org._id), {
    name: org.name,
  });
  return toOrganizationDto(org.toObject() as unknown as OrganizationDoc);
}

export async function getOrganization(orgId: string) {
  const org = await Organization.findById(orgId).lean();
  if (!org) throw notFound('Organization');
  return toOrganizationDto(org as unknown as OrganizationDoc);
}

export async function updateOrganization(
  actor: Actor,
  patch: { name?: string; timezone?: string; settings?: { allowedEmailDomains?: string[]; defaultIncidentCategory?: string } },
) {
  const set: Record<string, unknown> = {};
  if (patch.name) set.name = patch.name;
  if (patch.timezone) set.timezone = patch.timezone;
  if (patch.settings?.allowedEmailDomains) set['settings.allowedEmailDomains'] = patch.settings.allowedEmailDomains;
  if (patch.settings?.defaultIncidentCategory) set['settings.defaultIncidentCategory'] = patch.settings.defaultIncidentCategory;
  const org = await Organization.findByIdAndUpdate(actor.orgId, { $set: set }, { new: true }).lean();
  if (!org) throw notFound('Organization');
  await audit(actor, 'organization.updated', 'organization', actor.orgId, { changes: Object.keys(set) });
  return toOrganizationDto(org as unknown as OrganizationDoc);
}

/** Owner-only, requires typing the exact organization name. Removes every record the org owns. */
export async function deleteOrganization(actor: Actor, confirmName: string) {
  const org = await Organization.findById(actor.orgId).lean();
  if (!org) throw notFound('Organization');
  if (org.name !== confirmName) throw new AppError(400, 'CONFIRMATION_MISMATCH', 'Type the organization name exactly to confirm');

  const attachments = await Attachment.find({ organizationId: actor.orgId }).lean();
  const storage = getStorage();
  await Promise.all(
    attachments.map((a) =>
      storage.delete(a.storageKey).catch((err) => logger.warn({ err, key: a.storageKey }, 'Could not delete stored file')),
    ),
  );
  const filter = { organizationId: actor.orgId };
  await Promise.all([
    Incident.deleteMany(filter),
    Comment.deleteMany(filter),
    Notification.deleteMany(filter),
    AuditLog.deleteMany(filter),
    SlaPolicy.deleteMany(filter),
    Invitation.deleteMany(filter),
    AiAnalysis.deleteMany(filter),
    Attachment.deleteMany(filter),
    Team.deleteMany(filter),
    Membership.deleteMany(filter),
  ]);
  await Organization.deleteOne({ _id: actor.orgId });
}

/* ------------------------------ members ------------------------------ */

export async function listMembers(orgId: string): Promise<MemberDto[]> {
  const [memberships, teams] = await Promise.all([
    Membership.find({ organizationId: orgId }).sort({ createdAt: 1 }).lean(),
    Team.find({ organizationId: orgId }, { memberIds: 1 }).lean(),
  ]);
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).lean();
  const byId = new Map(users.map((u) => [String(u._id), u as unknown as UserDoc]));
  return memberships
    .filter((m) => byId.has(String(m.userId)))
    .map((m) => ({
      id: String(m._id),
      role: m.role as Role,
      user: toUserDto(byId.get(String(m.userId)) as UserDoc),
      teamIds: teams.filter((t) => (t.memberIds ?? []).some((x) => String(x) === String(m.userId))).map((t) => String(t._id)),
      createdAt: m.createdAt.toISOString(),
    }));
}

async function ownerCount(orgId: string) {
  return Membership.countDocuments({ organizationId: orgId, role: 'owner' });
}

export async function updateMemberRole(actor: Actor, membershipId: string, newRole: Role) {
  const target = await Membership.findOne({ _id: membershipId, organizationId: actor.orgId });
  if (!target) throw notFound('Member');
  const isSelf = String(target.userId) === actor.userId;
  if (!canAssignRole(actor.role, target.role as Role, newRole, isSelf)) {
    throw forbidden(isSelf ? 'You cannot change your own role' : 'Your role cannot make this change');
  }
  if (target.role === 'owner' && newRole !== 'owner' && (await ownerCount(actor.orgId)) <= 1) {
    throw new AppError(409, 'LAST_OWNER', 'An organization must keep at least one owner');
  }
  const from = target.role;
  target.role = newRole;
  await target.save();
  await audit(actor, 'member.role_changed', 'member', String(target.userId), { from, to: newRole });
  if (!hasRole(newRole, 'agent')) evictUserFromOrg(String(target.userId), actor.orgId, { staffOnly: true });
  emitToUser(String(target.userId), SOCKET_EVENTS.membershipChanged, { orgId: actor.orgId, role: newRole });
  return { id: String(target._id), role: newRole };
}

export async function removeMember(actor: Actor, membershipId: string) {
  const target = await Membership.findOne({ _id: membershipId, organizationId: actor.orgId });
  if (!target) throw notFound('Member');
  const isSelf = String(target.userId) === actor.userId;
  // Anyone may leave an organization; removing others follows the role hierarchy.
  if (!isSelf && !canRemoveMember(actor.role, target.role as Role)) throw forbidden('Your role cannot remove this member');
  if (target.role === 'owner' && (await ownerCount(actor.orgId)) <= 1) {
    throw new AppError(409, 'LAST_OWNER', 'Transfer ownership before the last owner leaves');
  }
  await Membership.deleteOne({ _id: target._id });
  await Team.updateMany({ organizationId: actor.orgId }, { $pull: { memberIds: target.userId } });
  // Active work must never stay assigned to someone who can no longer see it.
  const released = await Incident.updateMany(
    { organizationId: actor.orgId, assigneeId: target.userId, status: { $nin: ['resolved', 'closed'] } },
    { $set: { assigneeId: null } },
  );
  await audit(actor, isSelf ? 'member.left' : 'member.removed', 'member', String(target.userId), {
    role: target.role,
    unassignedIncidents: released.modifiedCount,
  });
  evictUserFromOrg(String(target.userId), actor.orgId);
  emitToUser(String(target.userId), SOCKET_EVENTS.membershipChanged, { orgId: actor.orgId, removed: true });
}

/** An assignee must be an active member who is allowed to work incidents. */
export async function assertAssignable(orgId: string, userId: string): Promise<void> {
  const m = await Membership.findOne({ organizationId: orgId, userId }, { role: 1 }).lean();
  if (!m) throw badRequest('Assignee is not a member of this organization');
  if (!hasRole(m.role as Role, 'agent')) throw badRequest('Viewers cannot be assigned incidents');
}

/* ------------------------------ SLA policy ----------------------------- */

export async function getActiveSlaPolicy(orgId: string): Promise<SlaPolicyDoc> {
  const policy = await SlaPolicy.findOne({ organizationId: orgId, isDefault: true }).lean();
  if (policy) return policy as unknown as SlaPolicyDoc;
  // Self-heal: organizations created before a policy existed still get sane defaults.
  const created = await SlaPolicy.create({
    organizationId: orgId,
    name: 'Default SLA policy',
    targets: DEFAULT_SLA_TARGETS,
    escalationRules: DEFAULT_ESCALATION_RULES,
    isDefault: true,
  });
  return created.toObject() as unknown as SlaPolicyDoc;
}

export async function getSlaPolicyDto(orgId: string) {
  return toSlaPolicyDto(await getActiveSlaPolicy(orgId));
}

export async function updateSlaPolicy(actor: Actor, input: UpsertSlaPolicyInput) {
  const current = await getActiveSlaPolicy(actor.orgId);
  const updated = await SlaPolicy.findByIdAndUpdate(
    current._id,
    {
      $set: {
        name: input.name,
        targets: input.targets,
        escalationRules: input.escalationRules,
        isActive: input.isActive,
        updatedBy: actor.userId,
      },
    },
    { new: true },
  ).lean();
  await audit(actor, 'sla_policy.updated', 'sla_policy', String(current._id), { name: input.name });
  return toSlaPolicyDto(updated as unknown as SlaPolicyDoc);
}
