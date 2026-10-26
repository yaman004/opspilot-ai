import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizationDto, UserDto } from '@opspilot/shared';
import { CATEGORIES } from '@opspilot/shared';
import { api, ApiError } from '../lib/api';
import { useAuth, useOrgId } from '../lib/auth';
import { label } from '../lib/format';
import { useTheme, useToast } from '../lib/ui-state';
import { Button, ConfirmDialog, ErrorState, FormError, PageHeader, SelectField, Skeleton, TextField, errorMessage } from '../components/ui';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5" aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const timezones = (): string[] => {
  try { return (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { return ['UTC']; }
};

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto max-w-3xl space-y-5">
        <ProfileSection />
        <SecuritySection />
        <OrgSection />
      </div>
    </>
  );
}

function ProfileSection() {
  const { user, setUser } = useAuth();
  const theme = useTheme();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [tz, setTz] = useState(user?.timezone ?? 'UTC');
  const save = useMutation({
    mutationFn: (body: Partial<Pick<UserDto, 'name' | 'timezone' | 'themePreference'>>) => api.patch<{ user: UserDto }>('/auth/me', body),
    onSuccess: (r) => { setUser(r.user); toast.success('Profile saved'); },
  });
  const fe = save.error instanceof ApiError ? save.error.fieldErrors : undefined;
  const zones = timezones();
  return (
    <Section title="Profile and appearance">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate({ name, timezone: tz }); }} className="space-y-4" noValidate>
        <TextField label="Email" value={user?.email ?? ''} readOnly disabled hint="Your email is your sign-in and can't be changed here." />
        <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={fe?.name} />
        <SelectField label="Time zone" value={tz} onChange={(e) => setTz(e.target.value)} options={(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => ({ value: z, label: z }))} />
        <SelectField
          label="Theme"
          value={theme.pref}
          onChange={(e) => { const v = e.target.value as 'light' | 'dark' | 'system'; theme.setPref(v); save.mutate({ themePreference: v }); }}
          options={[{ value: 'system', label: 'Match my system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
        />
        <FormError error={save.error} />
        <Button type="submit" variant="primary" loading={save.isPending} disabled={name.trim() === user?.name && tz === user?.timezone}>Save profile</Button>
      </form>
    </Section>
  );
}

function SecuritySection() {
  const { logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState('');
  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => { toast.success('Password changed. Other devices were signed out.'); setCurrent(''); setNext(''); setConfirm(''); },
  });
  const all = useMutation({
    mutationFn: () => api.post('/auth/logout-all'),
    onSuccess: async () => { await logout().catch(() => undefined); nav('/login', { replace: true }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const fe = change.error instanceof ApiError ? change.error.fieldErrors : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setMismatch('Passwords do not match');
    setMismatch('');
    change.mutate();
  };
  return (
    <Section title="Security">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={fe?.currentPassword} />
        <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={fe?.newPassword} hint="At least 10 characters with a mix of letters and numbers." />
        <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch} />
        <FormError error={change.error && !fe ? change.error : null} />
        <Button type="submit" variant="primary" loading={change.isPending} disabled={!current || !next}>Change password</Button>
      </form>
      <hr className="my-5 border-line" />
      <p className="text-sm text-muted">Sign out of every device where you're signed in, including this one.</p>
      <Button className="mt-3" onClick={() => all.mutate()} loading={all.isPending}>Sign out everywhere</Button>
    </Section>
  );
}

function OrgSection() {
  const orgId = useOrgId();
  const { can, currentMembership, memberships, setMemberships, switchOrg } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const canEdit = can('org:update');
  const canDelete = can('org:delete');
  const q = useQuery({ queryKey: ['org', orgId, 'self'], queryFn: async () => (await api.get<{ organization: OrganizationDto }>(`/orgs/${orgId}`)).organization });
  const [name, setName] = useState('');
  const [tz, setTz] = useState('UTC');
  const [domains, setDomains] = useState('');
  const [category, setCategory] = useState('');
  useEffect(() => {
    if (!q.data) return;
    setName(q.data.name); setTz(q.data.timezone); setDomains(q.data.settings.allowedEmailDomains.join(', ')); setCategory(q.data.settings.defaultIncidentCategory ?? '');
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => api.patch<{ organization: OrganizationDto }>(`/orgs/${orgId}`, {
      name, timezone: tz,
      settings: { allowedEmailDomains: domains.split(',').map((d) => d.trim()).filter(Boolean), ...(category ? { defaultIncidentCategory: category } : {}) },
    }),
    onSuccess: (r) => {
      toast.success('Organization saved');
      setMemberships(memberships.map((m) => (m.organization.id === orgId ? { ...m, organization: r.organization } : m)));
      void qc.invalidateQueries({ queryKey: ['org', orgId, 'self'] });
    },
  });

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const leaveOrDeleteDone = () => {
    const rest = memberships.filter((m) => m.organization.id !== orgId);
    qc.removeQueries({ predicate: (x) => x.queryKey[0] === 'org' });
    setMemberships(rest);
    if (rest[0]) { switchOrg(rest[0].organization.id); nav('/app', { replace: true }); } else nav('/onboarding', { replace: true });
  };
  const leave = useMutation({
    mutationFn: () => api.post(`/orgs/${orgId}/leave`),
    onSuccess: leaveOrDeleteDone,
    onError: (e) => { toast.error(errorMessage(e)); setLeaveOpen(false); },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/orgs/${orgId}`, { confirmName }),
    onSuccess: leaveOrDeleteDone,
  });

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <div className="panel"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const fe = save.error instanceof ApiError ? save.error.fieldErrors : undefined;
  const zones = timezones();

  return (
    <>
      <Section title="Organization" description={canEdit ? undefined : 'Only owners and admins can change these settings.'}>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4" noValidate>
          <fieldset disabled={!canEdit} className="space-y-4">
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={fe?.name} />
            <TextField label="Workspace URL name" value={q.data.slug} readOnly disabled />
            <SelectField label="Time zone" value={tz} onChange={(e) => setTz(e.target.value)} options={(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => ({ value: z, label: z }))} />
            <TextField label="Allowed invitation email domains" value={domains} onChange={(e) => setDomains(e.target.value)} hint="Comma separated, e.g. northwind.example. Leave empty to allow any domain." />
            <SelectField label="Default incident category" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: '', label: 'No default' }, ...CATEGORIES.map((c) => ({ value: c, label: label(c) }))]} />
          </fieldset>
          <FormError error={save.error} />
          {canEdit && <Button type="submit" variant="primary" loading={save.isPending}>Save organization</Button>}
        </form>
      </Section>

      <section className="rounded-lg border border-crit/40 p-5" aria-label="Danger zone">
        <h2 className="text-base font-semibold text-crit">Danger zone</h2>
        {currentMembership?.role !== 'owner' && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Leave this organization. You'll lose access to its incidents.</p>
            <Button variant="danger" onClick={() => setLeaveOpen(true)}>Leave organization</Button>
          </div>
        )}
        {canDelete && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Permanently delete this organization with all incidents, comments, attachments and audit history. This can't be undone.</p>
            <Button variant="danger" onClick={() => { setConfirmName(''); setDelOpen(true); }}>Delete organization</Button>
          </div>
        )}
        {currentMembership?.role === 'owner' && !canDelete && null}
      </section>

      <ConfirmDialog open={leaveOpen} title="Leave organization" body={<>Leave <strong>{q.data.name}</strong>?</>} confirmLabel="Leave" loading={leave.isPending} onClose={() => setLeaveOpen(false)} onConfirm={() => leave.mutate()} />
      {delOpen && (
        <ConfirmDialog
          open
          title="Delete organization"
          loading={del.isPending}
          confirmLabel="Delete forever"
          onClose={() => setDelOpen(false)}
          onConfirm={() => confirmName === q.data!.name && del.mutate()}
          body={
            <div className="space-y-3">
              <p>This permanently deletes <strong>{q.data.name}</strong> and everything in it. Type the organization name to confirm.</p>
              <TextField label="Organization name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoFocus />
              <FormError error={del.error} />
              {confirmName !== q.data.name && confirmName.length > 0 && <p className="text-xs text-muted">The name must match exactly.</p>}
            </div>
          }
        />
      )}
    </>
  );
}
