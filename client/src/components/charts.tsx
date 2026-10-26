import { useMemo, useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Kpis, TrendPoint, WorkloadRow } from '@opspilot/shared';
import { fmtDay, label } from '../lib/format';
import { toLocalInputValue } from '../lib/format';
import { Button, FilterSelect, TextField } from './ui';

export interface AnalyticsOverview {
  range: { from: string; to: string };
  kpis: Kpis;
  trend: TrendPoint[];
  severity: Array<{ severity: 'low' | 'medium' | 'high' | 'critical'; count: number }>;
  categories: Array<{ category: string; count: number }>;
  workload: Array<WorkloadRow & { teamName: string }>;
  resolutionRates: Array<{ severity: string; created: number; resolved: number; rate: number | null }>;
  truncated: boolean;
  generatedAt: string;
}

/* ---------------------------- date range ----------------------------- */
const PRESETS = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 } as const;
type Preset = keyof typeof PRESETS | 'custom';

export interface RangeState {
  preset: Preset;
  from: string;
  /** Only set for custom ranges; presets always end "now" on the server. */
  to: string | undefined;
  setPreset: (p: Preset) => void;
  custom: { from: string; to: string };
  setCustom: (c: { from: string; to: string }) => void;
}

export function useRange(initial: keyof typeof PRESETS = '30d'): RangeState {
  const [preset, setPreset] = useState<Preset>(initial);
  const [custom, setCustom] = useState(() => ({
    from: toLocalInputValue(new Date(Date.now() - 7 * 86_400_000)),
    to: toLocalInputValue(new Date()),
  }));
  // Presets are anchored when chosen, so the query key stays stable between renders.
  const anchor = useMemo(() => Date.now(), [preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = preset === 'custom' ? new Date(custom.from).toISOString() : new Date(anchor - PRESETS[preset] * 86_400_000).toISOString();
  const to = preset === 'custom' ? new Date(custom.to).toISOString() : undefined;
  return { preset, from, to, setPreset, custom, setCustom };
}

export function RangePicker({ range }: { range: RangeState }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(range.custom);
  const invalid = !draft.from || !draft.to || new Date(draft.from) >= new Date(draft.to);
  return (
    <div className="relative flex items-center gap-2">
      <FilterSelect
        label="Date range"
        value={range.preset}
        onChange={(e) => {
          const v = e.target.value as Preset;
          if (v === 'custom') setOpen(true);
          else range.setPreset(v);
        }}
        options={[
          { value: '24h', label: 'Last 24 hours' },
          { value: '7d', label: 'Last 7 days' },
          { value: '30d', label: 'Last 30 days' },
          { value: '90d', label: 'Last 90 days' },
          { value: 'custom', label: 'Custom range…' },
        ]}
      />
      {open && (
        <div role="dialog" aria-label="Custom date range" className="absolute right-0 top-full z-30 mt-1 w-72 space-y-3 rounded-lg border border-line bg-surface p-4 shadow-xl">
          <TextField label="From" type="datetime-local" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          <TextField label="To" type="datetime-local" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} error={invalid && draft.from && draft.to ? 'Start must be before end' : undefined} />
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={invalid} onClick={() => { range.setCustom(draft); range.setPreset('custom'); setOpen(false); }}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- charts ------------------------------- */
const css = (v: string) => `rgb(var(--c-${v}))`;
export const SEV_COLOR = { critical: css('crit'), high: css('high'), medium: css('med'), low: css('low') } as const;
const CAT_COLORS = ['accent', 'med', 'high', 'ok', 'crit', 'warn', 'low', 'muted', 'ink'].map(css);

const axisProps = { tick: { fill: css('muted'), fontSize: 12 }, axisLine: { stroke: css('line') }, tickLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: css('surface'), border: `1px solid ${css('line')}`, borderRadius: 8, fontSize: 13, color: css('ink') },
  labelStyle: { color: css('ink'), fontWeight: 600 },
  itemStyle: { color: css('ink') },
  cursor: { fill: 'rgb(var(--c-sunken) / 0.6)' },
};

export function ChartCard({ title, subtitle, children, empty, height = 260 }: { title: string; subtitle?: string; children: ReactNode; empty?: boolean; height?: number }) {
  return (
    <section className="panel p-4" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      <div className="mt-3" style={{ height }}>
        {empty ? <div className="grid h-full place-items-center text-sm text-muted">No incidents in this range yet.</div> : children}
      </div>
    </section>
  );
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={css('line')} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDay} {...axisProps} minTickGap={24} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipStyle} labelFormatter={(d) => fmtDay(String(d))} />
        <Legend verticalAlign="top" align="right" height={24} iconType="plainline" wrapperStyle={{ fontSize: 12, color: css('muted') }} />
        <Area type="linear" dataKey="created" name="Created" stroke={css('high')} fill={css('high')} fillOpacity={0.12} strokeWidth={2} />
        <Area type="linear" dataKey="resolved" name="Resolved" stroke={css('accent')} fill={css('accent')} fillOpacity={0.14} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SeverityChart({ data }: { data: AnalyticsOverview['severity'] }) {
  const rows = data.map((d) => ({ name: label(d.severity), value: d.count, key: d.severity }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="82%" paddingAngle={2} stroke={css('surface')}>
          {rows.map((r) => <Cell key={r.key} fill={SEV_COLOR[r.key]} />)}
        </Pie>
        <Tooltip {...tooltipStyle} />
        <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12, color: css('muted') }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CategoryChart({ data }: { data: AnalyticsOverview['categories'] }) {
  const rows = [...data].sort((a, b) => b.count - a.count).map((d) => ({ name: label(d.category), count: d.count }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, left: 12, bottom: 0 }}>
        <CartesianGrid stroke={css('line')} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axisProps} />
        <YAxis type="category" dataKey="name" width={96} {...axisProps} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey="count" name="Incidents" radius={[0, 3, 3, 0]}>
          {rows.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function WorkloadChart({ data }: { data: AnalyticsOverview['workload'] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={css('line')} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="teamName" {...axisProps} interval={0} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipStyle} />
        <Legend verticalAlign="top" align="right" height={24} iconType="square" wrapperStyle={{ fontSize: 12, color: css('muted') }} />
        <Bar dataKey="active" name="Active" stackId="a" fill={css('high')} />
        <Bar dataKey="resolved" name="Resolved" stackId="a" fill={css('accent')} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ResolutionRateChart({ data }: { data: AnalyticsOverview['resolutionRates'] }) {
  const rows = data.map((d) => ({ name: label(d.severity), rate: d.rate ?? 0, key: d.severity, created: d.created, resolved: d.resolved }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={css('line')} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis domain={[0, 100]} unit="%" {...axisProps} />
        <Tooltip {...tooltipStyle} formatter={(v, _n, p) => [`${v}% (${p.payload.resolved} of ${p.payload.created})`, 'Resolved']} />
        <Bar dataKey="rate" name="Resolved" radius={[3, 3, 0, 0]}>
          {rows.map((r) => <Cell key={r.key} fill={SEV_COLOR[r.key as keyof typeof SEV_COLOR]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
