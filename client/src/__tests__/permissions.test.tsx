import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { can } from '@opspilot/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));
import { useAuth } from '../lib/auth';
import { RequirePermission } from '../App';

function renderAs(role: 'viewer' | 'agent' | 'admin' | 'owner') {
  vi.mocked(useAuth).mockReturnValue({ can: (p: Parameters<typeof can>[1]) => can(role, p) } as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter>
      <RequirePermission perm="incident:create">
        <p>Create form</p>
      </RequirePermission>
    </MemoryRouter>,
  );
}

describe('permission gating', () => {
  it('hides a protected screen from viewers and explains why', () => {
    renderAs('viewer');
    expect(screen.queryByText('Create form')).not.toBeInTheDocument();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
  });

  it.each(['agent', 'admin', 'owner'] as const)('lets %s through', (role) => {
    renderAs(role);
    expect(screen.getByText('Create form')).toBeInTheDocument();
  });
});
