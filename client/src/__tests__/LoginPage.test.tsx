import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));
import { useAuth } from '../lib/auth';
import { LoginPage } from '../pages/AuthPages';

const login = vi.fn();
beforeEach(() => {
  login.mockReset();
  vi.mocked(useAuth).mockReturnValue({ status: 'anonymous', login } as unknown as ReturnType<typeof useAuth>);
});
const setup = () => render(<MemoryRouter><LoginPage /></MemoryRouter>);

describe('LoginPage', () => {
  it('keeps submit disabled until both fields are filled', async () => {
    setup();
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.co');
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^Password/), 'secret');
    expect(submit).toBeEnabled();
  });

  it('submits trimmed credentials', async () => {
    login.mockResolvedValue(undefined);
    setup();
    await userEvent.type(screen.getByLabelText(/^Email/), '  a@b.co ');
    await userEvent.type(screen.getByLabelText(/^Password/), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledWith('a@b.co', 'secret');
  });

  it('shows the server error without leaking details', async () => {
    login.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password'));
    setup();
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.co');
    await userEvent.type(screen.getByLabelText(/^Password/), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
  });
});
