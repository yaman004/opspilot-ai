import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AiAnalysisDto } from '@opspilot/shared';
import { ProviderBadge, TriageResultPanel } from '../components/Triage';

const analysis: AiAnalysisDto = {
  id: 'a'.repeat(24),
  incidentId: null,
  status: 'succeeded',
  provider: 'mock',
  model: 'keyword-heuristic',
  isMock: true,
  result: {
    category: 'database',
    severity: 'high',
    priority: 'high',
    confidence: 0.6,
    summary: 'Looks like a database issue.',
    suggestedTeam: 'Platform Engineering',
    diagnosticQuestions: ['When did it start?'],
    troubleshootingSteps: ['Check connection pool usage'],
    reasoning: 'Keywords matched.',
  },
  appliedFields: [],
  errorCode: null,
  errorMessage: null,
  createdAt: new Date().toISOString(),
} as unknown as AiAnalysisDto;

describe('TriageResultPanel', () => {
  it('labels mock output so it is never mistaken for a real model', () => {
    render(<ProviderBadge isMock provider="mock" model="keyword-heuristic" />);
    expect(screen.getByText(/mock provider/i)).toBeInTheDocument();
  });

  it('applies exactly the ticked fields; notes are opt-in', async () => {
    const onApply = vi.fn();
    render(<TriageResultPanel analysis={analysis} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: /apply selected/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const fields = onApply.mock.calls[0]![0] as string[];
    expect(fields).toEqual(expect.arrayContaining(['category', 'severity', 'priority', 'team']));
    expect(fields).not.toContain('notes');
  });

  it('lets the user untick a suggestion', async () => {
    const onApply = vi.fn();
    render(<TriageResultPanel analysis={analysis} onApply={onApply} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /severity/i }));
    await userEvent.click(screen.getByRole('button', { name: /apply selected/i }));
    expect(onApply.mock.calls[0]![0]).not.toContain('severity');
  });

  it('disables apply when nothing is selected', async () => {
    render(<TriageResultPanel analysis={analysis} available={['category']} onApply={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /category/i }));
    expect(screen.getByRole('button', { name: /apply selected/i })).toBeDisabled();
  });
});
