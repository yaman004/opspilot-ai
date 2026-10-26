import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { passwordSchema } from '@opspilot/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, ButtonLink, FormError, TextField } from '../components/ui';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · OpsPilot AI`;
  }, [title]);
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_28rem]">
      <aside className="hidden flex-col justify-between bg-[#12233a] p-10 text-[#e4ebf3] lg:flex">
        <Link to="/" className="flex items-center gap-2.5 text-[15px] font-semibold">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden><path d="M5 21h5l3-9 4 13 3-8h7" fill="none" stroke="#3fc1cc" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          OpsPilot AI
        </Link>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-snug tracking-tight">Every incident has an owner, a clock and a history.</p>
          <p className="mt-4 text-[#8b9cb0]">Track what's broken, who is on it, and how long is left before the SLA says otherwise.</p>
        </div>
        <p className="text-xs text-[#8b9cb0]">Demo data is fictional.</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <p className="mt-6 text-center text-sm text-muted">{footer}</p>}
        </div>
      </main>
    </div>
  );
}

function useAfterAuthPath(): string {
  const location = useLocation();
  return (location.state as { from?: string } | null)?.from ?? '/app';
}

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const from = useAfterAuthPath();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (status === 'authenticated') return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell
      title="Sign in"
      subtitle="Use the account you registered with."
      footer={<>New to OpsPilot? <Link to="/register" className="font-medium text-accent hover:underline">Create an account</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError error={error} />
        <TextField label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="text-right text-sm"><Link to="/forgot-password" className="text-accent hover:underline">Forgot your password?</Link></div>
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!email || !password}>Sign in</Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { status, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get('invite') ?? undefined;
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (status === 'authenticated') return <Navigate to="/app" replace />;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const pw = passwordSchema.safeParse(form.password);
    if (!pw.success) return setFieldErrors({ password: pw.error.issues[0]?.message ?? 'Password is too weak' });
    setFieldErrors({});
    setBusy(true);
    try {
      await register({ ...form, email: form.email.trim(), inviteToken });
      navigate('/app', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setFieldErrors(err.fieldErrors);
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell
      title="Create your account"
      subtitle={inviteToken ? 'Register with the email address the invitation was sent to.' : 'You can create or join an organization next.'}
      footer={<>Already registered? <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError error={Object.keys(fieldErrors).length ? null : error} />
        <TextField label="Full name" autoComplete="name" required value={form.name} onChange={set('name')} error={fieldErrors.name} autoFocus />
        <TextField label="Work email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} error={fieldErrors.email} />
        <TextField label="Password" type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} error={fieldErrors.password} hint="At least 10 characters with upper case, lower case and a number." />
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!form.name || !form.email || !form.password}>Create account</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Reset your password" subtitle="We'll email a link that works for one hour." footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}>
      {sent ? (
        <p role="status" className="rounded border border-line bg-surface p-4 text-sm">If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your inbox.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <FormError error={error} />
          <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!email}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const pw = passwordSchema.safeParse(password);
    if (!pw.success) return setFieldError(pw.error.issues[0]?.message);
    setFieldError(undefined);
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Choose a new password">
      {!token ? (
        <p role="alert" className="text-sm text-crit">This reset link is incomplete. <Link className="underline" to="/forgot-password">Request a new one</Link>.</p>
      ) : done ? (
        <p role="status" className="rounded border border-ok/40 bg-ok/10 p-4 text-sm">Password updated. Taking you to sign in…</p>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError error={error} />
          <TextField label="New password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={fieldError} hint="At least 10 characters with upper case, lower case and a number." autoFocus />
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!password}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}

interface InvitePreview {
  email: string;
  role: string;
  organizationName: string;
  invitedBy: string | null;
}

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { status, user, setMemberships } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get<InvitePreview>('/invitations/preview', { token }).then(setPreview, setLoadError);
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ organizationId: string; memberships: Parameters<typeof setMemberships>[0] }>('/invitations/accept', { token });
      setMemberships(res.memberships, res.organizationId);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="You're invited">
      {!token || loadError ? (
        <div role="alert" className="space-y-3 text-sm">
          <p className="text-crit">{!token ? 'This invitation link is incomplete.' : (loadError as Error).message}</p>
          <p className="text-muted">Ask the person who invited you to send a new invitation.</p>
        </div>
      ) : !preview ? (
        <p className="text-sm text-muted" role="status">Checking invitation…</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            {preview.invitedBy ? <strong>{preview.invitedBy}</strong> : 'An administrator'} invited <strong>{preview.email}</strong> to join{' '}
            <strong>{preview.organizationName}</strong> as {preview.role}.
          </p>
          <FormError error={error} />
          {status === 'authenticated' ? (
            user?.email.toLowerCase() === preview.email.toLowerCase() ? (
              <Button variant="primary" className="w-full" loading={busy} onClick={accept}>Join {preview.organizationName}</Button>
            ) : (
              <p role="alert" className="text-sm text-crit">You're signed in as {user?.email}. Sign out and use {preview.email} to accept this invitation.</p>
            )
          ) : (
            <div className="flex flex-col gap-2">
              <ButtonLink to={`/register?invite=${encodeURIComponent(token)}`} variant="primary">Create an account to join</ButtonLink>
              <ButtonLink to="/login" state={{ from: `/accept-invite?token=${encodeURIComponent(token)}` }}>I already have an account</ButtonLink>
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
}
