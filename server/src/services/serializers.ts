import {
  evaluateSla,
  type ActivityDto,
  type AttachmentDto,
  type AuditLogDto,
  type CommentDto,
  type IncidentDto,
  type InvitationDto,
  type NotificationDto,
  type OrganizationDto,
  type SlaPolicyDto,
  type TeamDto,
  type UserDto,
  type UserRefDto,
  type AiAnalysisDto,
} from '@opspilot/shared';
import { Team, User } from '../models';
import type {
  AiAnalysisDoc,
  AttachmentDoc,
  AuditLogDoc,
  CommentDoc,
  IncidentDoc,
  InvitationDoc,
  NotificationDoc,
  OrganizationDoc,
  SlaPolicyDoc,
  TeamDoc,
  UserDoc,
} from '../models';
import type { Types } from 'mongoose';

const id = (v: Types.ObjectId | string | null | undefined): string | null => (v ? String(v) : null);
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export const toUserDto = (u: UserDoc): UserDto => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  timezone: u.timezone ?? 'UTC',
  themePreference: (u.themePreference as UserDto['themePreference']) ?? 'system',
  createdAt: u.createdAt.toISOString(),
});

export const toOrganizationDto = (o: OrganizationDoc): OrganizationDto => ({
  id: String(o._id),
  name: o.name,
  slug: o.slug,
  timezone: o.timezone ?? 'UTC',
  settings: {
    allowedEmailDomains: o.settings?.allowedEmailDomains ?? [],
    defaultIncidentCategory: o.settings?.defaultIncidentCategory ?? 'other',
  },
  createdAt: o.createdAt.toISOString(),
});

export const toTeamDto = (t: TeamDoc): TeamDto => ({
  id: String(t._id),
  name: t.name,
  description: t.description ?? undefined,
  memberIds: (t.memberIds ?? []).map(String),
  createdAt: t.createdAt.toISOString(),
});

export const toInvitationDto = (i: InvitationDoc): InvitationDto => ({
  id: String(i._id),
  email: i.email,
  role: i.role as InvitationDto['role'],
  status: i.status === 'pending' && i.expiresAt < new Date() ? 'expired' : (i.status as InvitationDto['status']),
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
});

export const toSlaPolicyDto = (p: SlaPolicyDoc): SlaPolicyDto => ({
  id: String(p._id),
  name: p.name,
  targets: JSON.parse(JSON.stringify(p.targets)),
  escalationRules: (p.escalationRules ?? []) as SlaPolicyDto['escalationRules'],
  isActive: p.isActive,
  isDefault: p.isDefault,
  updatedAt: p.updatedAt.toISOString(),
});

export interface RefMaps {
  users: Map<string, UserRefDto>;
  teams: Map<string, { id: string; name: string }>;
}

/** Batch-resolves user/team references so list endpoints avoid N+1 queries. */
export async function loadRefs(
  userIds: Array<Types.ObjectId | string | null | undefined>,
  teamIds: Array<Types.ObjectId | string | null | undefined> = [],
  orgId?: string,
): Promise<RefMaps> {
  const uids = Array.from(new Set(userIds.filter(Boolean).map(String)));
  const tids = Array.from(new Set(teamIds.filter(Boolean).map(String)));
  const [users, teams] = await Promise.all([
    uids.length ? User.find({ _id: { $in: uids } }, { name: 1, email: 1 }).lean() : [],
    tids.length ? Team.find({ _id: { $in: tids }, ...(orgId ? { organizationId: orgId } : {}) }, { name: 1 }).lean() : [],
  ]);
  return {
    users: new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name, email: u.email }])),
    teams: new Map(teams.map((t) => [String(t._id), { id: String(t._id), name: t.name }])),
  };
}

export function toIncidentDto(inc: IncidentDoc, refs: RefMaps, now: Date = new Date()): IncidentDto {
  const sla = evaluateSla(
    {
      createdAt: inc.createdAt,
      responseDueAt: inc.sla?.responseDueAt,
      resolutionDueAt: inc.sla?.resolutionDueAt,
      firstRespondedAt: inc.sla?.firstRespondedAt,
      resolvedAt: inc.resolvedAt,
    },
    now,
  );
  const reporterId = id(inc.reporterId);
  const assigneeId = id(inc.assigneeId);
  const teamId = id(inc.teamId);
  return {
    id: String(inc._id),
    number: inc.number,
    key: `INC-${inc.number}`,
    title: inc.title,
    description: inc.description,
    category: inc.category,
    severity: inc.severity as IncidentDto['severity'],
    priority: inc.priority as IncidentDto['priority'],
    status: inc.status as IncidentDto['status'],
    reporter: reporterId ? (refs.users.get(reporterId) ?? { id: reporterId, name: 'Unknown user' }) : null,
    assignee: assigneeId ? (refs.users.get(assigneeId) ?? { id: assigneeId, name: 'Unknown user' }) : null,
    team: teamId ? (refs.teams.get(teamId) ?? null) : null,
    tags: inc.tags ?? [],
    sla: {
      responseDueAt: iso(inc.sla?.responseDueAt),
      resolutionDueAt: iso(inc.sla?.resolutionDueAt),
      firstRespondedAt: iso(inc.sla?.firstRespondedAt),
      response: sla.response.state,
      resolution: sla.resolution.state,
    },
    resolutionSummary: inc.resolutionSummary ?? null,
    resolvedAt: iso(inc.resolvedAt),
    closedAt: iso(inc.closedAt),
    reopenCount: inc.reopenCount ?? 0,
    createdAt: inc.createdAt.toISOString(),
    updatedAt: inc.updatedAt.toISOString(),
  };
}

export const toCommentDto = (c: CommentDoc, refs: RefMaps): CommentDto => ({
  id: String(c._id),
  incidentId: String(c.incidentId),
  author: refs.users.get(String(c.authorId)) ?? { id: String(c.authorId), name: 'Unknown user' },
  body: c.body,
  internal: c.internal,
  createdAt: c.createdAt.toISOString(),
});

export const toNotificationDto = (n: NotificationDoc): NotificationDto => ({
  id: String(n._id),
  type: n.type as NotificationDto['type'],
  title: n.title,
  body: n.body ?? '',
  incidentId: id(n.incidentId),
  readAt: iso(n.readAt),
  createdAt: n.createdAt.toISOString(),
});

export const toAttachmentDto = (a: AttachmentDoc, refs: RefMaps): AttachmentDto => ({
  id: String(a._id),
  incidentId: String(a.incidentId),
  fileName: a.fileName,
  mimeType: a.mimeType,
  size: a.size,
  uploadedBy: refs.users.get(String(a.uploadedBy)) ?? null,
  createdAt: a.createdAt.toISOString(),
});

export const toAiAnalysisDto = (a: AiAnalysisDoc): AiAnalysisDto => ({
  id: String(a._id),
  incidentId: id(a.incidentId),
  provider: a.provider,
  model: a.model,
  isMock: a.isMock,
  status: a.status as AiAnalysisDto['status'],
  result: (a.result as AiAnalysisDto['result']) ?? null,
  errorCode: a.errorCode ?? null,
  errorMessage: a.errorMessage ?? null,
  appliedFields: a.appliedFields ?? [],
  createdAt: a.createdAt.toISOString(),
});

export const toAuditLogDto = (a: AuditLogDoc, refs: RefMaps): AuditLogDto => ({
  id: String(a._id),
  action: a.action,
  entityType: a.entityType,
  entityId: a.entityId ?? null,
  actor: a.actorId ? (refs.users.get(String(a.actorId)) ?? { id: String(a.actorId), name: 'Unknown user' }) : null,
  metadata: (a.metadata as Record<string, unknown>) ?? {},
  ip: a.ip ?? null,
  createdAt: a.createdAt.toISOString(),
});

const label = (s: unknown) => String(s ?? '').replace(/_/g, ' ');

/** Human-readable timeline message derived from an audit entry. */
export function describeActivity(a: AuditLogDoc, actorName: string): string {
  const m = (a.metadata ?? {}) as Record<string, any>;
  switch (a.action) {
    case 'incident.created':
      return `${actorName} created this incident`;
    case 'incident.updated':
      return `${actorName} updated ${Object.keys(m.changes ?? {}).join(', ') || 'details'}`;
    case 'incident.assigned':
      return m.toName ? `${actorName} assigned this to ${m.toName}` : `${actorName} unassigned this incident`;
    case 'incident.status_changed':
      return `${actorName} changed status from ${label(m.from)} to ${label(m.to)}`;
    case 'incident.sla_alert':
      return `SLA alert: ${m.message ?? m.ruleId}`;
    case 'incident.ai_applied':
      return `${actorName} applied AI triage suggestions (${(m.fields ?? []).join(', ')})`;
    case 'comment.created':
      return m.internal ? `${actorName} added an internal note` : `${actorName} commented`;
    case 'attachment.added':
      return `${actorName} attached ${m.fileName ?? 'a file'}`;
    case 'attachment.removed':
      return `${actorName} removed attachment ${m.fileName ?? ''}`.trim();
    default:
      return `${actorName} — ${a.action}`;
  }
}

export function toActivityDto(a: AuditLogDoc, refs: RefMaps): ActivityDto {
  const actor = a.actorId ? (refs.users.get(String(a.actorId)) ?? null) : null;
  return {
    id: String(a._id),
    action: a.action,
    actor,
    message: describeActivity(a, actor?.name ?? 'System'),
    metadata: (a.metadata as Record<string, unknown>) ?? {},
    createdAt: a.createdAt.toISOString(),
  };
}
