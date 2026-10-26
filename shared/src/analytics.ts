import { ACTIVE_STATUSES, CATEGORIES, SEVERITIES, type IncidentStatus, type Severity } from './constants';

/** Minimal projection of an incident used by analytics. Computed from real DB rows. */
export interface AnalyticsRow {
  createdAt: Date;
  resolvedAt?: Date | null;
  firstRespondedAt?: Date | null;
  responseDueAt?: Date | null;
  resolutionDueAt?: Date | null;
  status: IncidentStatus;
  severity: Severity;
  category: string;
  teamId?: string | null;
}

const avg = (nums: number[]): number | null => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

export interface Kpis {
  openIncidents: number;
  criticalIncidents: number;
  overdueIncidents: number;
  avgResponseMs: number | null;
  avgResolutionMs: number | null;
  /** 0..100 or null when no incident has an SLA deadline in the window */
  resolutionSlaCompliance: number | null;
  responseSlaCompliance: number | null;
  totalInRange: number;
  resolvedInRange: number;
}

/**
 * `snapshot` = every currently-active incident (state-of-the-world numbers).
 * `ranged`   = incidents created inside the selected date range (rate/average numbers).
 */
export function computeKpis(snapshot: AnalyticsRow[], ranged: AnalyticsRow[], now: Date = new Date()): Kpis {
  const active = snapshot.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const responseTimes = ranged
    .filter((r) => r.firstRespondedAt)
    .map((r) => (r.firstRespondedAt as Date).getTime() - r.createdAt.getTime())
    .filter((n) => n >= 0);
  const resolutionTimes = ranged
    .filter((r) => r.resolvedAt)
    .map((r) => (r.resolvedAt as Date).getTime() - r.createdAt.getTime())
    .filter((n) => n >= 0);

  const resolutionEligible = ranged.filter((r) => r.resolutionDueAt);
  const resolutionOk = resolutionEligible.filter((r) =>
    r.resolvedAt ? r.resolvedAt <= (r.resolutionDueAt as Date) : now <= (r.resolutionDueAt as Date),
  );
  const responseEligible = ranged.filter((r) => r.responseDueAt);
  const responseOk = responseEligible.filter((r) =>
    r.firstRespondedAt ? r.firstRespondedAt <= (r.responseDueAt as Date) : now <= (r.responseDueAt as Date),
  );

  return {
    openIncidents: active.length,
    criticalIncidents: active.filter((r) => r.severity === 'critical').length,
    overdueIncidents: active.filter((r) => r.resolutionDueAt && r.resolutionDueAt < now).length,
    avgResponseMs: avg(responseTimes),
    avgResolutionMs: avg(resolutionTimes),
    resolutionSlaCompliance: resolutionEligible.length
      ? round1((resolutionOk.length / resolutionEligible.length) * 100)
      : null,
    responseSlaCompliance: responseEligible.length ? round1((responseOk.length / responseEligible.length) * 100) : null,
    totalInRange: ranged.length,
    resolvedInRange: ranged.filter((r) => r.resolvedAt).length,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const utcDayKey = (d: Date): string => d.toISOString().slice(0, 10);

export interface TrendPoint {
  date: string;
  created: number;
  resolved: number;
}

/** Day buckets are UTC. The client renders the labels in the viewer's locale. */
export function computeTrend(rows: AnalyticsRow[], from: Date, to: Date): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>();
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let guard = 0;
  while (cursor <= end && guard++ < 400) {
    const key = utcDayKey(cursor);
    buckets.set(key, { date: key, created: 0, resolved: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const r of rows) {
    const c = buckets.get(utcDayKey(r.createdAt));
    if (c) c.created++;
    if (r.resolvedAt) {
      const rb = buckets.get(utcDayKey(r.resolvedAt));
      if (rb) rb.resolved++;
    }
  }
  return Array.from(buckets.values());
}

export function computeSeverityDistribution(rows: AnalyticsRow[]) {
  return SEVERITIES.map((severity) => ({ severity, count: rows.filter((r) => r.severity === severity).length }));
}

export function computeCategoryDistribution(rows: AnalyticsRow[]) {
  return CATEGORIES.map((category) => ({ category, count: rows.filter((r) => r.category === category).length })).filter(
    (c) => c.count > 0,
  );
}

export interface WorkloadRow {
  teamId: string | null;
  active: number;
  resolved: number;
}

export function computeTeamWorkload(rows: AnalyticsRow[]): WorkloadRow[] {
  const map = new Map<string, WorkloadRow>();
  for (const r of rows) {
    const key = r.teamId ?? '__none__';
    const entry = map.get(key) ?? { teamId: r.teamId ?? null, active: 0, resolved: 0 };
    if (ACTIVE_STATUSES.includes(r.status)) entry.active++;
    else entry.resolved++;
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.active - a.active);
}

export function computeResolutionRates(rows: AnalyticsRow[]) {
  return SEVERITIES.map((severity) => {
    const subset = rows.filter((r) => r.severity === severity);
    const resolved = subset.filter((r) => r.resolvedAt).length;
    return {
      severity,
      created: subset.length,
      resolved,
      rate: subset.length ? round1((resolved / subset.length) * 100) : null,
    };
  });
}
