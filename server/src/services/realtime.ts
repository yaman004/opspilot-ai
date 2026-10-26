import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';
import { logger } from '../config/logger';

/**
 * Publishes Socket.IO events through Redis so both the API process and the background worker can
 * reach connected sockets. When no Redis client is configured (unit tests) emitting is a no-op.
 *
 * Rooms:
 *   user:<id>           — one user (notifications)
 *   org:<id>            — every member of an organization
 *   org:<id>:staff      — agents, admins and owners (internal notes, etc.)
 * Sockets can only join org rooms after the server verifies their membership.
 */
let emitter: Emitter | null = null;
export const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
let recordEmits = false;

export function initRealtime(redis: Redis): void {
  emitter = new Emitter(redis);
}
export function recordRealtimeForTests(on: boolean): void {
  recordEmits = on;
  emitted.length = 0;
}

/** Set by the API process so membership changes can immediately pull sockets out of org rooms. */
let ioServer: { in(room: string): { socketsLeave(rooms: string[]): void } } | null = null;
export function setSocketServer(io: typeof ioServer): void {
  ioServer = io;
}

export const rooms = {
  user: (userId: string) => `user:${userId}`,
  org: (orgId: string) => `org:${orgId}`,
  staff: (orgId: string) => `org:${orgId}:staff`,
};

function send(room: string, event: string, payload: unknown): void {
  if (recordEmits) emitted.push({ room, event, payload });
  if (!emitter) return;
  try {
    emitter.to(room).emit(event, payload);
  } catch (err) {
    logger.warn({ err, event }, 'Failed to publish realtime event');
  }
}

/** Removes a user's live sockets from an org's rooms (after removal, or from staff on demotion). */
export function evictUserFromOrg(userId: string, orgId: string, opts: { staffOnly?: boolean } = {}): void {
  const leave = opts.staffOnly ? [rooms.staff(orgId)] : [rooms.org(orgId), rooms.staff(orgId)];
  if (recordEmits) emitted.push({ room: rooms.user(userId), event: 'evict', payload: { orgId, ...opts } });
  ioServer?.in(rooms.user(userId)).socketsLeave(leave);
}

export const emitToOrg =(orgId: string, event: string, payload: unknown) => send(rooms.org(orgId), event, payload);
export const emitToStaff = (orgId: string, event: string, payload: unknown) => send(rooms.staff(orgId), event, payload);
export const emitToUser = (userId: string, event: string, payload: unknown) => send(rooms.user(userId), event, payload);
