import {
  ACTIVE_STATUSES,
  SOCKET_EVENTS,
  bumpPriority,
  dueAlerts,
  formatDuration,
  priorityRank,
  type EscalationRule,
  type Priority,
} from '@opspilot/shared';
import { logger } from '../config/logger';
import { Incident, Team, type IncidentDoc } from '../models';
import { writeAudit } from './audit';
import { memberIdsWithRoles, notify } from './notifications';
import { getActiveSlaPolicy } from './organizations';
import { emitToOrg } from './realtime';

export interface ScanResult {
  scanned: number;
  alertsRaised: number;
  notificationsCreated: number;
}

const BATCH = 200;

/**
 * Scans active incidents for approaching / breached SLAs and raises each configured alert exactly once.
 *
 * Idempotency + safe retries — the order of operations matters:
 *   1. send notifications with a deterministic per-user dedupeKey (re-sending is a harmless no-op)
 *   2. atomically claim the alert on the incident ($addToSet guarded by $ne) and apply side effects (priority bump)
 *   3. only the process that wins the claim writes the audit entry and emits the realtime event
 * If a job dies between 1 and 2, the retry repeats step 1 (deduped) and then completes step 2.
 * If two workers race, only one wins step 2.
 */
export async function scanSlas(opts: { now?: Date; orgId?: string } = {}): Promise<ScanResult> {
  const now = opts.now ?? new Date();
  const result: ScanResult = { scanned: 0, alertsRaised: 0, notificationsCreated: 0 };
  const policyCache = new Map<string, { rules: EscalationRule[]; active: boolean }>();

  const filter: Record<string, unknown> = {
    status: { $in: ACTIVE_STATUSES },
    'sla.resolutionDueAt': { $ne: null },
    ...(opts.orgId ? { organizationId: opts.orgId } : {}),
  };

  let lastId: unknown = null;
  for (;;) {
    const page = await Incident.find(lastId ? { ...filter, _id: { $gt: lastId } } : filter)
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean();
    if (!page.length) break;
    lastId = page[page.length - 1]?._id;

    for (const inc of page as unknown as IncidentDoc[]) {
      result.scanned++;
      const orgId = String(inc.organizationId);
      let policy = policyCache.get(orgId);
      if (!policy) {
        const p = await getActiveSlaPolicy(orgId);
        policy = { rules: (p.escalationRules ?? []) as EscalationRule[], active: p.isActive };
        policyCache.set(orgId, policy);
      }
      if (!policy.active) continue;

      const already = new Set(inc.sla?.alertsSent ?? []);
      const due = dueAlerts(
        {
          createdAt: inc.createdAt,
          responseDueAt: inc.sla?.responseDueAt,
          resolutionDueAt: inc.sla?.resolutionDueAt,
          firstRespondedAt: inc.sla?.firstRespondedAt,
          resolvedAt: inc.resolvedAt,
        },
        policy.rules,
        now,
      ).filter((a) => !already.has(a.key));

      for (const alert of due) {
        try {
          const raised = await raiseAlert(inc, alert, now);
          result.notificationsCreated += raised.notified;
          if (raised.claimed) result.alertsRaised++;
        } catch (err) {
          // One bad incident must not stop the scan; it will be retried next tick.
          logger.error({ err, incidentId: String(inc._id), rule: alert.key }, 'SLA alert failed');
        }
      }
    }
    if (page.length < BATCH) break;
  }
  return result;
}

async function raiseAlert(
  inc: IncidentDoc,
  alert: ReturnType<typeof dueAlerts>[number],
  now: Date,
): Promise<{ claimed: boolean; notified: number }> {
  const orgId = String(inc.organizationId);
  const { rule, stage, kind } = alert;
  const dueAt = stage === 'response' ? inc.sla?.responseDueAt : inc.sla?.resolutionDueAt;
  const msLeft = dueAt ? dueAt.getTime() - now.getTime() : 0;
  const stageLabel = stage === 'response' ? 'first response' : 'resolution';
  const key = `INC-${inc.number}`;
  const message =
    kind === 'breach'
      ? `${key} breached its ${stageLabel} SLA ${formatDuration(msLeft)} ago`
      : `${key} is approaching its ${stageLabel} SLA (${formatDuration(msLeft)} left)`;

  const recipients = new Set<string>();
  if (rule.notifyAssignee && inc.assigneeId) recipients.add(String(inc.assigneeId));
  for (const id of await memberIdsWithRoles(orgId, rule.notifyRoles as any)) recipients.add(id);
  if (rule.notifyTeamMembers && inc.teamId) {
    const team = await Team.findOne({ _id: inc.teamId, organizationId: orgId }, { memberIds: 1 }).lean();
    for (const id of team?.memberIds ?? []) recipients.add(String(id));
  }

  // 1. notify — deterministic dedupeKey makes this safe to repeat
  const notified = await notify({
    orgId,
    userIds: Array.from(recipients),
    type: kind === 'breach' ? 'sla_breached' : 'sla_warning',
    title: kind === 'breach' ? `SLA breached: ${key}` : `SLA warning: ${key}`,
    body: message,
    incidentId: inc._id,
    dedupeKey: `sla:${String(inc._id)}:${rule.id}`,
    minRole: 'viewer',
  });

  // 2. claim — exactly one worker wins; the priority bump rides on the same atomic update
  const set: Record<string, unknown> = {};
  let newPriority: Priority | null = null;
  if (rule.bumpPriority) {
    newPriority = bumpPriority(inc.priority as Priority);
    if (newPriority !== inc.priority) {
      set.priority = newPriority;
      set.priorityRank = priorityRank(newPriority);
    }
  }
  const claim = await Incident.updateOne(
    { _id: inc._id, organizationId: orgId, 'sla.alertsSent': { $ne: rule.id } },
    { $addToSet: { 'sla.alertsSent': rule.id }, ...(Object.keys(set).length ? { $set: set } : {}) },
  );
  if (claim.modifiedCount !== 1) return { claimed: false, notified };

  // 3. only the winner records history and pushes realtime updates
  await writeAudit({
    orgId,
    actorId: null,
    action: 'incident.sla_alert',
    entityType: 'incident',
    entityId: String(inc._id),
    metadata: { ruleId: rule.id, stage, kind, message, ...(newPriority && newPriority !== inc.priority ? { priorityFrom: inc.priority, priorityTo: newPriority } : {}) },
  });
  emitToOrg(orgId, SOCKET_EVENTS.incidentUpdated, { incidentId: String(inc._id), key, reason: 'sla_alert', kind });
  return { claimed: true, notified };
}
