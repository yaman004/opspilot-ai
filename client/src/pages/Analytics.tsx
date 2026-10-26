import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { api, download } from '../lib/api';
import { useAuth, useOrgId } from '../lib/auth';
import { fmtDateTime, fmtMs, fmtPct, label } from '../lib/format';
import { useTeams } from '../lib/queries';
import { useToast } from '../lib/ui-state';
import { Button, ErrorState, FilterSelect, PageHeader, Skeleton, errorMessage } from '../components/ui';
import { CategoryChart, ChartCard, RangePicker, ResolutionRateChart, SeverityChart, TrendChart, WorkloadChart, useRange, type AnalyticsOverview } from '../components/charts';

export function AnalyticsPage() {
  const orgId = useOrgId();
  const { can } = useAuth();
  const toast = useToast();
  const range = useRange('30d');
  const teams = useTeams();
  const [teamId, setTeamId] = useState('');
  const [exporting, setExporting] = useState(false);

  const q = useQuery({
    queryKey: ['org', orgId, 'analytics', range.from, range.to, teamId, 'full'],
    queryFn: () => api.get<AnalyticsOverview>(`/orgs/${orgId}/analytics/overview`, { from: range.from, to: range.to, teamId }),
    placeholderData: (prev) => prev,
  });

  const exportCsv = async () => {
    setExporting(true);
    try {
      await download(`/orgs/${orgId}/incidents/export.csv`, { from: range.from, to: range.to, teamId }, 'incidents.csv');
      toast.success('Report downloaded');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const d = q.data;
  const empty = d ? d.kpis.totalInRange === 0 : false;
  const k = d?.kpis;
  const summary: Array<[string, string]> = [
    ['Incidents created', String(k?.totalInRange ?? '—')],
    ['Resolved', String(k?.resolvedInRange ?? '—')],
    ['Avg first response', fmtMs(k?.avgResponseMs)],
    ['Avg resolution', fmtMs(k?.avgResolutionMs)],
    ['Response SLA met', fmtPct(k?.responseSlaCompliance)],
    ['Resolution SLA met', fmtPct(k?.resolutionSlaCompliance)],
  ];

  return (
    <>
      <PageHeader
        title="Analytics and reports"
        subtitle={d ? `${fmtDateTime(d.range.from)} to ${fmtDateTime(d.range.to)}` : undefined}
        actions={
          <>
            <FilterSelect label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)} options={[{ value: '', label: 'All teams' }, ...(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
            <RangePicker range={range} />
            {can('incident:export') && <Button onClick={exportCsv} loading={exporting}><Download size={15} aria-hidden /> Export incidents (CSV)</Button>}
          </>
        }
      />

      {q.isError ? (
        <div className="panel"><ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load analytics" /></div>
      ) : (
        <div className="space-y-4" aria-busy={q.isFetching}>
          {d?.truncated && <p role="status" className="rounded border border-warn/40 bg-warn/10 p-3 text-sm">This range has more incidents than the report can aggregate at once, so figures cover the most recent ones. Narrow the date range for exact numbers.</p>}
          <dl className="panel grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
            {summary.map(([name, value]) => (
              <div key={name} className="p-4">
                <dt className="text-xs text-muted">{name}</dt>
                <dd className="mt-1 text-xl font-semibold">{q.isLoading ? <Skeleton className="h-6 w-12" /> : value}</dd>
              </div>
            ))}
          </dl>

          {q.isLoading ? (
            <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
          ) : d && (
            <>
              <ChartCard title="Incident trend" subtitle="Created and resolved per day (UTC days)" empty={empty && d.trend.every((t) => !t.resolved)}><TrendChart data={d.trend} /></ChartCard>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="By severity" empty={empty}><SeverityChart data={d.severity} /></ChartCard>
                <ChartCard title="By category" empty={empty}><CategoryChart data={d.categories} /></ChartCard>
                <ChartCard title="Team workload" subtitle="Currently active plus resolved in range" empty={!d.workload.length}><WorkloadChart data={d.workload} /></ChartCard>
                <ChartCard title="Resolution rate by severity" subtitle="Share of incidents created in range that are resolved" empty={empty}><ResolutionRateChart data={d.resolutionRates} /></ChartCard>
              </div>
              <section className="panel overflow-x-auto" aria-label="Resolution rates table">
                <table className="w-full text-sm">
                  <caption className="sr-only">Resolution by severity</caption>
                  <thead><tr className="border-b border-line"><th className="th">Severity</th><th className="th">Created</th><th className="th">Resolved</th><th className="th">Rate</th></tr></thead>
                  <tbody>
                    {d.resolutionRates.map((r) => (
                      <tr key={r.severity} className="border-b border-line last:border-0"><td className="px-3 py-2 font-medium">{label(r.severity)}</td><td className="px-3 py-2">{r.created}</td><td className="px-3 py-2">{r.resolved}</td><td className="px-3 py-2">{fmtPct(r.rate)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </div>
      )}
    </>
  );
}
