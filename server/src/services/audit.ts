import { AuditLog } from '../models';
import { logger } from '../config/logger';
import type { Actor } from '../lib/http';

export interface AuditInput {
  orgId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  requestId?: string | null;
}

/** Audit writes must never break the user's request, but failures are logged loudly. */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      organizationId: input.orgId,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
      requestId: input.requestId ?? null,
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'Failed to write audit log');
  }
}

export const audit = (
  actor: Pick<Actor, 'orgId' | 'userId' | 'ip' | 'requestId'>,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) =>
  writeAudit({
    orgId: actor.orgId,
    actorId: actor.userId,
    action,
    entityType,
    entityId,
    metadata,
    ip: actor.ip,
    requestId: actor.requestId,
  });
