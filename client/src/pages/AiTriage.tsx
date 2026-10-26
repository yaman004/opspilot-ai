import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import type { AiAnalysisDto, IncidentDto, Paginated } from '@opspilot/shared';
import { api } from '../lib/api';
import { useAuth, useOrgId } from '../lib/auth';
import { fmtRelative, label } from '../lib/format';
import { useToast } from '../lib/ui-state';
import { Button, EmptyState, ErrorState, FormError, PageHeader, SelectField, Skeleton, TextArea, TextField, errorMessage } from '../components/ui';
import { AiStatusNotice, ProviderBadge, TriageResultPanel, type ApplyField } from '../components/Triage';

/**
 * Standalone triage workbench: paste a report, review suggestions, and either create an incident from them
 * (through the normal form) or apply them to an existing incident.
 */
export function AiTriagePage() {
  const orgId = useOrgId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState('');
  const [analysis, setAnalysis] = useState<AiAnalysisDto | null>(null);

  const incidents = useQuery({
    queryKey: ['org', orgId, 'incidents', 'triage-targets'],
    queryFn: () => api.get<Paginated<IncidentDto>>(`/orgs/${orgId}/incidents`, { status: 'open,triaged,in_progress,blocked', pageSize: 50, sort: 'updatedAt' }),
  });
  const history = useQuery({
    queryKey: ['org', orgId, 'ai', 'history'],
    queryFn: async () => (await api.get<{ analyses: AiAnalysisDto[] }>(`/orgs/${orgId}/ai/analyses`)).analyses,
  });

  const run = useMutation({
    mutationFn: () => api.post<{ analysis: AiAnalysisDto }>(`/orgs/${orgId}/ai/triage`, { title, description, ...(target ? { incidentId: target } : {}) }),
    onSuccess: (r) => { setAnalysis(r.analysis); void qc.invalidateQueries({ queryKey: ['org', orgId, 'ai', 'history'] }); },
    onError: () => { setAnalysis(null); void qc.invalidateQueries({ queryKey: ['org', orgId, 'ai', 'history'] }); },
  });
  const apply = useMutation({
    mutationFn: (fields: ApplyField[]) => api.post(`/orgs/${orgId}/incidents/${target}/ai/apply`, { analysisId: analysis?.id, fields }),
    onSuccess: () => { toast.success('Suggestions applied to the incident'); void qc.invalidateQueries({ queryKey: ['org', orgId] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const pickIncident = (id: string) => {
    setTarget(id);
    const inc = incidents.data?.items.find((i) => i.id === id);
    if (inc) { setTitle(inc.title); setDescription(inc.description); }
    setAnalysis(null);
  };
  const ready = title.trim().length >= 3 && description.trim().length >= 10;

  return (
    <>
      <PageHeader title="AI triage" subtitle="Get a suggested category, severity, priority, team and first steps. You decide what to apply." />
      <div className="mb-4"><AiStatusNotice /></div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="panel space-y-4 p-5" aria-label="Incident to analyze">
          <SelectField label="Analyze an existing incident" value={target} onChange={(e) => pickIncident(e.target.value)} options={[{ value: '', label: 'No — paste a new report' }, ...(incidents.data?.items ?? []).map((i) => ({ value: i.id, label: `${i.key} · ${i.title}` }))]} hint="Lets you apply the suggestions directly to that incident." />
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} readOnly={!!target} />
          <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={8} readOnly={!!target} hint="More detail gives better suggestions." />
          <FormError error={run.error} />
          <Button variant="primary" className="w-full" loading={run.isPending} disabled={!ready} onClick={() => run.mutate()}><Sparkles size={15} aria-hidden /> Analyze</Button>
        </section>

        <section className="panel space-y-3 p-5" aria-label="Suggestions" aria-live="polite">
          <h2 className="text-base font-semibold">Suggestions</h2>
          {run.isPending ? <Skeleton className="h-64 w-full" /> : analysis ? (
            <>
              <TriageResultPanel
                key={analysis.id}
                analysis={analysis}
                applying={apply.isPending}
                available={target ? ['category', 'severity', 'priority', 'team', 'notes'] : []}
                applyLabel="Apply to incident"
                onApply={(f) => apply.mutate(f)}
              />
              {!target && can('incident:create') && (
                <div className="rounded border border-line bg-sunken/50 p-3 text-sm">
                  To act on these suggestions, <Link className="font-medium text-accent hover:underline" to="/app/incidents/new">create an incident</Link> — the form has its own triage panel that applies suggestions to the fields you choose.
                </div>
              )}
            </>
          ) : (
            <EmptyState title="Nothing analyzed yet" body="Choose an incident or paste a report, then select Analyze." icon={<Sparkles size={28} />} />
          )}
        </section>
      </div>

      <section className="panel mt-6 overflow-hidden" aria-label="Recent analyses">
        <h2 className="border-b border-line px-4 py-3 text-base font-semibold">Recent analyses</h2>
        {history.isLoading ? <Skeleton className="m-4 h-20" /> : history.isError ? <ErrorState error={history.error} onRetry={() => history.refetch()} /> : !history.data?.length ? (
          <p className="p-4 text-sm text-muted">No analyses have been run yet.</p>
        ) : (
          <ul>
            {history.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0">
                <span className="min-w-0 flex-1 basis-56 text-sm">
                  {a.status === 'succeeded' && a.result ? <>{label(a.result.category)} · {label(a.result.severity)} severity · {a.result.summary}</> : <span className="text-crit">Failed: {a.errorMessage}</span>}
                </span>
                <ProviderBadge isMock={a.isMock} provider={a.provider} model={a.model} />
                {a.incidentId && <Link to={`/app/incidents/${a.incidentId}`} className="text-sm text-accent hover:underline">Incident</Link>}
                <span className="text-xs text-muted">{fmtRelative(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
