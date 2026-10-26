import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { IncidentDto, Paginated } from '@opspilot/shared';
import { api } from '../lib/api';
import { useAuth, useOrgId } from '../lib/auth';
import { fmtMs, fmtPct, fmtRelative } from '../lib/format';
import { ButtonLink, ErrorState, EmptyState, PageHeader, SeverityBadge, SkeletonRows, Skeleton, sevBar, StatusBadge } from '../components/ui';
import { SlaRail } from '../components/SlaRail';
import { RangePicker, useRange, type AnalyticsOverview } from '../components/charts';

export function Dashboard() {
  const orgId = useOrgId();
  const { can, currentMembership, user } = useAuth();
  const range = useRange('7d');

  const overview = useQuery({
    queryKey: ['org', orgId, 'analytics', range.from, range.to, 'dash'],
    queryFn: () => api.get<AnalyticsOverview>(`/orgs/${orgId}/analytics/overview`, { from: range.from, to: range.to }),
  });
  const attention = useQuery({
    queryKey: ['org', orgId, 'incidents', 'attention'],
    queryFn: () => api.get<Paginated<IncidentDto>>(`/orgs/${orgId}/incidents`, { status: 'open,triaged,in_progress,blocked', sort: 'resolutionDueAt', order: 'asc', pageSize: 8 }),
  });
  const mine = useQuery({
    queryKey: ['org', orgId, 'incidents', 'mine'],
    queryFn: () => api.get<Paginated<IncidentDto>>(`/orgs/${orgId}/incidents`, { status: 'open,triaged,in_progress,blocked', assigneeId: 'me', pageSize: 1 }),
  });

  const k = overview.data?.kpis;
  const stats: Array<{ label: string; value: string; tone?: string; to?: string; note?: string }> = [
    { label: 'Open incidents', value: String(k?.openIncidents ?? '—'), to: '/app/incidents?status=open,triaged,in_progress,blocked' },
    { label: 'Critical', value: String(k?.criticalIncidents ?? '—'), tone: (k?.criticalIncidents ?? 0) > 0 ? 'text-crit' : undefined, to: '/app/incidents?severity=critical&status=open,triaged,in_progress,blocked' },
    { label: 'Overdue', value: String(k?.overdueIncidents ?? '—'), tone: (k?.overdueIncidents ?? 0) > 0 ? 'text-crit' : undefined, to: '/app/incidents?overdue=true' },
    { label: 'Avg first response', value: fmtMs(k?.avgResponseMs), note: 'in range' },
    { label: 'Avg resolution', value: fmtMs(k?.avgResolutionMs), note: 'in range' },
    { label: 'SLA compliance', value: fmtPct(k?.resolutionSlaCompliance), note: 'resolution, in range' },
  ];

  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user?.name.split(' ')[0] ?? ''}`}
        subtitle={`${currentMembership?.organization.name} · ${mine.data ? `${mine.data.total} active incident${mine.data.total === 1 ? '' : 's'} assigned to you` : 'Operations overview'}`}
        actions={
          <>
            <RangePicker range={range} />
            {can('incident:create') && (
              <ButtonLink to="/app/incidents/new" variant="primary"><Plus size={16} aria-hidden /> New incident</ButtonLink>
            )}
          </>
        }
      />

      {overview.isError ? (
        <div className="panel"><ErrorState error={overview.error} onRetry={() => overview.refetch()} title="Could not load metrics" /></div>
      ) : (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {stats.map((s) => {
            const body = (
              <div className="panel h-full p-4 transition-colors hover:bg-sunken/50">
                <dt className="text-xs font-medium text-muted">{s.label}</dt>
                <dd className={`mt-1.5 text-[28px] font-semibold leading-none tracking-tight ${s.tone ?? ''}`}>
                  {overview.isLoading ? <Skeleton className="h-7 w-14" /> : s.value}
                </dd>
                {s.note && <p className="mt-1.5 text-xs text-muted">{s.note}</p>}
              </div>
            );
            return s.to ? <Link key={s.label} to={s.to} className="block rounded-lg">{body}</Link> : <div key={s.label}>{body}</div>;
          })}
        </dl>
      )}

      <section className="panel mt-6 overflow-hidden" aria-labelledby="attention">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 id="attention" className="text-base font-semibold">Closest to breaching</h2>
            <p className="text-xs text-muted">Active incidents sorted by resolution deadline</p>
          </div>
          <Link to="/app/incidents" className="text-sm text-accent hover:underline">All incidents</Link>
        </div>
        {attention.isLoading ? (
          <SkeletonRows rows={5} />
        ) : attention.isError ? (
          <ErrorState error={attention.error} onRetry={() => attention.refetch()} />
        ) : !attention.data?.items.length ? (
          <EmptyState title="No active incidents" body="Everything is resolved. New incidents will show up here as they're reported." action={can('incident:create') ? <ButtonLink to="/app/incidents/new" variant="primary">Report an incident</ButtonLink> : undefined} />
        ) : (
          <ul>
            {attention.data.items.map((i) => (
              <li key={i.id} className="relative border-b border-line last:border-0">
                <span className={`absolute inset-y-0 left-0 w-1 ${sevBar[i.severity]}`} aria-hidden />
                <Link to={`/app/incidents/${i.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3 pl-5 pr-4 hover:bg-sunken/50">
                  <span className="w-16 text-xs font-medium text-muted">{i.key}</span>
                  <span className="min-w-0 flex-1 basis-56">
                    <span className="block truncate text-sm font-medium">{i.title}</span>
                    <span className="text-xs text-muted">{i.assignee ? i.assignee.name : 'Unassigned'} · updated {fmtRelative(i.updatedAt)}</span>
                  </span>
                  <SeverityBadge severity={i.severity} />
                  <StatusBadge status={i.status} />
                  <SlaRail incident={i} compact />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
