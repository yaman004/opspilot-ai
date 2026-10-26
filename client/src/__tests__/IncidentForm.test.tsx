import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth', () => ({ useOrgId: () => 'org1', useAuth: () => ({ can: () => true }) }));
vi.mock('../lib/ui-state', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('../lib/queries', async (orig) => ({
  ...(await orig<typeof import('../lib/queries')>()),
  useTeams: () => ({ data: [] }),
  useMembers: () => ({ data: [] }),
  useIncident: () => ({ data: undefined, isLoading: false, isError: false }),
}));
vi.mock('../components/Triage', async (orig) => ({
  ...(await orig<typeof import('../components/Triage')>()),
  AiStatusNotice: () => null,
}));
vi.mock('../lib/api', async (orig) => {
  const real = await orig<typeof import('../lib/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() } };
});
import { api } from '../lib/api';
import { IncidentFormPage } from '../pages/IncidentForm';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/new']}>
        <Routes><Route path="/new" element={<IncidentFormPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('IncidentFormPage', () => {
  it('blocks an empty submission and explains what is missing', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Create incident' }));
    expect(await screen.findAllByText(/./, { selector: '[id$="-err"]' })).not.toHaveLength(0);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps triage disabled until there is enough to analyze', async () => {
    setup();
    const triage = screen.getByRole('button', { name: 'Suggest triage' });
    expect(triage).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Title/), 'Checkout failing');
    await userEvent.type(screen.getByLabelText(/Description/), 'Customers cannot pay since the last deploy.');
    expect(triage).toBeEnabled();
  });

  it('sends the cleaned payload when valid', async () => {
    vi.mocked(api.post).mockResolvedValue({ incident: { id: 'a'.repeat(24) } });
    setup();
    await userEvent.type(screen.getByLabelText(/Title/), 'Checkout failing');
    await userEvent.type(screen.getByLabelText(/Description/), 'Customers cannot pay since the last deploy.');
    await userEvent.click(screen.getByRole('button', { name: 'Create incident' }));
    expect(api.post).toHaveBeenCalledWith('/orgs/org1/incidents', expect.objectContaining({ title: 'Checkout failing', severity: 'medium' }));
  });
});
