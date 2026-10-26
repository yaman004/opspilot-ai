import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { MembershipDto, OrganizationDto } from '@opspilot/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, FormError, TextField } from '../components/ui';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function OnboardingPage() {
  const { status, user, memberships, setMemberships, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return null;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: '/onboarding' }} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await api.post<{ organization: OrganizationDto; memberships: MembershipDto[] }>('/orgs', { name: name.trim(), ...(slug ? { slug } : {}) });
      setMemberships(res.memberships, res.organization.id);
      navigate('/app', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setFieldErrors(err.fieldErrors);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">{memberships.length ? 'Create another organization' : `Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}`}</h1>
        <p className="mt-1 text-sm text-muted">
          An organization holds your incidents, teams and SLA policy. You'll be its owner, and can invite people once it exists.
        </p>
        <form onSubmit={submit} className="panel mt-6 space-y-4 p-5" noValidate>
          <FormError error={Object.keys(fieldErrors).length ? null : error} />
          <TextField
            label="Organization name"
            required
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            error={fieldErrors.name}
            placeholder="Acme Operations"
          />
          <TextField
            label="URL name"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            error={fieldErrors.slug}
            hint="Letters, numbers and dashes. Generated from the name if left empty."
          />
          <div className="flex items-center justify-between gap-3 pt-1">
            {memberships.length ? <Link to="/app" className="text-sm text-muted hover:text-ink">Cancel</Link> : <button type="button" onClick={() => void logout().then(() => navigate('/login'))} className="text-sm text-muted hover:text-ink">Sign out</button>}
            <Button type="submit" variant="primary" loading={busy} disabled={name.trim().length < 2}>Create organization</Button>
          </div>
        </form>
        <p className="mt-4 text-sm text-muted">Waiting for an invitation instead? Open the link from the invitation email and you'll join that organization.</p>
      </div>
    </div>
  );
}
