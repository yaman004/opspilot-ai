import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { DEFAULT_ESCALATION_RULES, SEVERITIES, formatDuration, type EscalationRule, type SlaPolicyDto, type SlaTargets } from '@opspilot/shared';
import { api, ApiError } from '../lib/api';
import { useAuth, useOrgId } from '../lib/auth';
import { fmtRelative, label } from '../lib/format';
import { useToast } from '../lib/ui-state';
import { Button, ErrorState, FormError, PageHeader, Skeleton, TextField, errorMessage } from '../components/ui';

interface SlaResponse { policy: SlaPolicyDto; timeScale: number; scanIntervalSeconds: number }

const TRIGGERS: Array<{ value: EscalationRule['trigger']; label: string }> = [
  { value: 'response_warning', label: 'Response at risk' },
  { value: 'response_breach', label: 'Response breached' },
  { value: 'resolution_warning', label: 'Resolution at risk' },
  { value: 'resolution_breach', label: 'Resolution breached' },
];

export function SlaPage() {
  const orgId = useOrgId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const manage = can('sla:manage');
  const q = useQuery({ queryKey: ['org', orgId, 'sla'], queryFn: () => api.get<SlaResponse>(`/orgs/${orgId}/sla-policy`) });

  const [name, setName] = useState('');
  const [targets, setTargets] = useState<SlaTargets | null>(null);
  const [rules, setRules] = useState<EscalationRule[]>([]);
  const [isActive, setIsActive] = useState(true);
  useEffect(() => {
    if (!q.data) return;
    const p = q.data.policy;
    setName(p.name); setTargets(structuredClone(p.targets)); setRules(structuredClone(p.escalationRules)); setIsActive(p.isActive);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => api.put(`/orgs/${orgId}/sla-policy`, { name, targets, escalationRules: rules, isActive }),
    onSuccess: () => { toast.success('SLA policy saved'); void qc.invalidateQueries({ queryKey: ['org', orgId] }); },
  });
  const scan = useMutation({
    mutationFn: () => api.post<{ result: { scanned: number; alertsRaised: number; notificationsCreated: number } }>(`/orgs/${orgId}/sla-policy/scan`),
    onSuccess: ({ result }) => { toast.success(`Checked ${result.scanned} active incidents · ${result.alertsRaised} new alerts`); void qc.invalidateQueries({ queryKey: ['org', orgId] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <><PageHeader title="SLA policy" /><Skeleton className="h-96" /></>;
  if (q.isError || !q.data || !targets) return <><PageHeader title="SLA policy" /><div className="panel"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div></>;

  const fe = save.error instanceof ApiError ? save.error.fieldErrors : undefined;
  const setTarget = (sev: (typeof SEVERITIES)[number], key: 'responseMinutes' | 'resolutionMinutes', v: string) =>
    setTargets({ ...targets, [sev]: { ...targets[sev], [key]: v === '' ? 0 : Number(v) } });
  const updateRule = (id: string, patch: Partial<EscalationRule>) => setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const toggleRole = (r: EscalationRule, role: 'owner' | 'admin' | 'agent') =>
    updateRule(r.id, { notifyRoles: r.notifyRoles.includes(role) ? r.notifyRoles.filter((x) => x !== role) : [...r.notifyRoles, role] });
  const addRule = () => setRules([...rules, { id: `rule-${Date.now().toString(36)}`, trigger: 'response_warning', thresholdPercent: 75, notifyRoles: [], notifyAssignee: true, notifyTeamMembers: false, bumpPriority: false }]);
  const scaled = q.data.timeScale !== 1;

  return (
    <>
      <PageHeader
        title="SLA policy"
        subtitle={`Last updated ${fmtRelative(q.data.policy.updatedAt)}`}
        actions={manage ? <Button onClick={() => scan.mutate()} loading={scan.isPending}><RefreshCw size={15} aria-hidden /> Run SLA check now</Button> : undefined}
      />
      {scaled && (
        <p role="status" className="mb-4 rounded border border-warn/40 bg-warn/10 p-3 text-sm">
          <strong>Development time scale is on.</strong> SLA deadlines are compressed {q.data.timeScale}× (a 60-minute target elapses in {formatDuration((60 * 60_000) / q.data.timeScale)}). The worker checks every {q.data.scanIntervalSeconds}s. Production should run with <code>SLA_TIME_SCALE=1</code>.
        </p>
      )}
      {!manage && <p role="status" className="mb-4 rounded border border-line bg-sunken/50 p-3 text-sm">You can view the policy, but only owners and admins can change it.</p>}

      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5" noValidate>
        <fieldset disabled={!manage || save.isPending} className="panel space-y-4 p-5">
          <legend className="sr-only">Policy</legend>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[14rem] flex-1"><TextField label="Policy name" value={name} onChange={(e) => setName(e.target.value)} error={fe?.name} /></div>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Enforce this policy (raise alerts)</label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="mb-2 text-left text-base font-semibold">Targets by severity</caption>
              <thead><tr className="border-b border-line"><th className="th">Severity</th><th className="th">First response (minutes)</th><th className="th">Resolution (minutes)</th></tr></thead>
              <tbody>
                {[...SEVERITIES].reverse().map((sev) => (
                  <tr key={sev} className="border-b border-line last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-medium">{label(sev)}</th>
                    {(['responseMinutes', 'resolutionMinutes'] as const).map((k) => (
                      <td key={k} className="px-3 py-2">
                        <input aria-label={`${label(sev)} ${k === 'responseMinutes' ? 'response' : 'resolution'} minutes`} type="number" min={1} className="input w-32 py-1" value={targets[sev][k] || ''} onChange={(e) => setTarget(sev, k, e.target.value)} />
                        <span className="ml-2 text-xs text-muted">{formatDuration(targets[sev][k] * 60_000)}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fe && Object.entries(fe).filter(([k]) => k.startsWith('targets')).map(([k, v]) => <p key={k} role="alert" className="text-sm text-crit">{v}</p>)}
        </fieldset>

        <fieldset disabled={!manage || save.isPending} className="panel space-y-3 p-5">
          <div className="flex items-center justify-between">
            <legend className="text-base font-semibold">Escalation rules</legend>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setRules(structuredClone(DEFAULT_ESCALATION_RULES))}>Reset to defaults</Button>
              <Button size="sm" onClick={addRule} disabled={rules.length >= 12}><Plus size={14} aria-hidden /> Add rule</Button>
            </div>
          </div>
          {rules.length === 0 && <p className="text-sm text-muted">No rules: nobody is alerted when an SLA is at risk or breached.</p>}
          {rules.map((r, i) => {
            const warn = r.trigger.endsWith('warning');
            return (
              <div key={r.id} className="grid gap-3 rounded-lg border border-line p-3 md:grid-cols-[12rem_8rem_1fr_auto] md:items-start" role="group" aria-label={`Rule ${i + 1}`}>
                <label className="text-sm">When<select className="input mt-1 py-1.5" value={r.trigger} onChange={(e) => { const trigger = e.target.value as EscalationRule['trigger']; updateRule(r.id, { trigger, thresholdPercent: trigger.endsWith('warning') ? r.thresholdPercent ?? 75 : undefined }); }}>{TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
                <label className="text-sm">{warn ? 'Elapsed %' : 'Threshold'}
                  {warn ? <input type="number" min={10} max={99} className="input mt-1 py-1.5" value={r.thresholdPercent ?? ''} onChange={(e) => updateRule(r.id, { thresholdPercent: Number(e.target.value) })} /> : <span className="mt-1 block py-1.5 text-muted">At deadline</span>}
                </label>
                <div className="text-sm">
                  <p className="mb-1">Notify</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.notifyAssignee} onChange={(e) => updateRule(r.id, { notifyAssignee: e.target.checked })} /> Assignee</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.notifyTeamMembers} onChange={(e) => updateRule(r.id, { notifyTeamMembers: e.target.checked })} /> Team</label>
                    {(['owner', 'admin', 'agent'] as const).map((role) => <label key={role} className="flex items-center gap-1.5"><input type="checkbox" checked={r.notifyRoles.includes(role)} onChange={() => toggleRole(r, role)} /> All {role}s</label>)}
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.bumpPriority} onChange={(e) => updateRule(r.id, { bumpPriority: e.target.checked })} /> Raise priority</label>
                  </div>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Delete rule ${i + 1}`} onClick={() => setRules(rules.filter((x) => x.id !== r.id))}><Trash2 size={14} aria-hidden /></Button>
              </div>
            );
          })}
        </fieldset>

        <FormError error={save.error} />
        {manage && <div className="flex justify-end"><Button type="submit" variant="primary" loading={save.isPending}>Save policy</Button></div>}
      </form>
    </>
  );
}
