import { SOCKET_EVENTS, hasRole, type NotificationType, type Role } from '@opspilot/shared';
import { Types } from 'mongoose';
import { Membership, Notification } from '../models';
import { randomToken } from '../lib/crypto';
import { logger } from '../config/logger';
import { emitToUser } from './realtime';
import { toNotificationDto } from './serializers';
import { notFound } from '../lib/errors';

export interface NotifyInput {
  orgId: string;
  userIds: Array<string | Types.ObjectId | null | undefined>;
  type: NotificationType;
  title: string;
  body?: string;
  incidentId?: string | Types.ObjectId | null;
  /** When set, a user receives at most one notification with this key (idempotent alerts). */
  dedupeKey?: string;
  excludeUserId?: string;
  /** Only deliver to members whose role is at least this. */
  minRole?: Role;
}

/**
 * Creates persistent notifications and pushes them over sockets.
 * Recipients that are not active members of the organization are silently dropped, so a
 * notification can never leak into an organization the user does not belong to.
 * Returns the number of notifications newly created.
 */
export async function notify(input: NotifyInput): Promise<number> {
  const unique = Array.from(new Set(input.userIds.filter(Boolean).map(String))).filter((u) => u !== input.excludeUserId);
  if (!unique.length) return 0;

  const memberships = await Membership.find({ organizationId: input.orgId, userId: { $in: unique } }).lean();
  const allowed = memberships.filter((m) => !input.minRole || hasRole(m.role as Role, input.minRole));
  let created = 0;

  for (const m of allowed) {
    try {
      const doc = await Notification.create({
        organizationId: input.orgId,
        userId: m.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        incidentId: input.incidentId ?? null,
        dedupeKey: input.dedupeKey ?? `n:${randomToken(12)}`,
      });
      created++;
      emitToUser(String(m.userId), SOCKET_EVENTS.notificationCreated, {
        orgId: input.orgId,
        notification: toNotificationDto(doc.toObject() as any),
      });
    } catch (err: any) {
      if (err?.code === 11000) continue; // already delivered — idempotent
      logger.error({ err }, 'Failed to create notification');
    }
  }
  return created;
}

/** Ids of members with at least `minRole` (used for escalation fan-out). */
export async function memberIdsWithRoles(orgId: string, roles: Role[]): Promise<string[]> {
  if (!roles.length) return [];
  const rows = await Membership.find({ organizationId: orgId, role: { $in: roles } }, { userId: 1 }).lean();
  return rows.map((r) => String(r.userId));
}

export async function listNotifications(orgId: string, userId: string, page: number, pageSize: number, unread?: boolean) {
  const filter: Record<string, unknown> = { organizationId: orgId, userId };
  if (unread) filter.readAt = null;
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ organizationId: orgId, userId, readAt: null }),
  ]);
  return {
    items: items.map((n) => toNotificationDto(n as any)),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    unreadCount,
  };
}

export async function markRead(orgId: string, userId: string, notificationId: string) {
  // Scoped by org AND owner: a user can only ever touch their own notifications.
  const doc = await Notification.findOneAndUpdate(
    { _id: notificationId, organizationId: orgId, userId },
    { $set: { readAt: new Date() } },
    { new: true },
  ).lean();
  if (!doc) throw notFound('Notification');
  return toNotificationDto(doc as any);
}

export async function markAllRead(orgId: string, userId: string): Promise<number> {
  const res = await Notification.updateMany({ organizationId: orgId, userId, readAt: null }, { $set: { readAt: new Date() } });
  return res.modifiedCount;
}
