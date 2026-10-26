import {
  ACTIVE_STATUSES,
  computeCategoryDistribution,
  computeKpis,
  computeResolutionRates,
  computeSeverityDistribution,
  computeTeamWorkload,
  computeTrend,
  type AnalyticsQuery,
  type AnalyticsRow,
} from '@opspilot/shared';
import { Incident, Team } from '../models';

const MAX_ROWS = 20_000;
const DEFAULT_RANGE_DAYS = 30;

const PROJECTION = {
  createdAt: 1,
  resolvedAt: 1,
  status: 1,
  severity: 1,
  category: 1,
  teamId: 1,
  'sla.firstRespondedAt': 1,
  'sla.responseDueAt': 1,
  'sla.resolutionDueAt': 1,
} as const;

function toRow(d: any): AnalyticsRow {
  return {
    createdAt: d.createdAt,
    resolvedAt: d.resolvedAt ?? null,
    firstRespondedAt: d.sla?.firstRespondedAt ?? null,
    responseDueAt: d.sla?.responseDueAt ?? null,
    resolutionDueAt: d.sla?.resolutionDueAt ?? null,
    status: d.status,
    severity: d.severity,
    category: d.category,
    teamId: d.teamId ? String(d.teamId) : null,
  };
}

export function resolveRange(q: AnalyticsQuery, now = new Date()) {
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
  return { from, to };
}

/**
 * Every figure is derived from real incident documents in this organization.
 * The averages / rates are computed by the shared pure functions (unit-tested), fed by indexed,
 * projected queries capped at MAX_ROWS (the response says when a cap was hit).
 */
export async function getOverview(orgId: string, q: AnalyticsQuery, now = new Date()) {
  const { from, to } = resolveRange(q, now);
  const team = q.teamId ? { teamId: q.teamId } : {};

  const [activeDocs, rangedDocs, resolvedDocs, teams] = await Promise.all([
    Incident.find({ organizationId: orgId, status: { $in: ACTIVE_STATUSES }, ...team }, PROJECTION).limit(MAX_ROWS).lean(),
    Incident.find({ organizationId: orgId, createdAt: { $gte: from, $lte: to }, ...team }, PROJECTION)
      .sort({ createdAt: -1 })
      .limit(MAX_ROWS)
      .lean(),
    // Incidents created earlier but resolved inside the window still belong in the "resolved" trend line.
    Incident.find({ organizationId: orgId, resolvedAt: { $gte: from, $lte: to }, createdAt: { $lt: from }, ...team }, PROJECTION)
      .limit(MAX_ROWS)
      .lean(),
    Team.find({ organizationId: orgId }, { name: 1 }).lean(),
  ]);

  const active = activeDocs.map(toRow);
  const ranged = rangedDocs.map(toRow);
  const trendRows = [...ranged, ...resolvedDocs.map(toRow)];
  const teamNames = new Map(teams.map((t) => [String(t._id), t.name]));

  // Workload = everything currently active plus what was resolved in range, per team.
  const workload = computeTeamWorkload([...active, ...ranged.filter((r) => !ACTIVE_STATUSES.includes(r.status))]).map((w) => ({
    ...w,
    teamName: w.teamId ? (teamNames.get(w.teamId) ?? 'Deleted team') : 'Unassigned',
  }));

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    kpis: computeKpis(active, ranged, now),
    trend: computeTrend(trendRows, from, to),
    severity: computeSeverityDistribution(ranged),
    categories: computeCategoryDistribution(ranged),
    workload,
    resolutionRates: computeResolutionRates(ranged),
    truncated: activeDocs.length >= MAX_ROWS || rangedDocs.length >= MAX_ROWS,
    generatedAt: now.toISOString(),
  };
}
