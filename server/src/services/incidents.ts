import type { FilterQuery, Types } from 'mongoose';
import {
  ACTIVE_STATUSES,
  DEFAULT_PRIORITY_FOR_SEVERITY,
  SOCKET_EVENTS,
  canTransition,
  computeDeadlines,
  hasRole,
  isReopen,
  priorityRank,
  severityRank,
  STATUS_TRANSITIONS,
  type CommentDto,
  type CreateIncidentInput,
  type IncidentDto,
  type ListIncidentsQuery,
  type Paginated,
  type ActivityDto,
  type TransitionIncidentInput,
  type UpdateIncidentInput,
} from '@opspilot/shared';
import { env } from '../config/env';
import { AppError, badRequest, notFound, validationError } from '../lib/errors';
import { escapeRegex } from '../lib/crypto';
import { toCsv } from '../lib/csv';
import type { Actor } from '../lib/http';
import { AuditLog, Comment, Incident, Organization, Team, type CommentDoc, type IncidentDoc, type AuditLogDoc } from '../models';
import { audit } from './audit';
import { memberIdsWithRoles, notify } from './notifications';
import { assertAssignable, getActiveSlaPolicy } from './organizations';
import { emitToOrg, emitToStaff } from './realtime';
import { loadRefs, toActivityDto, toCommentDto, toIncidentDto } from './serializers';

const label = (s: string) => s.replace(/_/g, ' ');

async function assertTeam(orgId: string, teamId: string | null | undefined) {
  if (!teamId) return;
  if (!(await Team.exists({ _id: teamId, organizationId: orgId }))) throw badRequest('Team does not belong to this organization');
}

async function slaFor(orgId: string, severity: IncidentDoc['severity'], createdAt: Date) {
  const policy = await getActiveSlaPolicy(orgId);
  if (!policy.isActive) return { responseDueAt: null, resolutionDueAt: null };
  const target = (policy.targets as any)[severity];
  return computeDeadlines(createdAt, target, env.SLA_TIME_SCALE);
}

/** Org-scoped lookup. Every incident read/write in this file goes through here or filters by organizationId. */
async function loadIncident(orgId: string, incidentId: string) {
  const inc = await Incident.findOne({ _id: incidentId, organizationId: orgId });
  if (!inc) throw notFound('Incident');
  return inc;
}

async function hydrate(orgId: string, docs: IncidentDoc[]): Promise<IncidentDto[]> {
  const refs = await loadRefs(
    docs.flatMap((d) => [d.reporterId, d.assigneeId]),
    docs.map((d) => d.teamId),
    orgId,
  );
  const now = new Date();
  return docs.map((d) => toIncidentDto(d, refs, now));
}

const emitIncident = (orgId: string, event: string, inc: { _id: unknown; number: number }, extra: object = {}) =>
  emitToOrg(orgId, event, { incidentId: String(inc._id), key: `INC-${inc.number}`, ...extra });

/* ------------------------------- listing ------------------------------ */

const csvList = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

export function buildIncidentFilter(orgId: string, userId: string, q: ListIncidentsQuery): FilterQuery<IncidentDoc> {
  const f: FilterQuery<IncidentDoc> = { organizationId: orgId };
  const status = csvList(q.status);
  if (status.length) f.status = { $in: status };
  const severity = csvList(q.severity);
  if (severity.length) f.severity = { $in: severity };
  const priority = csvList(q.priority);
  if (priority.length) f.priority = { $in: priority };
  const category = csvList(q.category);
  if (category.length) f.category = { $in: category };
  if (q.assigneeId === 'me') f.assigneeId = userId;
  else if (q.assigneeId === 'unassigned') f.assigneeId = null;
  else if (q.assigneeId && /^[a-f\d]{24}$/i.test(q.assigneeId)) f.assigneeId = q.assigneeId;
  if (q.teamId === 'none') f.teamId = null;
  else if (q.teamId && /^[a-f\d]{24}$/i.test(q.teamId)) f.teamId = q.teamId;
  if (q.reporterId && /^[a-f\d]{24}$/i.test(q.reporterId)) f.reporterId = q.reporterId;
  if (q.tag) f.tags = q.tag;
  if (q.overdue === 'true') {
    f.status = { $in: ACTIVE_STATUSES };
    f['sla.resolutionDueAt'] = { $lt: new Date() };
  }
  if (q.from || q.to) {
    f.createdAt = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lte: new Date(q.to) } : {}) };
  }
  if (q.q) {
    const term = q.q.trim();
    const rx = new RegExp(escapeRegex(term), 'i');
    const num = /^(?:inc-?)?(\d{1,9})$/i.exec(term);
    f.$or = [{ title: rx }, { description: rx }, { tags: rx }, ...(num ? [{ number: Number(num[1]) }] : [])];
  }
  return f;
}

const SORT_FIELD: Record<ListIncidentsQuery['sort'], string> = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  severity: 'severityRank',
  priority: 'priorityRank',
  status: 'status',
  number: 'number',
  resolutionDueAt: 'sla.resolutionDueAt',
};

export async function listIncidents(actor: Actor, q: ListIncidentsQuery): Promise<Paginated<IncidentDto>> {
  const filter = buildIncidentFilter(actor.orgId, actor.userId, q);
  const dir = q.order === 'asc' ? 1 : -1;
  const [docs, total] = await Promise.all([
    Incident.find(filter)
      .sort({ [SORT_FIELD[q.sort]]: dir, _id: dir })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    Incident.countDocuments(filter),
  ]);
  return {
    items: await hydrate(actor.orgId, docs as unknown as IncidentDoc[]),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

export async function getIncident(actor: Actor, incidentId: string): Promise<IncidentDto> {
  const inc = await Incident.findOne({ _id: incidentId, organizationId: actor.orgId }).lean();
  if (!inc) throw notFound('Incident');
  return (await hydrate(actor.orgId, [inc as unknown as IncidentDoc]))[0] as IncidentDto;
}

/* ------------------------------- creation ------------------------------ */

export async function createIncident(actor: Actor, input: CreateIncidentInput): Promise<IncidentDto> {
  await assertTeam(actor.orgId, input.teamId);
  if (input.assigneeId) await assertAssignable(actor.orgId, input.assigneeId);

  const priority = input.priority ?? DEFAULT_PRIORITY_FOR_SEVERITY[input.severity];
  const now = new Date();
  const deadlines = await slaFor(actor.orgId, input.severity, now);

  // The per-org counter is bumped atomically ($inc), and the unique (organizationId, number) index is the
  // final guard: if a number is ever already taken (lost counter update on a MongoDB-compatible store,
  // restored backup, ...), take the next one and retry instead of failing the user's request.
  let doc: InstanceType<typeof Incident> | null = null;
  for (let attempt = 0; attempt < 30 && !doc; attempt++) {
    const org = await Organization.findOneAndUpdate({ _id: actor.orgId }, { $inc: { incidentCounter: 1 } }, { new: true });
    if (!org) throw notFound('Organization');
    try {
      doc = await Incident.create({
        organizationId: actor.orgId,
        number: org.incidentCounter,
        title: input.title,
        description: input.description,
        category: input.category,
        severity: input.severity,
        priority,
        severityRank: severityRank(input.severity),
        priorityRank: priorityRank(priority),
        status: 'open',
        reporterId: actor.userId,
        assigneeId: input.assigneeId ?? null,
        teamId: input.teamId ?? null,
        tags: input.tags ?? [],
        sla: { ...deadlines, firstRespondedAt: null, alertsSent: [] },
        createdAt: now,
      });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      await new Promise((r) => setTimeout(r, Math.random() * 15));
    }
  }
  if (!doc) throw new AppError(503, 'NUMBER_ALLOCATION_FAILED', 'Could not allocate an incident number. Please retry.');

  await audit(actor, 'incident.created', 'incident', String(doc._id), {
    key: `INC-${doc.number}`,
    severity: doc.severity,
    category: doc.category,
  });
  if (doc.assigneeId) {
    await notify({
      orgId: actor.orgId,
      userIds: [doc.assigneeId],
      type: 'incident_assigned',
      title: `INC-${doc.number} assigned to you`,
      body: doc.title,
      incidentId: doc._id,
      excludeUserId: actor.userId,
    });
  }
  if (doc.severity === 'critical') {
    await notify({
      orgId: actor.orgId,
      userIds: await memberIdsWithRoles(actor.orgId, ['owner', 'admin']),
      type: 'incident_created',
      title: `Critical incident INC-${doc.number} reported`,
      body: doc.title,
      incidentId: doc._id,
      excludeUserId: actor.userId,
    });
  }
  emitIncident(actor.orgId, SOCKET_EVENTS.incidentCreated, doc, { actorId: actor.userId });
  return getIncident(actor, String(doc._id));
}

/* -------------------------------- update ------------------------------- */

export async function updateIncident(actor: Actor, incidentId: string, patch: UpdateIncidentInput): Promise<IncidentDto> {
  const inc = await loadIncident(actor.orgId, incidentId);
  if (inc.status === 'closed') throw new AppError(409, 'INCIDENT_CLOSED', 'Reopen this incident before editing it');
  if (patch.teamId !== undefined) await assertTeam(actor.orgId, patch.teamId);

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const set: Record<string, unknown> = {};
  for (const key of ['title', 'description', 'category', 'severity', 'priority', 'tags'] as const) {
    const next = patch[key];
    if (next === undefined) continue;
    const prev = (inc as any)[key];
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    changes[key] = { from: prev, to: next };
    set[key] = next;
  }
  if (patch.teamId !== undefined && String(inc.teamId ?? '') !== String(patch.teamId ?? '')) {
    changes.teamId = { from: inc.teamId ? String(inc.teamId) : null, to: patch.teamId };
    set.teamId = patch.teamId;
  }
  if (!Object.keys(changes).length) return getIncident(actor, incidentId);

  if (set.severity) {
    set.severityRank = severityRank(set.severity as any);
    // A different severity means different SLA targets; deadlines restart from creation and alerts re-arm.
    const d = await slaFor(actor.orgId, set.severity as any, inc.createdAt);
    set['sla.responseDueAt'] = d.responseDueAt;
    set['sla.resolutionDueAt'] = d.resolutionDueAt;
    set['sla.alertsSent'] = [];
  }
  if (set.priority) set.priorityRank = priorityRank(set.priority as any);

  await Incident.updateOne({ _id: inc._id, organizationId: actor.orgId }, { $set: set });
  await audit(actor, 'incident.updated', 'incident', incidentId, { changes });
  emitIncident(actor.orgId, SOCKET_EVENTS.incidentUpdated, inc, { actorId: actor.userId, reason: 'updated' });
  return getIncident(actor, incidentId);
}

/* -------------------------------- assign ------------------------------- */

export async function assignIncident(actor: Actor, incidentId: string, assigneeId: string | null): Promise<IncidentDto> {
  const inc = await loadIncident(actor.orgId, incidentId);
  if (inc.status === 'closed') throw new AppError(409, 'INCIDENT_CLOSED', 'Reopen this incident before assigning it');
  if (assigneeId) await assertAssignable(actor.orgId, assigneeId);
  const prev = inc.assigneeId ? String(inc.assigneeId) : null;
  if (prev === assigneeId) return getIncident(actor, incidentId);

  await Incident.updateOne({ _id: inc._id, organizationId: actor.orgId }, { $set: { assigneeId } });
  const refs = await loadRefs([assigneeId, prev]);
  await audit(actor, 'incident.assigned', 'incident', incidentId, {
    from: prev,
    to: assigneeId,
    fromName: prev ? refs.users.get(prev)?.name : null,
    toName: assigneeId ? refs.users.get(assigneeId)?.name : null,
  });
  if (assigneeId) {
    await notify({
      orgId: actor.orgId,
      userIds: [assigneeId],
      type: 'incident_assigned',
      title: `INC-${inc.number} assigned to you`,
      body: inc.title,
      incidentId: inc._id,
      excludeUserId: actor.userId,
    });
  }
  emitIncident(actor.orgId, SOCKET_EVENTS.incidentAssigned, inc, { assigneeId, actorId: actor.userId });
  return getIncident(actor, incidentId);
}

/* ------------------------------- transition ---------------------------- */

export async function transitionIncident(actor: Actor, incidentId: string, input: TransitionIncidentInput): Promise<IncidentDto> {
  const inc = await loadIncident(actor.orgId, incidentId);
  const from = inc.status as IncidentDoc['status'];
  const to = input.status;

  if (!canTransition(from as any, to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot move an incident from ${label(from)} to ${label(to)}`, {
      from,
      to,
      allowed: STATUS_TRANSITIONS[from as keyof typeof STATUS_TRANSITIONS],
    });
  }
  if (to === 'resolved' && !input.resolutionSummary) {
    throw validationError([{ path: 'resolutionSummary', message: 'A resolution summary is required to resolve an incident' }]);
  }

  const now = new Date();
  const set: Record<string, unknown> = { status: to };
  if (to === 'resolved') {
    set.resolvedAt = now;
    set.resolutionSummary = input.resolutionSummary;
  }
  if (to === 'closed') set.closedAt = now;
  const reopening = isReopen(from as any, to);
  if (reopening) {
    set.resolvedAt = null;
    set.closedAt = null;
  }
  // The first move out of "open" is the first response.
  if (from === 'open' && to !== 'open' && !inc.sla?.firstRespondedAt) set['sla.firstRespondedAt'] = now;

  // Compare-and-set on the previous status: two people racing cannot both win.
  const updated = await Incident.findOneAndUpdate(
    { _id: inc._id, organizationId: actor.orgId, status: from },
    { $set: set, ...(reopening ? { $inc: { reopenCount: 1 } } : {}) },
    { new: true },
  );
  if (!updated) throw new AppError(409, 'STALE_STATE', 'This incident was just changed by someone else. Refresh and try again.');

  await audit(actor, 'incident.status_changed', 'incident', incidentId, {
    from,
    to,
    ...(input.note ? { note: input.note } : {}),
    ...(to === 'resolved' ? { resolutionSummary: input.resolutionSummary } : {}),
    ...(reopening ? { reopened: true } : {}),
  });
  await notify({
    orgId: actor.orgId,
    userIds: [inc.reporterId, inc.assigneeId],
    type: 'incident_status_changed',
    title: `INC-${inc.number} ${reopening ? 'reopened' : `moved to ${label(to)}`}`,
    body: inc.title,
    incidentId: inc._id,
    excludeUserId: actor.userId,
  });
  emitIncident(actor.orgId, SOCKET_EVENTS.incidentStatusChanged, inc, { from, to, actorId: actor.userId });
  return getIncident(actor, incidentId);
}

/* -------------------------------- comments ----------------------------- */

export async function listComments(actor: Actor, incidentId: string): Promise<CommentDto[]> {
  if (!(await Incident.exists({ _id: incidentId, organizationId: actor.orgId }))) throw notFound('Incident');
  const canSeeInternal = hasRole(actor.role, 'agent');
  const rows = await Comment.find({
    organizationId: actor.orgId,
    incidentId,
    ...(canSeeInternal ? {} : { internal: false }),
  })
    .sort({ createdAt: 1 })
    .lean();
  const refs = await loadRefs(rows.map((r) => r.authorId));
  return rows.map((r) => toCommentDto(r as unknown as CommentDoc, refs));
}

export async function createComment(
  actor: Actor,
  incidentId: string,
  input: { body: string; internal: boolean },
): Promise<CommentDto> {
  const inc = await loadIncident(actor.orgId, incidentId);
  const comment = await Comment.create({
    organizationId: actor.orgId,
    incidentId: inc._id,
    authorId: actor.userId,
    body: input.body,
    internal: input.internal,
  });

  // A public reply from a responder (not the reporter) counts as the first response.
  if (!input.internal && !inc.sla?.firstRespondedAt && String(inc.reporterId) !== actor.userId && hasRole(actor.role, 'agent')) {
    await Incident.updateOne(
      { _id: inc._id, organizationId: actor.orgId, 'sla.firstRespondedAt': null },
      { $set: { 'sla.firstRespondedAt': comment.createdAt } },
    );
  }

  await audit(actor, 'comment.created', 'incident', incidentId, { commentId: String(comment._id), internal: input.internal });
  await notify({
    orgId: actor.orgId,
    userIds: [inc.assigneeId, inc.reporterId],
    type: 'incident_comment',
    title: `${input.internal ? 'Internal note' : 'New comment'} on INC-${inc.number}`,
    body: input.body.slice(0, 200),
    incidentId: inc._id,
    excludeUserId: actor.userId,
    minRole: input.internal ? 'agent' : 'viewer',
  });

  const refs = await loadRefs([actor.userId]);
  const dto = toCommentDto(comment.toObject() as unknown as CommentDoc, refs);
  const payload = { incidentId, key: `INC-${inc.number}`, commentId: dto.id, internal: dto.internal, actorId: actor.userId };
  // Internal notes only ever go to the staff room — viewers' sockets never see them.
  if (dto.internal) emitToStaff(actor.orgId, SOCKET_EVENTS.commentCreated, payload);
  else emitToOrg(actor.orgId, SOCKET_EVENTS.commentCreated, payload);
  return dto;
}

/* ------------------------------ timeline etc. -------------------------- */

export async function getActivity(actor: Actor, incidentId: string): Promise<ActivityDto[]> {
  if (!(await Incident.exists({ _id: incidentId, organizationId: actor.orgId }))) throw notFound('Incident');
  const canSeeInternal = hasRole(actor.role, 'agent');
  const rows = await AuditLog.find({
    organizationId: actor.orgId,
    entityType: 'incident',
    entityId: incidentId,
    ...(canSeeInternal ? {} : { 'metadata.internal': { $ne: true }, action: { $ne: 'incident.ai_applied' } }),
  })
    .sort({ createdAt: 1 })
    .limit(500)
    .lean();
  const refs = await loadRefs(rows.map((r) => r.actorId));
  return rows.map((r) => toActivityDto(r as unknown as AuditLogDoc, refs));
}

export async function relatedIncidents(actor: Actor, incidentId: string): Promise<IncidentDto[]> {
  const inc = await Incident.findOne({ _id: incidentId, organizationId: actor.orgId }).lean();
  if (!inc) throw notFound('Incident');
  const or: FilterQuery<IncidentDoc>[] = [{ category: inc.category, ...(inc.teamId ? { teamId: inc.teamId } : {}) }];
  if (inc.tags?.length) or.push({ tags: { $in: inc.tags } });
  const candidates = await Incident.find({ organizationId: actor.orgId, _id: { $ne: inc._id }, $or: or })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  const tagSet = new Set(inc.tags ?? []);
  const scored = candidates
    .map((c) => ({
      c,
      score:
        2 * (c.tags ?? []).filter((t) => tagSet.has(t)).length +
        (c.category === inc.category ? 1 : 0) +
        (inc.teamId && String(c.teamId) === String(inc.teamId) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || b.c.createdAt.getTime() - a.c.createdAt.getTime())
    .slice(0, 5)
    .map((s) => s.c);
  return hydrate(actor.orgId, scored as unknown as IncidentDoc[]);
}

/* --------------------------------- export ------------------------------ */

export const EXPORT_LIMIT = 5000;

export async function exportIncidentsCsv(actor: Actor, q: ListIncidentsQuery): Promise<{ csv: string; count: number }> {
  const filter = buildIncidentFilter(actor.orgId, actor.userId, q);
  const docs = await Incident.find(filter).sort({ createdAt: -1 }).limit(EXPORT_LIMIT).lean();
  const items = await hydrate(actor.orgId, docs as unknown as IncidentDoc[]);
  const csv = toCsv(
    [
      'Key',
      'Title',
      'Status',
      'Severity',
      'Priority',
      'Category',
      'Team',
      'Assignee',
      'Reporter',
      'Tags',
      'Created (UTC)',
      'Response due (UTC)',
      'Resolution due (UTC)',
      'Resolved (UTC)',
      'Resolution SLA',
      'Resolution summary',
    ],
    items.map((i) => [
      i.key,
      i.title,
      i.status,
      i.severity,
      i.priority,
      i.category,
      i.team?.name,
      i.assignee?.name,
      i.reporter?.name,
      i.tags.join('; '),
      i.createdAt,
      i.sla.responseDueAt,
      i.sla.resolutionDueAt,
      i.resolvedAt,
      i.sla.resolution,
      i.resolutionSummary,
    ]),
  );
  await audit(actor, 'incident.exported', 'incident', null, { count: items.length, filters: q });
  return { csv, count: items.length };
}

export type { Types };
