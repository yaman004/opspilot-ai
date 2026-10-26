import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Sparkles } from 'lucide-react';
import type { AiAnalysisDto } from '@opspilot/shared';
import { api } from '../lib/api';
import { useOrgId } from '../lib/auth';
import { label } from '../lib/format';
import { Button, SeverityBadge } from './ui';

export type ApplyField = 'category' | 'severity' | 'priority' | 'team' | 'notes';

export function useAiStatus() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['org', orgId, 'ai', 'status'],
    queryFn: () => api.get<{ provider: string; model: string; isMock: boolean; notice: string | null }>(`/orgs/${orgId}/ai/status`),
    staleTime: 5 * 60_000,
  });
}

/** Always visible next to AI output so simulated results are never mistaken for a real model's. */
export function ProviderBadge({ isMock, provider, model }: { isMock: boolean; provider: string; model: string }) {
  return isMock ? (
    <span className="inline-flex items-center gap-1.5 rounded border border-warn/50 bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn" title="Keyword heuristic built into the server. Not an AI model.">
      <FlaskConical size={13} aria-hidden /> Mock provider · not an AI model
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded border border-line px-2 py-0.5 text-xs font-medium text-muted">
      <Sparkles size={13} aria-hidden /> {provider} · {model}
    </span>
  );
}

export function AiStatusNotice() {
  const s = useAiStatus();
  if (!s.data) return null;
  return s.data.isMock ? (
    <div role="note" className="flex items-start gap-2.5 rounded border border-warn/40 bg-warn/10 p-3 text-sm">
      <FlaskConical size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
      <p><strong>Simulated suggestions.</strong> This server is using its built-in keyword heuristic, which is not an AI model. Ask an administrator to set <code>AI_PROVIDER</code> to use a real one.</p>
    </div>
  ) : (
    <p className="text-xs text-muted">Suggestions come from {s.data.provider} ({s.data.model}). They can be wrong. Review before applying.</p>
  );
}

/**
 * Shows a validated analysis and lets the user tick exactly which suggestions to apply.
 * `available` limits the choices (e.g. a not-yet-saved incident has no notes or team ids to apply to).
 */
export function TriageResultPanel({
  analysis,
  available = ['category', 'severity', 'priority', 'team', 'notes'],
  onApply,
  applying,
  current,
  applyLabel = 'Apply selected',
}: {
  analysis: AiAnalysisDto;
  available?: ApplyField[];
  onApply: (fields: ApplyField[]) => void;
  applying?: boolean;
  current?: Partial<Record<'category' | 'severity' | 'priority' | 'team', string | null | undefined>>;
  applyLabel?: string;
}) {
  const r = analysis.result;
  // Field changes start ticked (team only if one was suggested); adding the note is opt-in.
  const [picked, setPicked] = useState<Set<ApplyField>>(
    () => new Set(available.filter((f) => (f === 'team' ? Boolean(analysis.result?.suggestedTeam) : f !== 'notes'))),
  );
  if (!r) return null;
  const toggle = (f: ApplyField) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });

  const rows: Array<{ field: ApplyField; name: string; value: string; node?: React.ReactNode; disabled?: boolean; was?: string | null }> = [
    { field: 'category', name: 'Category', value: label(r.category), was: current?.category ? label(current.category) : null },
    { field: 'severity', name: 'Severity', value: label(r.severity), node: <SeverityBadge severity={r.severity} />, was: current?.severity ? label(current.severity) : null },
    { field: 'priority', name: 'Priority', value: label(r.priority), was: current?.priority ? label(current.priority) : null },
    { field: 'team', name: 'Team', value: r.suggestedTeam ?? 'No matching team', disabled: !r.suggestedTeam, was: current?.team ?? null },
    { field: 'notes', name: 'Add summary, questions and steps as an internal note', value: '' },
  ];
  const visible = rows.filter((x) => available.includes(x.field));
  const chosen = visible.filter((x) => picked.has(x.field) && !x.disabled).map((x) => x.field);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ProviderBadge isMock={analysis.isMock} provider={analysis.provider} model={analysis.model} />
        <span className="text-xs text-muted">Confidence {Math.round(r.confidence * 100)}%</span>
      </div>
      <p className="text-sm">{r.summary}</p>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Choose what to apply</legend>
        <div className="divide-y divide-line rounded border border-line">
          {visible.map((x) => (
            <label key={x.field} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${x.disabled ? 'opacity-50' : 'cursor-pointer hover:bg-sunken/50'}`}>
              <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-accent))]" checked={picked.has(x.field) && !x.disabled} disabled={x.disabled} onChange={() => toggle(x.field)} />
              {x.field === 'notes' ? (
                <span>{x.name}</span>
              ) : (
                <>
                  <span className="w-20 text-muted">{x.name}</span>
                  <span className="font-medium">{x.node ?? x.value}</span>
                  {x.was && x.was !== x.value && <span className="ml-auto text-xs text-muted">now {x.was}</span>}
                </>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <h4 className="mb-1 text-sm font-medium">Questions to ask</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{r.diagnosticQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
        </section>
        <section>
          <h4 className="mb-1 text-sm font-medium">First troubleshooting steps</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{r.troubleshootingSteps.map((q, i) => <li key={i}>{q}</li>)}</ul>
        </section>
      </div>

      <div className="flex items-center justify-between gap-3">
        {analysis.appliedFields.length > 0 ? <span className="text-xs text-muted">Already applied: {analysis.appliedFields.join(', ')}</span> : <span />}
        <Button variant="primary" loading={applying} disabled={!chosen.length} onClick={() => onApply(chosen)}>
          {applyLabel} ({chosen.length})
        </Button>
      </div>
    </div>
  );
}
