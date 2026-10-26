import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { IncidentDto } from '@opspilot/shared';
import { fmtMs } from '../lib/format';

/** Re-renders on an interval so countdowns stay live without refetching. */
function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const SEGMENTS = 12;

/**
 * The SLA clock rail: a row of segments that fill as the resolution window is spent, turning amber past 75%
 * and crimson when breached. Completed incidents show whether the deadline was met.
 */
export function SlaRail({ incident, compact }: { incident: Pick<IncidentDto, 'createdAt' | 'sla' | 'status' | 'resolvedAt'>; compact?: boolean }) {
  const now = useNow();
  const due = incident.sla.resolutionDueAt ? new Date(incident.sla.resolutionDueAt).getTime() : null;
  if (!due) return <span className="text-xs text-muted">No SLA</span>;

  const start = new Date(incident.createdAt).getTime();
  const done = incident.status === 'resolved' || incident.status === 'closed';
  const end = done && incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now;
  const window = Math.max(due - start, 1);
  const used = Math.max(0, (end - start) / window);
  const breached = done ? incident.sla.resolution === 'met_late' : now > due;
  const tone = breached ? 'bg-crit' : used >= 0.75 ? 'bg-high' : 'bg-accent';
  const filled = Math.min(SEGMENTS, Math.ceil(Math.min(used, 1) * SEGMENTS));
  const remaining = due - now;

  const text = done
    ? breached
      ? 'Resolved late'
      : 'Met'
    : breached
      ? `${fmtMs(-remaining)} overdue`
      : `${fmtMs(remaining)} left`;

  return (
    <div
      className={clsx('flex items-center gap-2', compact ? 'min-w-[8.5rem]' : 'min-w-[11rem]')}
      role="img"
      aria-label={`Resolution SLA: ${text}`}
      title={`Resolution due ${new Date(due).toLocaleString()}`}
    >
      <div className="flex gap-[2px]" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={clsx(
              'h-3 w-[5px] rounded-[1px]',
              i < filled ? tone : 'bg-sunken',
              breached && !done && i < filled && 'rail-breached',
            )}
          />
        ))}
      </div>
      <span className={clsx('text-xs font-medium', breached ? 'text-crit' : used >= 0.75 && !done ? 'text-high' : 'text-muted')}>{text}</span>
    </div>
  );
}

const stageStyle = { met: 'text-ok', met_late: 'text-crit', pending: 'text-muted', breached: 'text-crit' } as const;
const stageText = { met: 'Met', met_late: 'Met late', pending: 'On track', breached: 'Breached' } as const;
export function SlaStage({ state }: { state: keyof typeof stageStyle }) {
  return <span className={clsx('text-sm font-medium', stageStyle[state])}>{stageText[state]}</span>;
}
