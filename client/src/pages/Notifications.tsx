import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, CheckCheck } from 'lucide-react';
import type { NotificationDto, Paginated } from '@opspilot/shared';
import { api } from '../lib/api';
import { useOrgId } from '../lib/auth';
import { fmtDateTime, fmtRelative, label } from '../lib/format';
import { Button, EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows, Tabs } from '../components/ui';

export function NotificationsPage() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['org', orgId, 'notifications', 'page', filter, page],
    queryFn: () => api.get<Paginated<NotificationDto> & { unreadCount: number }>(`/orgs/${orgId}/notifications`, { page, pageSize: 20, unread: filter === 'unread' ? 'true' : undefined }),
    placeholderData: (prev) => prev,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['org', orgId, 'notifications'] });
  const readOne = useMutation({ mutationFn: (id: string) => api.patch(`/orgs/${orgId}/notifications/${id}/read`), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api.post(`/orgs/${orgId}/notifications/read-all`), onSuccess: refresh });
  const unread = q.data?.unreadCount ?? 0;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={`${unread} unread`}
        actions={<Button onClick={() => readAll.mutate()} loading={readAll.isPending} disabled={!unread}><CheckCheck size={15} aria-hidden /> Mark all read</Button>}
      />
      <section className="panel overflow-hidden">
        <div className="px-4 pt-2">
          <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: unread }]} />
        </div>
        {q.isLoading ? <SkeletonRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
          <EmptyState icon={<Bell size={28} />} title={filter === 'unread' ? "You're all caught up" : 'No notifications yet'} body="You'll be notified when incidents are assigned to you, comments arrive, or an SLA is at risk." />
        ) : (
          <>
            <ul>
              {q.data.items.map((n) => (
                <li key={n.id} className={clsx('flex items-start gap-3 border-b border-line px-4 py-3.5 last:border-0', !n.readAt && 'bg-accent/5')}>
                  <span className={clsx('mt-2 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')} aria-label={n.readAt ? undefined : 'Unread'} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{n.title} <span className="ml-1 text-xs font-normal text-muted">{label(n.type)}</span></p>
                    {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted" title={fmtDateTime(n.createdAt)}>{fmtRelative(n.createdAt)}</p>
                  </div>
                  {n.incidentId && <Link to={`/app/incidents/${n.incidentId}`} onClick={() => !n.readAt && readOne.mutate(n.id)} className="text-sm text-accent hover:underline">Open</Link>}
                  {!n.readAt && <Button size="sm" variant="ghost" onClick={() => readOne.mutate(n.id)}>Mark read</Button>}
                </li>
              ))}
            </ul>
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}
