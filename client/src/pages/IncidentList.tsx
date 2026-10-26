import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Plus, Search, X } from 'lucide-react';
import type { IncidentDto, Paginated } from '@opspilot/shared';
import { api, download } from '../lib/api';
import { useAuth, useOrgId } from '../lib/auth';
import { fmtRelative } from '../lib/format';
import { CATEGORY_OPTIONS, SEVERITY_OPTIONS, STATUS_OPTIONS, useMembers, useTeams } from '../lib/queries';
import { useToast } from '../lib/ui-state';
import { Avatar, Button, ButtonLink, EmptyState, ErrorState, FilterSelect, PageHeader, Pagination, PriorityText, SeverityBadge, SkeletonRows, StatusBadge, errorMessage, sevBar } from '../components/ui';
import { SlaRail } from '../components/SlaRail';

const SORTS = [
  { value: 'createdAt', label: 'Newest' },
  { value: 'updatedAt', label: 'Recently updated' },
  { value: 'severity', label: 'Severity' },
  { value: 'priority', label: 'Priority' },
  { value: 'resolutionDueAt', label: 'SLA deadline' },
  { value: 'number', label: 'Number' },
  { value: 'status', label: 'Status' },
];
const FILTER_KEYS = ['q', 'status', 'severity', 'priority', 'category', 'assigneeId', 'teamId', 'overdue'] as const;

const STATE_GROUPS = [
  { value: '', label: 'All statuses' },
  { value: 'open,triaged,in_progress,blocked', label: 'Active' },
  { value: 'resolved,closed', label: 'Done' },
  ...STATUS_OPTIONS,
];

export function IncidentList() {
  const orgId = useOrgId();
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const members = useMembers();
  const teams = useTeams();
  const [exporting, setExporting] = useState(false);

  const get = (k: string) => params.get(k) ?? '';
  const sort = get('sort') || 'createdAt';
  const order = get('order') || 'desc';
  const page = Math.max(1, Number(get('page')) || 1);

  // The search box is debounced into the URL so filters are shareable and survive refresh.
  const [q, setQ] = useState(get('q'));
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== get('q')) update({ q });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  }

  const query = Object.fromEntries([...FILTER_KEYS.map((k) => [k, get(k)]), ['sort', sort], ['order', order], ['page', page], ['pageSize', 20]]);
  const list = useQuery({
    queryKey: ['org', orgId, 'incidents', 'list', query],
    queryFn: () => api.get<Paginated<IncidentDto>>(`/orgs/${orgId}/incidents`, query),
    placeholderData: (prev) => prev,
  });

  const activeFilters = FILTER_KEYS.filter((k) => get(k));
  const exportCsv = async () => {
    setExporting(true);
    try {
      await download(`/orgs/${orgId}/incidents/export.csv`, Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k)])), 'incidents.csv');
      toast.success('Export downloaded');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle={list.data ? `${list.data.total} matching` : undefined}
        actions={
          <>
            {can('incident:export') && (
              <Button onClick={exportCsv} loading={exporting}><Download size={15} aria-hidden /> Export CSV</Button>
            )}
            {can('incident:create') && <ButtonLink to="/app/incidents/new" variant="primary"><Plus size={16} aria-hidden /> New incident</ButtonLink>}
          </>
        }
      />

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3" role="search" aria-label="Filter incidents">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input className="input py-1.5 pl-9 text-sm" aria-label="Search incidents" placeholder="Search title, description, tag or INC-1042" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <FilterSelect label="Status" value={get('status')} onChange={(e) => update({ status: e.target.value })} options={STATE_GROUPS} />
        <FilterSelect label="Severity" value={get('severity')} onChange={(e) => update({ severity: e.target.value })} options={[{ value: '', label: 'Any severity' }, ...SEVERITY_OPTIONS]} />
        <FilterSelect label="Category" value={get('category')} onChange={(e) => update({ category: e.target.value })} options={[{ value: '', label: 'Any category' }, ...CATEGORY_OPTIONS]} />
        <FilterSelect
          label="Assignee"
          value={get('assigneeId')}
          onChange={(e) => update({ assigneeId: e.target.value })}
          options={[{ value: '', label: 'Anyone' }, { value: 'me', label: 'Assigned to me' }, { value: 'unassigned', label: 'Unassigned' }, ...(members.data ?? []).filter((m) => m.role !== 'viewer').map((m) => ({ value: m.user.id, label: m.user.name }))]}
        />
        <FilterSelect label="Team" value={get('teamId')} onChange={(e) => update({ teamId: e.target.value })} options={[{ value: '', label: 'Any team' }, { value: 'none', label: 'No team' }, ...(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" checked={get('overdue') === 'true'} onChange={(e) => update({ overdue: e.target.checked ? 'true' : '' })} className="h-4 w-4 accent-[rgb(var(--c-accent))]" />
          Overdue only
        </label>
        <div className="ml-auto flex items-center gap-1">
          <FilterSelect label="Sort by" value={sort} onChange={(e) => update({ sort: e.target.value })} options={SORTS} />
          <Button size="sm" aria-label={order === 'asc' ? 'Sorted ascending, switch to descending' : 'Sorted descending, switch to ascending'} onClick={() => update({ order: order === 'asc' ? 'desc' : 'asc' })}>
            {order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
          </Button>
        </div>
        {activeFilters.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => { setQ(''); setParams({}, { replace: true }); }}>
            <X size={14} aria-hidden /> Clear filters
          </Button>
        )}
      </div>

      <section className="panel overflow-hidden" aria-label="Incident list" aria-busy={list.isFetching}>
        {list.isLoading ? (
          <SkeletonRows rows={8} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} title="Could not load incidents" />
        ) : !list.data?.items.length ? (
          activeFilters.length ? (
            <EmptyState title="No incidents match these filters" body="Try removing a filter or searching for something broader." action={<Button onClick={() => { setQ(''); setParams({}, { replace: true }); }}>Clear filters</Button>} />
          ) : (
            <EmptyState title="No incidents yet" body="When something breaks, report it here so it gets an owner and an SLA clock." action={can('incident:create') ? <ButtonLink to="/app/incidents/new" variant="primary">Report the first incident</ButtonLink> : undefined} />
          )
        ) : (
          <>
            <div className="hidden grid-cols-[4.5rem_minmax(0,1fr)_6rem_7rem_9rem_12rem] gap-3 border-b border-line bg-sunken/50 px-5 py-2 text-xs font-medium text-muted lg:grid" aria-hidden>
              <span>Key</span><span>Incident</span><span>Severity</span><span>Status</span><span>Assignee</span><span>SLA clock</span>
            </div>
            <ul>
              {list.data.items.map((i) => (
                <li key={i.id} className="relative border-b border-line last:border-0">
                  <span className={`absolute inset-y-0 left-0 w-1 ${sevBar[i.severity]}`} aria-hidden />
                  <Link to={`/app/incidents/${i.id}`} className="grid items-center gap-x-3 gap-y-1.5 py-3 pl-5 pr-4 hover:bg-sunken/50 lg:grid-cols-[4.5rem_minmax(0,1fr)_6rem_7rem_9rem_12rem]">
                    <span className="text-xs font-medium text-muted">{i.key}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{i.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {[i.team?.name, i.category, ...i.tags.slice(0, 2).map((t) => `#${t}`)].filter(Boolean).join(' · ')} · <PriorityText priority={i.priority} /> priority · {fmtRelative(i.updatedAt)}
                      </span>
                    </span>
                    <span><SeverityBadge severity={i.severity} /></span>
                    <span><StatusBadge status={i.status} /></span>
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      {i.assignee ? <><Avatar name={i.assignee.name} size={22} /><span className="truncate">{i.assignee.name}</span></> : <span className="text-muted">Unassigned</span>}
                    </span>
                    <SlaRail incident={i} compact />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => update({ page: String(p) })} />
          </>
        )}
      </section>
    </>
  );
}
