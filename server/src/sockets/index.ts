import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { hasRole, type Role } from '@opspilot/shared';
import { logger } from '../config/logger';
import { isObjectId } from '../lib/http';
import { verifyAccessToken } from '../lib/tokens';
import { allowedOrigins } from '../middleware/core';
import { Membership, RefreshSession } from '../models';
import { rooms, setSocketServer } from '../services/realtime';

interface SocketData {
  userId: string;
  familyId: string;
  exp: number;
}

/**
 * Authorization model:
 *  - the handshake must carry a valid access token whose session is still active
 *  - a socket starts with access to ONE room only: user:<id>
 *  - org rooms are joined via "org:join", which re-checks membership in the database
 *  - internal-note events go to org:<id>:staff, which viewers are never added to
 *  - sockets are disconnected when their access token expires (the client refreshes and reconnects)
 *  - membership removal / demotion evicts live sockets (see evictUserFromOrg)
 */
export function attachSockets(httpServer: HttpServer, redis?: { pub: Redis; sub: Redis }): Server {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: (origin, cb) => cb(null, !origin || allowedOrigins().includes(origin)),
      credentials: true,
    },
    ...(redis ? { adapter: createAdapter(redis.pub, redis.sub) } : {}),
  });
  setSocketServer(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('UNAUTHORIZED'));
      const claims = verifyAccessToken(token);
      const active = await RefreshSession.exists({
        familyId: claims.familyId,
        userId: claims.userId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      if (!active) return next(new Error('UNAUTHORIZED'));
      socket.data = { userId: claims.userId, familyId: claims.familyId, exp: claims.exp } satisfies SocketData;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;
    socket.join(rooms.user(data.userId));

    const msUntilExpiry = data.exp * 1000 - Date.now();
    const timer = setTimeout(() => {
      socket.emit('auth:expired');
      socket.disconnect(true);
    }, Math.max(msUntilExpiry, 0));
    socket.on('disconnect', () => clearTimeout(timer));

    socket.on('org:join', async (orgId: unknown, ack?: (res: { ok: boolean; role?: Role; error?: string }) => void) => {
      try {
        if (!isObjectId(orgId)) return ack?.({ ok: false, error: 'INVALID_ORG' });
        const m = await Membership.findOne({ userId: data.userId, organizationId: orgId }, { role: 1 }).lean();
        if (!m) return ack?.({ ok: false, error: 'FORBIDDEN' });
        await socket.join(rooms.org(orgId));
        if (hasRole(m.role as Role, 'agent')) await socket.join(rooms.staff(orgId));
        else await socket.leave(rooms.staff(orgId));
        ack?.({ ok: true, role: m.role as Role });
      } catch (err) {
        logger.error({ err }, 'org:join failed');
        ack?.({ ok: false, error: 'SERVER_ERROR' });
      }
    });

    socket.on('org:leave', async (orgId: unknown) => {
      if (!isObjectId(orgId)) return;
      await socket.leave(rooms.org(orgId));
      await socket.leave(rooms.staff(orgId));
    });
  });

  return io;
}
