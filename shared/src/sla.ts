import type { Priority, Severity } from './constants';
import { PRIORITIES } from './constants';
import type { EscalationRule } from './schemas';

export interface SlaTarget {
  responseMinutes: number;
  resolutionMinutes: number;
}
export type SlaTargets = Record<Severity, SlaTarget>;

export const DEFAULT_SLA_TARGETS: SlaTargets = {
  critical: { responseMinutes: 15, resolutionMinutes: 4 * 60 },
  high: { responseMinutes: 60, resolutionMinutes: 8 * 60 },
  medium: { responseMinutes: 4 * 60, resolutionMinutes: 48 * 60 },
  low: { responseMinutes: 24 * 60, resolutionMinutes: 7 * 24 * 60 },
};

export const DEFAULT_ESCALATION_RULES: EscalationRule[] = [
  {
    id: 'resp-warn-75',
    trigger: 'response_warning',
    thresholdPercent: 75,
    notifyRoles: [],
    notifyAssignee: true,
    notifyTeamMembers: true,
    bumpPriority: false,
  },
  {
    id: 'resp-breach',
    trigger: 'response_breach',
    notifyRoles: ['admin', 'owner'],
    notifyAssignee: true,
    notifyTeamMembers: false,
    bumpPriority: false,
  },
  {
    id: 'res-warn-80',
    trigger: 'resolution_warning',
    thresholdPercent: 80,
    notifyRoles: [],
    notifyAssignee: true,
    notifyTeamMembers: true,
    bumpPriority: false,
  },
  {
    id: 'res-breach',
    trigger: 'resolution_breach',
    notifyRoles: ['admin', 'owner'],
    notifyAssignee: true,
    notifyTeamMembers: false,
    bumpPriority: true,
  },
];

/**
 * Converts SLA minutes to milliseconds. `timeScale` > 1 compresses time for development
 * (timeScale 60 => one SLA "minute" lasts one real second).
 */
export function slaMinutesToMs(minutes: number, timeScale = 1): number {
  const scale = timeScale > 0 ? timeScale : 1;
  return Math.round((minutes * 60_000) / scale);
}

export function computeDeadlines(
  createdAt: Date,
  target: SlaTarget,
  timeScale = 1,
): { responseDueAt: Date; resolutionDueAt: Date } {
  return {
    responseDueAt: new Date(createdAt.getTime() + slaMinutesToMs(target.responseMinutes, timeScale)),
    resolutionDueAt: new Date(createdAt.getTime() + slaMinutesToMs(target.resolutionMinutes, timeScale)),
  };
}

export type SlaStage = 'response' | 'resolution';
export type SlaStageState = 'met' | 'met_late' | 'pending' | 'breached';

export interface SlaSnapshotInput {
  createdAt: Date;
  responseDueAt?: Date | null;
  resolutionDueAt?: Date | null;
  firstRespondedAt?: Date | null;
  resolvedAt?: Date | null;
}

export interface SlaStageEvaluation {
  state: SlaStageState;
  dueAt: Date | null;
  /** 0..n — share of the window that has elapsed (clamped at 0 minimum, not capped above 1). */
  elapsedFraction: number;
  /** Negative once overdue. */
  msRemaining: number | null;
}

function evaluateStage(
  start: Date,
  due: Date | null | undefined,
  completedAt: Date | null | undefined,
  now: Date,
): SlaStageEvaluation {
  if (!due) return { state: completedAt ? 'met' : 'pending', dueAt: null, elapsedFraction: 0, msRemaining: null };
  const window = Math.max(due.getTime() - start.getTime(), 1);
  if (completedAt) {
    const state: SlaStageState = completedAt.getTime() <= due.getTime() ? 'met' : 'met_late';
    return {
      state,
      dueAt: due,
      elapsedFraction: Math.max(0, (completedAt.getTime() - start.getTime()) / window),
      msRemaining: due.getTime() - completedAt.getTime(),
    };
  }
  const elapsed = Math.max(0, (now.getTime() - start.getTime()) / window);
  const remaining = due.getTime() - now.getTime();
  return { state: remaining < 0 ? 'breached' : 'pending', dueAt: due, elapsedFraction: elapsed, msRemaining: remaining };
}

export function evaluateSla(input: SlaSnapshotInput, now: Date = new Date()) {
  return {
    response: evaluateStage(input.createdAt, input.responseDueAt, input.firstRespondedAt, now),
    resolution: evaluateStage(input.createdAt, input.resolutionDueAt, input.resolvedAt, now),
  };
}

export interface DueAlert {
  /** Stable key — stored on the incident so an alert fires at most once. */
  key: string;
  rule: EscalationRule;
  stage: SlaStage;
  kind: 'warning' | 'breach';
}

/**
 * Pure decision function used by the SLA worker: given an incident snapshot and the policy's rules,
 * which alerts should be (or should already have been) raised at `now`?
 * The caller filters out keys that were already recorded to stay idempotent.
 */
export function dueAlerts(input: SlaSnapshotInput, rules: EscalationRule[], now: Date = new Date()): DueAlert[] {
  const ev = evaluateSla(input, now);
  const out: DueAlert[] = [];
  for (const rule of rules) {
    const stage: SlaStage = rule.trigger.startsWith('response') ? 'response' : 'resolution';
    const kind: 'warning' | 'breach' = rule.trigger.endsWith('warning') ? 'warning' : 'breach';
    const stageEval = ev[stage];
    if (stageEval.state === 'met' || stageEval.state === 'met_late') continue; // already completed
    if (!stageEval.dueAt) continue;
    if (kind === 'breach' && stageEval.state === 'breached') {
      out.push({ key: `${rule.id}`, rule, stage, kind });
    }
    if (kind === 'warning' && stageEval.state === 'pending') {
      const threshold = (rule.thresholdPercent ?? 80) / 100;
      if (stageEval.elapsedFraction >= threshold) out.push({ key: `${rule.id}`, rule, stage, kind });
    }
  }
  return out;
}

export function bumpPriority(p: Priority): Priority {
  const i = PRIORITIES.indexOf(p);
  return PRIORITIES[Math.min(i + 1, PRIORITIES.length - 1)] as Priority;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / 60_000);
  if (mins < 1) return `${Math.max(1, Math.round(abs / 1000))}s`;
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
