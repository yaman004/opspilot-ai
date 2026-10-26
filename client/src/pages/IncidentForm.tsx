import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { createIncidentSchema, type AiAnalysisDto, type IncidentDto } from '@opspilot/shared';
import { api, ApiError } from '../lib/api';
import { useOrgId } from '../lib/auth';
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS, SEVERITY_OPTIONS, useIncident, useMembers, useTeams } from '../lib/queries';
import { useToast } from '../lib/ui-state';
import { Button, ErrorState, FormError, PageHeader, SelectField, Skeleton, TextArea, TextField, errorMessage } from '../components/ui';
import { AiStatusNotice, TriageResultPanel, type ApplyField } from '../components/Triage';

interface FormState {
  title: string;
  description: string;
  category: string;
  severity: string;
  priority: string;
  teamId: string;
  assigneeId: string;
  tags: string;
}
const EMPTY: FormState = { title: '', description: '', category: 'application', severity: 'medium', priority: '', teamId: '', assigneeId: '', tags: '' };

export function IncidentFormPage() {
  const { incidentId } = useParams();
  const editing = Boolean(incidentId);
  const orgId = useOrgId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const teams = useTeams();
  const members = useMembers();
  const existing = useIncident(incidentId ?? '');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [analysis, setAnalysis] = useState<AiAnalysisDto | null>(null);
  const [triageError, setTriageError] = useState<unknown>(null);

  useEffect(() => {
    const i: IncidentDto | undefined = existing.data;
    if (editing && i) {
      setForm({ title: i.title, description: i.description, category: i.category, severity: i.severity, priority: i.priority, teamId: i.team?.id ?? '', assigneeId: i.assignee?.id ?? '', tags: i.tags.join(', ') });
    }
  }, [editing, existing.data]);

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const tagList = form.tags.split(',').map((t) => t.trim()).filter(Boolean);

  const save = useMutation({
    mutationFn: async () => {
      const base = {
        title: form.title,
        description: form.description,
        category: form.category,
        severity: form.severity,
        ...(form.priority ? { priority: form.priority } : {}),
        teamId: form.teamId || null,
        tags: tagList,
      };
      if (editing) {
        const res = await api.patch<{ incident: IncidentDto }>(`/orgs/${orgId}/incidents/${incidentId}`, { ...base, priority: form.priority || undefined });
        if ((existing.data?.assignee?.id ?? '') !== form.assigneeId) {
          return (await api.post<{ incident: IncidentDto }>(`/orgs/${orgId}/incidents/${incidentId}/assign`, { assigneeId: form.assigneeId || null })).incident;
        }
        return res.incident;
      }
      return (await api.post<{ incident: IncidentDto }>(`/orgs/${orgId}/incidents`, { ...base, assigneeId: form.assigneeId || null })).incident;
    },
    onSuccess: (inc) => {
      void qc.invalidateQueries({ queryKey: ['org', orgId] });
      toast.success(editing ? `${inc.key} updated` : `${inc.key} created`);
      navigate(`/app/incidents/${inc.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) setErrors(err.fieldErrors);
      setFormError(err);
    },
  });

  const triage = useMutation({
    mutationFn: () => api.post<{ analysis: AiAnalysisDto }>(`/orgs/${orgId}/ai/triage`, { title: form.title, description: form.description, ...(editing ? { incidentId } : {}) }),
    onSuccess: (r) => {
      setAnalysis(r.analysis);
      setTriageError(null);
    },
    onError: (err) => {
      setAnalysis(null);
      setTriageError(err);
    },
  });

  const applyToForm = (fields: ApplyField[]) => {
    const r = analysis?.result;
    if (!r) return;
    setForm((f) => {
      const next = { ...f };
      if (fields.includes('category')) next.category = r.category;
      if (fields.includes('severity')) next.severity = r.severity;
      if (fields.includes('priority')) next.priority = r.priority;
      if (fields.includes('team') && r.suggestedTeam) next.teamId = teams.data?.find((t) => t.name === r.suggestedTeam)?.id ?? f.teamId;
      return next;
    });
    toast.success('Applied to the form. Review, then save.');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = createIncidentSchema.safeParse({ title: form.title, description: form.description, category: form.category, severity: form.severity, tags: tagList });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
      setErrors(fe);
      return;
    }
    setErrors({});
    save.mutate();
  };

  if (editing && existing.isLoading) return <div className="panel space-y-4 p-6"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-32 w-full" /></div>;
  if (editing && existing.isError) return <div className="panel"><ErrorState error={existing.error} onRetry={() => existing.refetch()} title="Could not load this incident" /></div>;
  if (editing && existing.data?.status === 'closed') {
    return <div className="panel"><ErrorState error={new Error('Closed incidents are read-only. Reopen it from the incident page to edit.')} title="This incident is closed" /></div>;
  }

  const canTriage = form.title.trim().length >= 3 && form.description.trim().length >= 10;
  const memberOptions = [{ value: '', label: 'Unassigned' }, ...(members.data ?? []).filter((m) => m.role !== 'viewer').map((m) => ({ value: m.user.id, label: `${m.user.name} (${m.role})` }))];

  return (
    <>
      <PageHeader title={editing ? `Edit ${existing.data?.key ?? ''}` : 'New incident'} subtitle={editing ? undefined : 'SLA deadlines start now and follow your policy for the severity you pick.'} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <form onSubmit={submit} className="panel space-y-4 p-5" noValidate>
          <FormError error={Object.keys(errors).length ? null : formError} />
          <TextField label="Title" required value={form.title} onChange={set('title')} error={errors.title} maxLength={200} placeholder="What's broken, in one line" autoFocus />
          <TextArea label="Description" required value={form.description} onChange={set('description')} error={errors.description} rows={7} placeholder="What happened, who is affected, what you already tried" />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Category" value={form.category} onChange={set('category')} options={CATEGORY_OPTIONS} error={errors.category} />
            <SelectField label="Severity" value={form.severity} onChange={set('severity')} options={SEVERITY_OPTIONS} error={errors.severity} hint="Drives the SLA deadlines." />
            <SelectField label="Priority" value={form.priority} onChange={set('priority')} options={[{ value: '', label: editing ? 'Keep current' : 'Match severity' }, ...PRIORITY_OPTIONS]} />
            <SelectField label="Team" value={form.teamId} onChange={set('teamId')} options={[{ value: '', label: 'No team' }, ...(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
            <SelectField label="Assignee" value={form.assigneeId} onChange={set('assigneeId')} options={memberOptions} />
            <TextField label="Tags" value={form.tags} onChange={set('tags')} error={errors.tags} hint="Comma separated, up to 10." placeholder="checkout, payments" />
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Link to={editing ? `/app/incidents/${incidentId}` : '/app/incidents'} className="inline-flex items-center rounded border border-line px-3.5 py-2 text-sm font-medium hover:bg-sunken">Cancel</Link>
            <Button type="submit" variant="primary" loading={save.isPending}>{editing ? 'Save changes' : 'Create incident'}</Button>
          </div>
        </form>

        <aside className="panel space-y-3 p-4 lg:sticky lg:top-20" aria-label="AI triage">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Sparkles size={16} className="text-accent" aria-hidden /> AI triage</h2>
          <p className="text-sm text-muted">Suggests a category, severity, priority and team from your description. Nothing changes until you apply it.</p>
          <AiStatusNotice />
          <Button className="w-full" loading={triage.isPending} disabled={!canTriage} onClick={() => triage.mutate()}>
            {analysis ? 'Run again' : 'Suggest triage'}
          </Button>
          {!canTriage && <p className="text-xs text-muted">Add a title and a few sentences of description first.</p>}
          {triageError != null && <FormError error={triageError} />}
          {analysis && (
            <TriageResultPanel
              analysis={analysis}
              available={['category', 'severity', 'priority', 'team']}
              applyLabel="Apply to form"
              onApply={applyToForm}
              current={{ category: form.category, severity: form.severity, priority: form.priority, team: teams.data?.find((t) => t.id === form.teamId)?.name }}
            />
          )}
        </aside>
      </div>
      {save.isError && !formError && <p className="sr-only" role="alert">{errorMessage(save.error)}</p>}
    </>
  );
}
