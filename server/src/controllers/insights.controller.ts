import { actorFrom, asyncHandler } from '../lib/http';
import { getOverview } from '../services/analytics';
import { listAuditLogs, globalSearch } from '../services/misc';
import * as notifications from '../services/notifications';

export const overview = asyncHandler(async (req, res) => {
  res.json(await getOverview(req.org!.orgId, req.query as any));
});

export const auditLogs = asyncHandler(async (req, res) => {
  res.json(await listAuditLogs(req.org!.orgId, req.query as any));
});

export const search = asyncHandler(async (req, res) => {
  res.json(await globalSearch(req.org!.orgId, req.org!.role, String(req.query.q ?? '')));
});

export const listNotifications = asyncHandler(async (req, res) => {
  const q = req.query as unknown as { page: number; pageSize: number; unread?: 'true' | 'false' };
  res.json(await notifications.listNotifications(req.org!.orgId, req.auth!.userId, q.page, q.pageSize, q.unread === 'true'));
});
export const markRead = asyncHandler(async (req, res) => {
  res.json({ notification: await notifications.markRead(req.org!.orgId, req.auth!.userId, req.params.notificationId as string) });
});
export const markAllRead = asyncHandler(async (req, res) => {
  res.json({ updated: await notifications.markAllRead(req.org!.orgId, req.auth!.userId) });
});

export { actorFrom };
