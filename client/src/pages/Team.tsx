import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Mail, Plus, Trash2, UserMinus } from 'lucide-react';
import { ROLES, canAssignRole, canRemoveMember, type InvitationDto, type MemberDto, type Role, type TeamDto } from '@opspilot/shared';
import { api, ApiError } from '../lib/api';
import { useAuth, useOrgId } from '../lib/auth';
import { fmtDate, fmtRelative, label } from '../lib/format';
import { useMembers, useTeams } from '../lib/queries';
import { useToast } from '../lib/ui-state';
import {
  Avatar, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, FormError, PageHeader, SelectField, SkeletonRows, Tabs, TextArea, TextField, errorMessage,
} from '../components/ui';

type Tab = 'members' | 'teams' | 'invitations';

export function TeamPage() {
  const { can, role } = useAuth();
  const [tab, setTab] = useState<Tab>('members');
  const tabs: Array<{ value: Tab; label: string }> = [{ value: 'members', label: 'Members' }, { value: 'teams', label: 'Teams' }];
  if (can('member:invite')) tabs.push({ value: 'invitations', label: 'Invitations' });
  return (
    <>
      <PageHeader title="Team" subtitle={`You are ${role ? label(role).toLowerCase() : 'a member'} in this organization.`} />
      <div className="panel overflow-hidden">
        <div className="px-4 pt-2"><Tabs value={tab} onChange={setTab} tabs={tabs} /></div>
        {tab === 'members' && <MembersTab />}
        {tab === 'teams' && <TeamsTab />}
        {tab === 'invitations' && can('member:invite') && <InvitationsTab />}
      </div>
    </>
  );
}

/* ------------------------------ members ------------------------------ */
function MembersTab() {
  const orgId = useOrgId();
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useMembers();
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['org', orgId] });

  const setRole = useMutation({
    mutationFn: (v: { id: string; role: Role }) => api.patch(`/orgs/${orgId}/members/${v.id}`, { role: v.role }),
    onSuccess: () => { toast.success('Role updated'); void refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${orgId}/members/${id}`),
    onSuccess: () => { toast.success('Member removed'); setRemoving(null); void refresh(); },
    onError: (e) => { toast.error(errorMessage(e)); setRemoving(null); },
  });

  if (q.isLoading) return <SkeletonRows rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead><tr className="border-b border-line bg-sunken/50"><th className="th">Member</th><th className="th">Role</th><th className="th">Joined</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {(q.data ?? []).map((m) => {
              const isSelf = m.user.id === user?.id;
              const roleOptions = role ? ROLES.filter((r) => r === m.role || canAssignRole(role, m.role, r, isSelf)) : [m.role];
              const editable = role ? !isSelf && roleOptions.length > 1 : false;
              return (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.user.name} />
                      <div className="min-w-0"><p className="font-medium">{m.user.name}{isSelf && <span className="ml-1.5 text-xs text-muted">(you)</span>}</p><p className="truncate text-xs text-muted">{m.user.email}</p></div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {editable ? (
                      <select aria-label={`Role for ${m.user.name}`} className="input w-auto py-1 text-sm" value={m.role} disabled={setRole.isPending} onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as Role })}>
                        {roleOptions.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                      </select>
                    ) : label(m.role)}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{fmtDate(m.createdAt)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {role && !isSelf && canRemoveMember(role, m.role) && (
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(m)} aria-label={`Remove ${m.user.name}`}><UserMinus size={14} aria-hidden /> Remove</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!removing}
        title="Remove member"
        body={<>Remove <strong>{removing?.user.name}</strong> from this organization? They lose access immediately, and their open incidents become unassigned.</>}
        confirmLabel="Remove member"
        loading={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </>
  );
}

/* ------------------------------- teams ------------------------------- */
function TeamsTab() {
  const orgId = useOrgId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const teams = useTeams();
  const members = useMembers();
  const [editing, setEditing] = useState<TeamDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<TeamDto | null>(null);
  const manage = can('team:manage');
  const refresh = () => qc.invalidateQueries({ queryKey: ['org', orgId] });

  const addMember = useMutation({
    mutationFn: (v: { teamId: string; userId: string }) => api.post(`/orgs/${orgId}/teams/${v.teamId}/members`, { userId: v.userId }),
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeMember = useMutation({
    mutationFn: (v: { teamId: string; userId: string }) => api.del(`/orgs/${orgId}/teams/${v.teamId}/members/${v.userId}`),
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${orgId}/teams/${id}`),
    onSuccess: () => { toast.success('Team deleted'); setDeleting(null); void refresh(); },
    onError: (e) => { toast.error(errorMessage(e)); setDeleting(null); },
  });

  if (teams.isLoading) return <SkeletonRows rows={4} />;
  if (teams.isError) return <ErrorState error={teams.error} onRetry={() => teams.refetch()} />;
  const byId = new Map((members.data ?? []).map((m) => [m.user.id, m]));

  return (
    <div className="p-4">
      {manage && <div className="mb-4 flex justify-end"><Button variant="primary" onClick={() => setEditing('new')}><Plus size={15} aria-hidden /> New team</Button></div>}
      {!teams.data?.length ? (
        <EmptyState title="No teams yet" body="Teams route incidents and scope workload. Create one to get started." action={manage ? <Button variant="primary" onClick={() => setEditing('new')}>Create a team</Button> : undefined} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.data.map((t) => {
            const candidates = (members.data ?? []).filter((m) => !t.memberIds.includes(m.user.id) && m.role !== 'viewer');
            return (
              <article key={t.id} className="rounded-lg border border-line p-4" aria-label={t.name}>
                <header className="flex items-start justify-between gap-2">
                  <div><h3 className="font-semibold">{t.name}</h3>{t.description && <p className="mt-0.5 text-sm text-muted">{t.description}</p>}</div>
                  {manage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}><Trash2 size={14} aria-hidden /></Button>
                    </div>
                  )}
                </header>
                <ul className="mt-3 space-y-1.5">
                  {t.memberIds.length === 0 && <li className="text-sm text-muted">No members yet.</li>}
                  {t.memberIds.map((uid) => {
                    const m = byId.get(uid);
                    return (
                      <li key={uid} className="flex items-center gap-2 text-sm">
                        <Avatar name={m?.user.name ?? '?'} size={22} />
                        <span className="flex-1">{m?.user.name ?? 'Former member'}</span>
                        {manage && <Button size="sm" variant="ghost" aria-label={`Remove ${m?.user.name ?? 'member'} from ${t.name}`} onClick={() => removeMember.mutate({ teamId: t.id, userId: uid })}>Remove</Button>}
                      </li>
                    );
                  })}
                </ul>
                {manage && candidates.length > 0 && (
                  <select aria-label={`Add member to ${t.name}`} className="input mt-3 py-1.5 text-sm" value="" onChange={(e) => e.target.value && addMember.mutate({ teamId: t.id, userId: e.target.value })}>
                    <option value="">Add a member…</option>
                    {candidates.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}
                  </select>
                )}
              </article>
            );
          })}
        </div>
      )}
      {editing && <TeamDialog team={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} title="Delete team" body={<>Delete <strong>{deleting?.name}</strong>? Incidents assigned to this team keep their history but lose the team.</>} confirmLabel="Delete team" loading={del.isPending} onClose={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting.id)} />
    </div>
  );
}

function TeamDialog({ team, onClose }: { team: TeamDto | null; onClose: () => void }) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description };
      return team ? api.patch(`/orgs/${orgId}/teams/${team.id}`, body) : api.post(`/orgs/${orgId}/teams`, body);
    },
    onSuccess: () => { toast.success(team ? 'Team updated' : 'Team created'); void qc.invalidateQueries({ queryKey: ['org', orgId] }); onClose(); },
  });
  const fe = save.error instanceof ApiError ? save.error.fieldErrors : undefined;
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  return (
    <Dialog open title={team ? 'Edit team' : 'New team'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={fe?.name} autoFocus />
        <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} error={fe?.description} />
        <FormError error={save.error} />
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={save.isPending}>{team ? 'Save' : 'Create team'}</Button></div>
      </form>
    </Dialog>
  );
}

/* ---------------------------- invitations ---------------------------- */
function InvitationsTab() {
  const orgId = useOrgId();
  const { role } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('agent');
  const [created, setCreated] = useState<InvitationDto | null>(null);
  const q = useQuery({
    queryKey: ['org', orgId, 'invitations'],
    queryFn: async () => (await api.get<{ invitations: InvitationDto[] }>(`/orgs/${orgId}/invitations`)).invitations,
  });
  const invite = useMutation({
    mutationFn: () => api.post<{ invitation: InvitationDto }>(`/orgs/${orgId}/invitations`, { email, role: inviteRole }),
    onSuccess: (r) => { setCreated(r.invitation); setEmail(''); void qc.invalidateQueries({ queryKey: ['org', orgId, 'invitations'] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${orgId}/invitations/${id}`),
    onSuccess: () => { toast.success('Invitation revoked'); void qc.invalidateQueries({ queryKey: ['org', orgId, 'invitations'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const fe = invite.error instanceof ApiError ? invite.error.fieldErrors : undefined;
  const roles: Role[] = role === 'owner' ? ['admin', 'agent', 'viewer'] : ['agent', 'viewer'];

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Link copied'); } catch { toast.error('Copy failed — select the link and copy it manually'); }
  };

  return (
    <div className="p-4">
      <form onSubmit={(e) => { e.preventDefault(); setCreated(null); invite.mutate(); }} className="flex flex-wrap items-end gap-3" noValidate>
        <div className="min-w-[14rem] flex-1"><TextField label="Email address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fe?.email} /></div>
        <div className="w-40"><SelectField label="Role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} options={roles.map((r) => ({ value: r, label: label(r) }))} error={fe?.role} /></div>
        <Button type="submit" variant="primary" loading={invite.isPending} disabled={!email}><Mail size={15} aria-hidden /> Send invitation</Button>
      </form>
      <div className="mt-3"><FormError error={invite.error} /></div>

      {created && (
        <div role="status" className="mt-3 rounded border border-line bg-sunken/50 p-3 text-sm">
          <p className="font-medium">Invitation created for {created.email}.</p>
          {created.devAcceptUrl ? (
            <>
              <p className="mt-1 text-muted">Email isn't configured in this environment, so nothing was sent. Share this development-only link with the invitee:</p>
              <div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-surface p-2 text-xs">{created.devAcceptUrl}</code><Button size="sm" onClick={() => copy(created.devAcceptUrl!)}><Copy size={14} aria-hidden /> Copy</Button></div>
            </>
          ) : <p className="mt-1 text-muted">They will receive an email with a link to join.</p>}
        </div>
      )}

      <h3 className="mb-2 mt-6 text-sm font-semibold">Pending and past invitations</h3>
      {q.isLoading ? <SkeletonRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <p className="text-sm text-muted">No invitations yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded border border-line">
          {q.data.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1 basis-48 truncate">{i.email}</span>
              <span className="text-muted">{label(i.role)}</span>
              <span className="rounded bg-sunken px-2 py-0.5 text-xs">{label(i.status)}</span>
              <span className="text-xs text-muted">{i.status === 'pending' ? `expires ${fmtRelative(i.expiresAt)}` : fmtDate(i.createdAt)}</span>
              {i.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)} aria-label={`Revoke invitation for ${i.email}`}>Revoke</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
