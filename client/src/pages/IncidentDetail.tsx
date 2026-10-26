import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Lock, Paperclip, Pencil, Sparkles, Trash2 } from 'lucide-react';
import {
  STATUS_TRANSITIONS,
  isReopen,
  type ActivityDto,
  type AiAnalysisDto,
  type AttachmentDto,
  type CommentDto,
  type IncidentDto,
  type IncidentStatus,
} from '@opspilot/shared';
import { api, download } from '../lib/api';
import { useAuth, useOrgId } from '../lib/auth';
import { fmtDateTime, fmtRelative, label } from '../lib/format';
import { useIncident, useMembers, useTeams } from '../lib/queries';
import { useToast } from '../lib/ui-state';
import {
  Avatar, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, FormError, PriorityText, SelectField, SeverityBadge, Skeleton, StatusBadge, Tabs, TextArea, errorMessage, sevBar,
} from '../components/ui';
import { SlaRail, SlaStage } from '../components/SlaRail';
import { AiStatusNotice, TriageResultPanel, type ApplyField } from '../components/Triage';

type Tab = 'comments' | 'activity' | 'attachments' | 'ai';

const ACTION_LABEL: Partial<Record<IncidentStatus, string>> = {
  triaged: 'Mark triaged',
  in_progress: 'Start work',
  blocked: 'Mark blocked',
  resolved: 'Resolve',
  closed: 'Close',
  open: 'Reopen',
};

export function IncidentDetail() {
  const { incidentId = '' } = useParams();
  const orgId = useOrgId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const incident = useIncident(incidentId);
  const members = useMembers();
  const teams = useTeams();
  const [tab, setTab] = useState<Tab>('comments');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<IncidentStatus | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['org', orgId] });

  const transition = useMutation({
    mutationFn: (v: { status: IncidentStatus; resolutionSummary?: string }) => api.post(`/orgs/${orgId}/incidents/${incidentId}/transition`, v),
    onSuccess: (_d, v) => {
      toast.success(v.status === 'resolved' ? 'Incident resolved' : `Status changed to ${label(v.status).toLowerCase()}`);
      setResolveOpen(false);
      setConfirmTarget(null);
      setSummary('');
      void refresh();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      void refresh();
    },
  });
  const assign = useMutation({
    mutationFn: (assigneeId: string | null) => api.post(`/orgs/${orgId}/incidents/${incidentId}/assign`, { assigneeId }),
    onSuccess: () => { toast.success('Assignment updated'); void refresh(); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/orgs/${orgId}/incidents/${incidentId}`, patch),
    onSuccess: () => { toast.success('Incident updated'); void refresh(); },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (incident.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-9 w-2/3" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (incident.isError) {
    const notFound = (incident.error as { status?: number }).status === 404;
    return (
      <div className="panel">
        <ErrorState error={incident.error} title={notFound ? 'Incident not found' : 'Could not load this incident'} onRetry={notFound ? () => navigate('/app/incidents') : () => incident.refetch()} />
      </div>
    );
  }
  const inc = incident.data as IncidentDto;
  const closed = inc.status === 'closed';
  const allowed = STATUS_TRANSITIONS[inc.status];
  const assignable = (members.data ?? []).filter((m) => m.role !== 'viewer');

  const act = (to: IncidentStatus) => {
    if (to === 'resolved') return setResolveOpen(true);
    if (to === 'closed' || isReopen(inc.status, to)) return setConfirmTarget(to);
    transition.mutate({ status: to });
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted"><Link to="/app/incidents" className="hover:text-ink hover:underline">Incidents</Link> / {inc.key}</p>
          <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight">{inc.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={inc.status} />
            <SeverityBadge severity={inc.severity} />
            <span className="text-sm text-muted">Priority <PriorityText priority={inc.priority} /></span>
            {inc.reopenCount > 0 && <span className="text-xs text-muted">Reopened {inc.reopenCount}×</span>}
          </div>
        </div>
        {can('incident:transition') && (
          <div className="flex flex-wrap items-center gap-2">
            {can('incident:update') && !closed && (
              <Button onClick={() => navigate(`/app/incidents/${inc.id}/edit`)}><Pencil size={14} aria-hidden /> Edit</Button>
            )}
            {allowed.map((to) => (
              <Button key={to} variant={to === 'resolved' ? 'primary' : 'secondary'} loading={transition.isPending && transition.variables?.status === to} disabled={transition.isPending} onClick={() => act(to)}>
                {ACTION_LABEL[to] ?? label(to)}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <section className="panel relative overflow-hidden p-5" aria-label="Description">
            <span className={`absolute inset-y-0 left-0 w-1 ${sevBar[inc.severity]}`} aria-hidden />
            <p className="whitespace-pre-wrap break-words text-base">{inc.description}</p>
            {inc.tags.length > 0 && (
              <p className="mt-3 flex flex-wrap gap-1.5">
                {inc.tags.map((t) => <Link key={t} to={`/app/incidents?q=${encodeURIComponent(t)}`} className="rounded bg-sunken px-2 py-0.5 text-xs text-muted hover:text-ink">#{t}</Link>)}
              </p>
            )}
            {inc.resolutionSummary && (
              <div className="mt-4 rounded border border-ok/40 bg-ok/8 p-3">
                <p className="text-xs font-medium text-ok">Resolution{inc.resolvedAt ? ` · ${fmtDateTime(inc.resolvedAt)}` : ''}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{inc.resolutionSummary}</p>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="px-4 pt-2">
              <Tabs<Tab>
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'comments', label: 'Comments' },
                  { value: 'activity', label: 'Activity' },
                  { value: 'attachments', label: 'Attachments' },
                  ...(can('ai:triage') ? [{ value: 'ai' as const, label: 'AI triage' }] : []),
                ]}
              />
            </div>
            <div className="p-4" role="tabpanel">
              {tab === 'comments' && <Comments incidentId={inc.id} />}
              {tab === 'activity' && <Activity incidentId={inc.id} />}
              {tab === 'attachments' && <Attachments incidentId={inc.id} closed={closed} />}
              {tab === 'ai' && <IncidentAi incident={inc} />}
            </div>
          </section>
        </div>

        <aside className="space-y-4" aria-label="Incident details">
          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold">SLA</h2>
            <SlaRail incident={inc} />
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">First response</dt><dd className="text-right"><SlaStage state={inc.sla.response} /><span className="block text-xs text-muted">due {fmtDateTime(inc.sla.responseDueAt)}</span></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Resolution</dt><dd className="text-right"><SlaStage state={inc.sla.resolution} /><span className="block text-xs text-muted">due {fmtDateTime(inc.sla.resolutionDueAt)}</span></dd></div>
              {inc.sla.firstRespondedAt && <div className="flex justify-between gap-3"><dt className="text-muted">Responded</dt><dd>{fmtDateTime(inc.sla.firstRespondedAt)}</dd></div>}
            </dl>
          </section>

          <section className="panel space-y-3 p-4">
            <h2 className="text-sm font-semibold">Details</h2>
            {can('incident:assign') && !closed ? (
              <SelectField label="Assignee" value={inc.assignee?.id ?? ''} disabled={assign.isPending} onChange={(e) => assign.mutate(e.target.value || null)} options={[{ value: '', label: 'Unassigned' }, ...assignable.map((m) => ({ value: m.user.id, label: m.user.name }))]} />
            ) : (
              <Field name="Assignee">{inc.assignee ? <span className="flex items-center gap-2"><Avatar name={inc.assignee.name} size={22} />{inc.assignee.name}</span> : 'Unassigned'}</Field>
            )}
            {can('incident:update') && !closed ? (
              <SelectField label="Team" value={inc.team?.id ?? ''} disabled={update.isPending} onChange={(e) => update.mutate({ teamId: e.target.value || null })} options={[{ value: '', label: 'No team' }, ...(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
            ) : (
              <Field name="Team">{inc.team?.name ?? 'No team'}</Field>
            )}
            <Field name="Category">{label(inc.category)}</Field>
            <Field name="Reporter">{inc.reporter?.name ?? '—'}</Field>
            <Field name="Created">{fmtDateTime(inc.createdAt)}</Field>
            <Field name="Updated">{fmtRelative(inc.updatedAt)}</Field>
          </section>

          <Related incidentId={inc.id} />
        </aside>
      </div>

      <Dialog open={resolveOpen} title={`Resolve ${inc.key}`} onClose={() => setResolveOpen(false)}>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); transition.mutate({ status: 'resolved', resolutionSummary: summary }); }} className="space-y-4">
          <TextArea label="How was it resolved?" required value={summary} onChange={(e) => setSummary(e.target.value)} hint="Shown on the incident and in exports. At least 5 characters." rows={5} autoFocus />
          {transition.isError && <FormError error={transition.error} />}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setResolveOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={transition.isPending} disabled={summary.trim().length < 5}>Resolve incident</Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget === 'closed' ? `Close ${inc.key}?` : `Reopen ${inc.key}?`}
        body={confirmTarget === 'closed' ? 'A closed incident is read-only until someone reopens it.' : 'The incident returns to the active queue and its resolution is cleared. Its history stays.'}
        confirmLabel={confirmTarget === 'closed' ? 'Close incident' : 'Reopen incident'}
        danger={false}
        loading={transition.isPending}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => confirmTarget && transition.mutate({ status: confirmTarget })}
      />
    </>
  );
}

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted">{name}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

function Related({ incidentId }: { incidentId: string }) {
  const orgId = useOrgId();
  const q = useQuery({
    queryKey: ['org', orgId, 'incident', incidentId, 'related'],
    queryFn: async () => (await api.get<{ incidents: IncidentDto[] }>(`/orgs/${orgId}/incidents/${incidentId}/related`)).incidents,
  });
  return (
    <section className="panel p-4">
      <h2 className="mb-2 text-sm font-semibold">Related incidents</h2>
      {q.isLoading ? <Skeleton className="h-16 w-full" /> : q.isError ? <p className="text-sm text-crit">Could not load related incidents.</p> : !q.data?.length ? (
        <p className="text-sm text-muted">Nothing shares this incident's tags, category or team yet.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((r) => (
            <li key={r.id}>
              <Link to={`/app/incidents/${r.id}`} className="block rounded px-2 py-1.5 hover:bg-sunken">
                <span className="text-xs text-muted">{r.key} · {label(r.status)}</span>
                <span className="block truncate text-sm font-medium">{r.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Comments({ incidentId }: { incidentId: string }) {
  const orgId = useOrgId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const list = useQuery({
    queryKey: ['org', orgId, 'incident', incidentId, 'comments'],
    queryFn: async () => (await api.get<{ comments: CommentDto[] }>(`/orgs/${orgId}/incidents/${incidentId}/comments`)).comments,
  });
  const add = useMutation({
    mutationFn: () => api.post(`/orgs/${orgId}/incidents/${incidentId}/comments`, { body, internal }),
    onSuccess: () => { setBody(''); toast.success(internal ? 'Internal note added' : 'Comment posted'); void qc.invalidateQueries({ queryKey: ['org', orgId] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div className="space-y-4">
      {list.isLoading ? <Skeleton className="h-24 w-full" /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.length ? (
        <p className="py-4 text-center text-sm text-muted">No comments yet.{can('comment:create') ? ' Start the conversation below.' : ''}</p>
      ) : (
        <ul className="space-y-3">
          {list.data.map((c) => (
            <li key={c.id} className={`flex gap-3 rounded-lg p-3 ${c.internal ? 'border border-warn/40 bg-warn/8' : 'bg-sunken/50'}`}>
              <Avatar name={c.author?.name ?? '?'} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm"><strong>{c.author?.name}</strong><span className="text-xs text-muted">{fmtRelative(c.createdAt)}</span>{c.internal && <span className="inline-flex items-center gap-1 text-xs font-medium text-warn"><Lock size={11} aria-hidden /> Internal note</span>}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {can('comment:create') && (
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="space-y-2 border-t border-line pt-4">
          <TextArea label={internal ? 'Internal note' : 'Add a comment'} value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {can('comment:read_internal') ? (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-accent))]" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note <span className="text-xs text-muted">(hidden from viewers)</span></label>
            ) : <span />}
            <Button type="submit" variant="primary" loading={add.isPending} disabled={!body.trim()}>{internal ? 'Add note' : 'Post comment'}</Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Activity({ incidentId }: { incidentId: string }) {
  const orgId = useOrgId();
  const q = useQuery({
    queryKey: ['org', orgId, 'incident', incidentId, 'activity'],
    queryFn: async () => (await api.get<{ activity: ActivityDto[] }>(`/orgs/${orgId}/incidents/${incidentId}/activity`)).activity,
  });
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState title="No activity yet" />;
  return (
    <ol className="relative ml-2 space-y-4 border-l border-line pl-5">
      {q.data.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden />
          <p className="text-sm">{a.message}</p>
          {typeof a.metadata?.note === 'string' && <p className="mt-0.5 text-sm text-muted">“{a.metadata.note}”</p>}
          <time dateTime={a.createdAt} className="text-xs text-muted" title={fmtDateTime(a.createdAt)}>{fmtDateTime(a.createdAt)}</time>
        </li>
      ))}
    </ol>
  );
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function Attachments({ incidentId, closed }: { incidentId: string; closed: boolean }) {
  const orgId = useOrgId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<AttachmentDto | null>(null);
  const q = useQuery({
    queryKey: ['org', orgId, 'incident', incidentId, 'attachments'],
    queryFn: async () => (await api.get<{ attachments: AttachmentDto[] }>(`/orgs/${orgId}/incidents/${incidentId}/attachments`)).attachments,
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.upload(`/orgs/${orgId}/incidents/${incidentId}/attachments`, file),
    onSuccess: () => { toast.success('File attached'); void qc.invalidateQueries({ queryKey: ['org', orgId, 'incident', incidentId] }); },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => { if (fileRef.current) fileRef.current.value = ''; },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${orgId}/incidents/${incidentId}/attachments/${id}`),
    onSuccess: () => { setRemoving(null); toast.success('Attachment removed'); void qc.invalidateQueries({ queryKey: ['org', orgId, 'incident', incidentId] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div className="space-y-3">
      {can('attachment:upload') && !closed && (
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" className="sr-only" id="file-input" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.json,.zip" />
          <Button loading={upload.isPending} onClick={() => fileRef.current?.click()}><Paperclip size={14} aria-hidden /> Attach file</Button>
          <span className="text-xs text-muted">Images, PDF, text, CSV, JSON or ZIP up to 5 MB.</span>
        </div>
      )}
      {q.isLoading ? <Skeleton className="h-16 w-full" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <p className="py-3 text-sm text-muted">No files attached.</p>
      ) : (
        <ul className="divide-y divide-line rounded border border-line">
          {q.data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
              <Paperclip size={15} className="shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.fileName}</span><span className="text-xs text-muted">{fmtSize(a.size)} · {a.uploadedBy?.name ?? 'Unknown'} · {fmtRelative(a.createdAt)}</span></span>
              <Button size="sm" aria-label={`Download ${a.fileName}`} onClick={() => download(`/orgs/${orgId}/incidents/${incidentId}/attachments/${a.id}`, undefined, a.fileName).catch((e) => toast.error(errorMessage(e)))}><Download size={14} /></Button>
              {can('attachment:delete') && !closed && <Button size="sm" variant="ghost" aria-label={`Remove ${a.fileName}`} onClick={() => setRemoving(a)}><Trash2 size={14} /></Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!removing} title="Remove attachment?" body={<>“{removing?.fileName}” will be deleted permanently.</>} confirmLabel="Remove" loading={remove.isPending} onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing.id)} />
    </div>
  );
}

function IncidentAi({ incident }: { incident: IncidentDto }) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const history = useQuery({
    queryKey: ['org', orgId, 'incident', incident.id, 'ai'],
    queryFn: async () => (await api.get<{ analyses: AiAnalysisDto[] }>(`/orgs/${orgId}/incidents/${incident.id}/ai-analyses`)).analyses,
  });
  const run = useMutation({
    mutationFn: () => api.post(`/orgs/${orgId}/ai/triage`, { title: incident.title, description: incident.description, incidentId: incident.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', orgId, 'incident', incident.id, 'ai'] }),
    onError: (err) => { toast.error(errorMessage(err)); void qc.invalidateQueries({ queryKey: ['org', orgId, 'incident', incident.id, 'ai'] }); },
  });
  const apply = useMutation({
    mutationFn: (v: { analysisId: string; fields: ApplyField[] }) => api.post(`/orgs/${orgId}/incidents/${incident.id}/ai/apply`, v),
    onSuccess: () => { toast.success('Suggestions applied'); void qc.invalidateQueries({ queryKey: ['org', orgId] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const latest = history.data?.find((a) => a.status === 'succeeded');
  const failed = history.data?.[0]?.status === 'failed' ? history.data[0] : null;
  return (
    <div className="space-y-4">
      <AiStatusNotice />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Analyze this incident's title and description. You choose what to apply.</p>
        <Button loading={run.isPending} disabled={incident.status === 'closed'} onClick={() => run.mutate()}><Sparkles size={14} aria-hidden /> {latest ? 'Re-run triage' : 'Run triage'}</Button>
      </div>
      {failed && (
        <p role="alert" className="rounded border border-crit/40 bg-crit/8 p-3 text-sm text-crit">
          The last attempt failed ({failed.errorCode}): {failed.errorMessage}
        </p>
      )}
      {history.isLoading ? <Skeleton className="h-32 w-full" /> : latest ? (
        <>
          <p className="text-xs text-muted">Analysis from {fmtDateTime(latest.createdAt)}</p>
          <TriageResultPanel key={latest.id} analysis={latest} applying={apply.isPending} current={{ category: incident.category, severity: incident.severity, priority: incident.priority, team: incident.team?.name }} onApply={(fields) => apply.mutate({ analysisId: latest.id, fields })} />
        </>
      ) : !failed && <EmptyState title="No analysis yet" body="Run triage to get a suggested category, severity, team and first steps." icon={<Sparkles size={28} />} />}
    </div>
  );
}
