import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS, type NotificationDto } from '@opspilot/shared';
import { getAccessToken, refreshSession } from './api';
import { useAuth } from './auth';
import { useToast } from './ui-state';

/**
 * One socket per signed-in session. The server only lets it into org rooms after re-checking membership,
 * and disconnects it when the access token expires — at which point we refresh and reconnect.
 * Events never carry data to render; they just tell React Query what to refetch (so REST authorization
 * stays the single source of truth for what a user may see).
 */
export function RealtimeBridge() {
  const { status, currentOrgId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const socketRef = useRef<Socket | null>(null);
  const orgRef = useRef<string | null>(null);
  orgRef.current = currentOrgId;

  useEffect(() => {
    if (status !== 'authenticated') return;
    const socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: getAccessToken() ?? '' }),
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;

    const joinOrg = () => {
      if (orgRef.current) socket.emit('org:join', orgRef.current);
    };
    const invalidate = (...keys: string[]) => {
      const org = orgRef.current;
      for (const k of keys) void qc.invalidateQueries({ queryKey: ['org', org, k] });
    };

    socket.on('connect', joinOrg);
    socket.on('connect_error', async (err) => {
      // An expired/invalid token: get a fresh one, then let socket.io's own backoff retry with it.
      if (err.message === 'UNAUTHORIZED') await refreshSession();
    });
    socket.on('auth:expired', async () => {
      await refreshSession();
      socket.connect();
    });

    socket.on(SOCKET_EVENTS.incidentCreated, () => invalidate('incidents', 'analytics', 'search'));
    for (const ev of [SOCKET_EVENTS.incidentUpdated, SOCKET_EVENTS.incidentAssigned, SOCKET_EVENTS.incidentStatusChanged]) {
      socket.on(ev, (p: { incidentId?: string }) => {
        invalidate('incidents', 'analytics');
        if (p?.incidentId) invalidate('incident');
      });
    }
    socket.on(SOCKET_EVENTS.commentCreated, () => invalidate('incident'));
    socket.on(SOCKET_EVENTS.notificationCreated, (p: { orgId: string; notification: NotificationDto }) => {
      if (p.orgId !== orgRef.current) return;
      invalidate('notifications');
      toast.info(p.notification.title);
    });
    socket.on(SOCKET_EVENTS.membershipChanged, () => {
      // role changed or removed: re-read memberships through the REST API
      window.location.reload();
    });

    return () => {
      socket.removeAllListeners();
      socket.close();
      socketRef.current = null;
    };
  }, [status, qc, toast]);

  // Switching organizations: leave the old room, join the new one.
  const prevOrg = useRef<string | null>(null);
  useEffect(() => {
    const s = socketRef.current;
    if (s?.connected) {
      if (prevOrg.current && prevOrg.current !== currentOrgId) s.emit('org:leave', prevOrg.current);
      if (currentOrgId) s.emit('org:join', currentOrgId);
    }
    prevOrg.current = currentOrgId;
  }, [currentOrgId]);

  return null;
}
