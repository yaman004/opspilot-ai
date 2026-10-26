import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ESCALATION_RULES,
  DEFAULT_SLA_TARGETS,
  aiTriageResultSchema,
  bumpPriority,
  can,
  canAssignRole,
  canRemoveMember,
  canTransition,
  computeCategoryDistribution,
  computeDeadlines,
  computeKpis,
  computeResolutionRates,
  computeTeamWorkload,
  computeTrend,
  createIncidentSchema,
  dueAlerts,
  evaluateSla,
  formatDuration,
  isReopen,
  passwordSchema,
  slaMinutesToMs,
  upsertSlaPolicySchema,
  type AnalyticsRow,
} from './index';

const t0 = new Date('2026-01-01T00:00:00.000Z');
const mins = (n: number) => new Date(t0.getTime() + n * 60_000);

describe('status state machine', () => {
  it('allows legal transitions and rejects illegal ones', () => {
    expect(canTransition('open', 'triaged')).toBe(true);
    expect(canTransition('in_progress', 'resolved')).toBe(true);
    expect(canTransition('open', 'closed')).toBe(false);
    expect(canTransition('closed', 'in_progress')).toBe(false);
    expect(canTransition('resolved', 'closed')).toBe(true);
  });
  it('identifies reopen transitions', () => {
    expect(isReopen('resolved', 'open')).toBe(true);
    expect(isReopen('closed', 'open')).toBe(true);
    expect(isReopen('open', 'triaged')).toBe(false);
    expect(isReopen('resolved', 'closed')).toBe(false);
  });
});

describe('permissions', () => {
  it('enforces the role matrix', () => {
    expect(can('viewer', 'incident:read')).toBe(true);
    expect(can('viewer', 'incident:create')).toBe(false);
    expect(can('agent', 'incident:create')).toBe(true);
    expect(can('agent', 'sla:manage')).toBe(false);
    expect(can('admin', 'audit:read')).toBe(true);
    expect(can('admin', 'org:delete')).toBe(false);
    expect(can('owner', 'org:delete')).toBe(true);
    expect(can(undefined, 'incident:read')).toBe(false);
  });
  it('applies role-management hierarchy', () => {
    expect(canAssignRole('admin', 'agent', 'viewer', false)).toBe(true);
    expect(canAssignRole('admin', 'agent', 'admin', false)).toBe(false);
    expect(canAssignRole('admin', 'admin', 'agent', false)).toBe(false);
    expect(canAssignRole('owner', 'agent', 'admin', false)).toBe(true);
    expect(canAssignRole('owner', 'admin', 'agent', true)).toBe(false);
    expect(canAssignRole('agent', 'viewer', 'agent', false)).toBe(false);
    expect(canRemoveMember('admin', 'owner')).toBe(false);
    expect(canRemoveMember('admin', 'viewer')).toBe(true);
  });
});

describe('SLA math', () => {
  it('computes deadlines in UTC and honours the dev time scale', () => {
    const d = computeDeadlines(t0, { responseMinutes: 15, resolutionMinutes: 240 });
    expect(d.responseDueAt.toISOString()).toBe('2026-01-01T00:15:00.000Z');
    expect(d.resolutionDueAt.toISOString()).toBe('2026-01-01T04:00:00.000Z');
    const fast = computeDeadlines(t0, { responseMinutes: 15, resolutionMinutes: 240 }, 60);
    expect(fast.responseDueAt.getTime() - t0.getTime()).toBe(15_000);
    expect(slaMinutesToMs(1, 0)).toBe(60_000); // invalid scale falls back to 1
  });

  it('evaluates pending, breached, met and met_late states', () => {
    const base = { createdAt: t0, ...computeDeadlines(t0, DEFAULT_SLA_TARGETS.critical) };
    expect(evaluateSla(base, mins(5)).response.state).toBe('pending');
    expect(evaluateSla(base, mins(16)).response.state).toBe('breached');
    expect(evaluateSla({ ...base, firstRespondedAt: mins(10) }, mins(500)).response.state).toBe('met');
    expect(evaluateSla({ ...base, firstRespondedAt: mins(20) }, mins(500)).response.state).toBe('met_late');
    expect(evaluateSla({ ...base, resolvedAt: mins(200) }, mins(500)).resolution.state).toBe('met');
    expect(evaluateSla(base, mins(11)).response.elapsedFraction).toBeCloseTo(11 / 15, 5);
  });

  it('decides which alerts are due', () => {
    const snap = { createdAt: t0, ...computeDeadlines(t0, DEFAULT_SLA_TARGETS.critical) };
    expect(dueAlerts(snap, DEFAULT_ESCALATION_RULES, mins(5))).toHaveLength(0);
    // 75% of 15 minutes = 11.25 minutes
    expect(dueAlerts(snap, DEFAULT_ESCALATION_RULES, mins(12)).map((a) => a.key)).toEqual(['resp-warn-75']);
    const breached = dueAlerts(snap, DEFAULT_ESCALATION_RULES, mins(16)).map((a) => a.key);
    expect(breached).toContain('resp-breach');
    expect(breached).not.toContain('resp-warn-75'); // warning is superseded once breached
    // once responded, response alerts stop
    const responded = dueAlerts({ ...snap, firstRespondedAt: mins(3) }, DEFAULT_ESCALATION_RULES, mins(16)).map(
      (a) => a.key,
    );
    expect(responded).not.toContain('resp-breach');
  });

  it('bumps priority one step, capped at urgent', () => {
    expect(bumpPriority('low')).toBe('medium');
    expect(bumpPriority('urgent')).toBe('urgent');
  });

  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(90_000)).toBe('1m');
    expect(formatDuration(3 * 3_600_000 + 5 * 60_000)).toBe('3h 5m');
    expect(formatDuration(3 * 24 * 3_600_000)).toBe('3d 0h');
  });
});

const row = (over: Partial<AnalyticsRow>): AnalyticsRow => ({
  createdAt: t0,
  status: 'open',
  severity: 'medium',
  category: 'application',
  ...over,
});

describe('analytics math', () => {
  const now = mins(600);
  const rows: AnalyticsRow[] = [
    row({ severity: 'critical', responseDueAt: mins(15), resolutionDueAt: mins(240), firstRespondedAt: mins(5) }), // open, overdue
    row({
      status: 'resolved',
      severity: 'high',
      responseDueAt: mins(60),
      resolutionDueAt: mins(480),
      firstRespondedAt: mins(30),
      resolvedAt: mins(300),
      teamId: 't1',
    }),
    row({
      status: 'resolved',
      severity: 'high',
      responseDueAt: mins(60),
      resolutionDueAt: mins(480),
      firstRespondedAt: mins(90),
      resolvedAt: mins(500),
      teamId: 't1',
    }),
    row({ status: 'in_progress', severity: 'low', resolutionDueAt: mins(10_000), teamId: 't2', category: 'network' }),
  ];

  it('derives KPIs from rows', () => {
    const k = computeKpis(rows, rows, now);
    expect(k.openIncidents).toBe(2);
    expect(k.criticalIncidents).toBe(1);
    expect(k.overdueIncidents).toBe(1);
    expect(k.avgResponseMs).toBe(((5 + 30 + 90) / 3) * 60_000);
    expect(k.avgResolutionMs).toBe(((300 + 500) / 2) * 60_000);
    // resolution eligible: all 4. ok: #2 (300<=480), #4 (now<=10000). #1 pending but overdue => not ok; #3 late => not ok
    expect(k.resolutionSlaCompliance).toBe(50);
    expect(k.responseSlaCompliance).toBeCloseTo(66.7, 1);
    expect(k.resolvedInRange).toBe(2);
  });

  it('returns null rates when there is no data', () => {
    const k = computeKpis([], [], now);
    expect(k.resolutionSlaCompliance).toBeNull();
    expect(k.avgResolutionMs).toBeNull();
    expect(k.openIncidents).toBe(0);
  });

  it('builds a UTC daily trend, workload, distributions and resolution rates', () => {
    const trend = computeTrend(rows, t0, new Date('2026-01-03T12:00:00Z'));
    expect(trend.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(trend[0]).toMatchObject({ created: 4, resolved: 2 });
    const load = computeTeamWorkload(rows);
    expect(load.find((w) => w.teamId === 't1')).toMatchObject({ active: 0, resolved: 2 });
    expect(load.find((w) => w.teamId === null)?.active).toBe(1);
    expect(computeCategoryDistribution(rows).find((c) => c.category === 'network')?.count).toBe(1);
    const rates = computeResolutionRates(rows);
    expect(rates.find((r) => r.severity === 'high')).toMatchObject({ created: 2, resolved: 2, rate: 100 });
    expect(rates.find((r) => r.severity === 'critical')?.rate).toBe(0);
  });
});

describe('schemas', () => {
  it('validates passwords', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercase123').success).toBe(false);
    expect(passwordSchema.safeParse('GoodPassw0rdHere').success).toBe(true);
  });
  it('validates incident input and dedupes tags', () => {
    const ok = createIncidentSchema.parse({
      title: 'DB down',
      description: 'Primary is unreachable',
      category: 'database',
      severity: 'critical',
      tags: ['Prod', 'prod', 'db'],
    });
    expect(ok.tags).toEqual(['prod', 'db']);
    expect(createIncidentSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(
      createIncidentSchema.safeParse({ title: 'abc', description: 'd', category: 'nope', severity: 'low' }).success,
    ).toBe(false);
  });
  it('rejects malformed AI output', () => {
    const good = {
      category: 'network',
      severity: 'high',
      priority: 'high',
      suggestedTeam: null,
      summary: 'Packet loss on edge router',
      diagnosticQuestions: ['When did it start?'],
      troubleshootingSteps: ['Check interface errors'],
      confidence: 0.7,
    };
    expect(aiTriageResultSchema.safeParse(good).success).toBe(true);
    expect(aiTriageResultSchema.safeParse({ ...good, severity: 'catastrophic' }).success).toBe(false);
    expect(aiTriageResultSchema.safeParse({ ...good, confidence: 4 }).success).toBe(false);
    expect(aiTriageResultSchema.safeParse({ ...good, diagnosticQuestions: [] }).success).toBe(false);
  });
  it('rejects SLA policies whose resolution target is shorter than response', () => {
    const targets = structuredClone(DEFAULT_SLA_TARGETS);
    targets.low.resolutionMinutes = 1;
    expect(upsertSlaPolicySchema.safeParse({ name: 'x1', targets }).success).toBe(false);
    expect(upsertSlaPolicySchema.safeParse({ name: 'x1', targets: DEFAULT_SLA_TARGETS }).success).toBe(true);
  });
});
