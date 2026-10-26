import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuditLogDto, Paginated } from '@opspilot/shared';
import { api } from '../lib/api';
import { useOrgId } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { useMembers } from '../lib/queries';
import { EmptyState, ErrorState, FilterSelect, PageHeader, Pagination, SkeletonRows } from '../components/ui';

const ACTION_GROUPS = [
  { value: '', label: 'All activity' },
  { value: 'incident.', label: 'Incidents' },
  { value: 'comment.', label: 'Comments' },
  { value: 'member.', label: 'Membership' },
  { value: 'invitation.', label: 'Invitations' },
  { value: 'team.', label: 'Teams' },
  { value: 'sla_policy.', label: 'SLA policy' },
  { value: 'ai.', label: 'AI triage' },
  { value: 'attachment.', label: 'Attachments' },
  { value: 'organization.', label: 'Organization' },
];

function summarize(a: AuditLogDto): string {
  const m = a.metadata as Record<string, any>;
  const parts: string[] = [];
  if (m.key) parts.push(String(m.key));
  if (m.from && m.to) parts.push(`${String(m.from).replace(/_/g, ' ')} → ${String(m.to).replace(/_/g, ' ')}`);
  if (m.toName) parts.push(`to ${m.toName}`);
  if (m.email) parts.push(String(m.email));
  if (m.role) parts.push(String(m.role));
  if (m.name) parts.push(String(m.name));
  if (m.fileName) parts.push(String(m.fileName));
  if (m.changes && typeof m.changes === 'object') parts.push(`changed ${Object.keys(m.changes).join(', ')}`);
  if (m.message) parts.push(String(m.message));
  if (typeof m.isMock === 'boolean') parts.push(m.isMock ? 'mock provider' : String(m.provider ?? 'real provider'));
  return parts.join(' · ') || '—';
}

export function AuditPage() {
  const orgId = useOrgId();
  const members = useMembers();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const q = useQuery({
    queryKey: ['org', orgId, 'audit', page, action, actorId],
    queryFn: () => api.get<Paginated<AuditLogDto>>(`/orgs/${orgId}/audit-logs`, { page, pageSize: 25, action, actorId }),
    placeholderData: (prev) => prev,
  });
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change in this organization: who did what, and when. Entries can't be edited." />
      <div className="panel mb-4 flex flex-wrap gap-2 p-3">
        <FilterSelect label="Activity type" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} options={ACTION_GROUPS} />
        <FilterSelect label="Actor" value={actorId} onChange={(e) => { setActorId(e.target.value); setPage(1); }} options={[{ value: '', label: 'Anyone' }, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name }))]} />
      </div>
      <section className="panel overflow-hidden">
        {q.isLoading ? <SkeletonRows rows={10} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
          <EmptyState title="No matching activity" body="Try a different filter." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead><tr className="border-b border-line bg-sunken/50"><th className="th">When</th><th className="th">Actor</th><th className="th">Action</th><th className="th">Details</th></tr></thead>
                <tbody>
                  {q.data.items.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0 align-top">
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">{fmtDateTime(a.createdAt)}</td>
                      <td className="px-3 py-2.5">{a.actor?.name ?? <span className="text-muted">System</span>}</td>
                      <td className="px-3 py-2.5"><code className="rounded bg-sunken px-1.5 py-0.5 text-xs">{a.action}</code></td>
                      <td className="px-3 py-2.5 text-muted">{summarize(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}
