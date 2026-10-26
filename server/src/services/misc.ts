import { hasRole, type AuditLogDto, type Paginated, type Role } from '@opspilot/shared';
import { AuditLog, Incident, Membership, Team, User, type AuditLogDoc } from '../models';
import { escapeRegex } from '../lib/crypto';
import { loadRefs, toAuditLogDto } from './serializers';

export async function listAuditLogs(
  orgId: string,
  q: { page: number; pageSize: number; action?: string; entityType?: string; actorId?: string; from?: string; to?: string },
): Promise<Paginated<AuditLogDto>> {
  const filter: Record<string, unknown> = { organizationId: orgId };
  if (q.action) filter.action = { $regex: `^${escapeRegex(q.action)}` };
  if (q.entityType) filter.entityType = q.entityType;
  if (q.actorId) filter.actorId = q.actorId;
  if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lte: new Date(q.to) } : {}) };
  const [rows, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  const refs = await loadRefs(rows.map((r) => r.actorId));
  return {
    items: rows.map((r) => toAuditLogDto(r as unknown as AuditLogDoc, refs)),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

/** Global search across incidents, teams and members of ONE organization. */
export async function globalSearch(orgId: string, role: Role, rawQuery: string) {
  const term = rawQuery.trim();
  if (term.length < 2) return { incidents: [], teams: [], members: [] };
  const rx = new RegExp(escapeRegex(term), 'i');
  const num = /^(?:inc-?)?(\d{1,9})$/i.exec(term);

  const [incidents, teams, memberships] = await Promise.all([
    Incident.find(
      { organizationId: orgId, $or: [{ title: rx }, { tags: rx }, ...(num ? [{ number: Number(num[1]) }] : [])] },
      { number: 1, title: 1, status: 1, severity: 1 },
    )
      .sort({ createdAt: -1 })
      .limit(6)
      .lean(),
    Team.find({ organizationId: orgId, name: rx }, { name: 1 }).limit(4).lean(),
    hasRole(role, 'viewer') ? Membership.find({ organizationId: orgId }, { userId: 1, role: 1 }).lean() : [],
  ]);
  const users = memberships.length
    ? await User.find({ _id: { $in: memberships.map((m) => m.userId) }, $or: [{ name: rx }, { email: rx }] }, { name: 1, email: 1 })
        .limit(4)
        .lean()
    : [];
  return {
    incidents: incidents.map((i) => ({ id: String(i._id), key: `INC-${i.number}`, title: i.title, status: i.status, severity: i.severity })),
    teams: teams.map((t) => ({ id: String(t._id), name: t.name })),
    members: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email })),
  };
}
