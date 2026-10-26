import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { IncidentDto } from '@opspilot/shared';
import { SlaRail } from '../components/SlaRail';

const HOUR = 3_600_000;
type Rail = Pick<IncidentDto, 'createdAt' | 'sla' | 'status' | 'resolvedAt'>;

function incident(over: Partial<Rail> & { dueInMs?: number; ageMs?: number }): Rail {
  const created = Date.now() - (over.ageMs ?? HOUR);
  return {
    createdAt: new Date(created).toISOString(),
    status: 'in_progress',
    resolvedAt: null,
    sla: {
      responseDueAt: null,
      resolutionDueAt: new Date(Date.now() + (over.dueInMs ?? HOUR)).toISOString(),
      firstRespondedAt: null,
      response: 'pending',
      resolution: 'pending',
    },
    ...over,
  };
}

describe('SlaRail', () => {
  it('says so when there is no SLA', () => {
    render(<SlaRail incident={incident({ sla: { responseDueAt: null, resolutionDueAt: null, firstRespondedAt: null, response: 'pending', resolution: 'pending' } })} />);
    expect(screen.getByText('No SLA')).toBeInTheDocument();
  });

  it('shows time left while the deadline is in the future', () => {
    render(<SlaRail incident={incident({ dueInMs: 3 * HOUR })} />);
    expect(screen.getByText(/left/i)).toBeInTheDocument();
  });

  it('shows an overdue incident as overdue', () => {
    render(<SlaRail incident={incident({ dueInMs: -2 * HOUR, ageMs: 5 * HOUR })} />);
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it('reports whether a resolved incident met its deadline', () => {
    const base = incident({ status: 'resolved', ageMs: 5 * HOUR, dueInMs: -HOUR });
    const late = { ...base, resolvedAt: new Date().toISOString(), sla: { ...base.sla, resolution: 'met_late' as const } };
    const { unmount } = render(<SlaRail incident={late} />);
    expect(screen.getByText('Resolved late')).toBeInTheDocument();
    unmount();
    const met = { ...base, resolvedAt: new Date(Date.now() - 2 * HOUR).toISOString(), sla: { ...base.sla, resolution: 'met' as const } };
    render(<SlaRail incident={met} />);
    expect(screen.getByText('Met')).toBeInTheDocument();
  });
});
