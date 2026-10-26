import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, addMember, api, auth, createIncident, createOrg, registerUser, setupDb, teardownDb, type TestUser } from './helpers';
import { Incident, Invitation, Membership } from '../src/models';
import { emitted } from '../src/services/realtime';

let owner: TestUser, admin: TestUser, agent: TestUser, viewer: TestUser;
let orgId: string;
const base = () => `/api/orgs/${orgId}`;
const membershipOf = async (u: TestUser) => String((await Membership.findOne({ userId: u.id, organizationId: orgId }))!._id);

beforeAll(async () => {
  await setupDb('members');
  owner = await registerUser('Owner');
  orgId = await createOrg(owner);
  admin = await addMember(owner, orgId, 'admin');
  agent = await addMember(owner, orgId, 'agent');
  viewer = await addMember(owner, orgId, 'viewer');
});
afterAll(teardownDb);

describe('invitations', () => {
  it('only admins+ can invite, admins cannot mint admins, and nobody can invite an owner', async () => {
    const inv = (u: TestUser, role: string, email = `x${Math.random().toString(36).slice(2)}@example.com`) =>
      api().post(`${base()}/invitations`).set(auth(u)).send({ email, role });
    expect((await inv(agent, 'viewer')).status).toBe(403);
    expect((await inv(admin, 'agent')).status).toBe(201);
    expect((await inv(admin, 'admin')).status).toBe(403);
    expect((await inv(owner, 'admin')).status).toBe(201);
    expect((await inv(owner, 'owner')).status).toBe(422);
  });

  it('binds the token to the invited email and can be redeemed only once', async () => {
    const email = 'invitee@example.com';
    const created = await api().post(`${base()}/invitations`).set(auth(admin)).send({ email, role: 'agent' });
    const token = new URL(created.body.invitation.devAcceptUrl).searchParams.get('token')!;
    expect((await Invitation.findOne({}).lean())).toBeTruthy();
    expect(JSON.stringify(await Invitation.find({}).lean())).not.toContain(token); // only the hash is stored

    const preview = await api().get(`/api/invitations/preview?token=${token}`);
    expect(preview.body).toMatchObject({ email, role: 'agent', organizationName: 'Acme Ops' });

    const wrong = await registerUser('Wrong');
    const mismatch = await api().post('/api/invitations/accept').set(auth(wrong)).send({ token });
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');

    const reg = await api().post('/api/auth/register').send({ name: 'Invitee', email, password: PASSWORD, inviteToken: token });
    expect(reg.status).toBe(201);
    expect(reg.body.memberships.find((m: any) => m.organization.id === orgId).role).toBe('agent');
    const again = await api().post('/api/auth/register').send({ name: 'Again', email: 'again@example.com', password: PASSWORD, inviteToken: token });
    expect(again.status).toBe(400);
    expect(await api().get('/api/auth/me').set('Authorization', `Bearer ${reg.body.accessToken}`).then((r) => r.status)).toBe(200);
  });

  it('does not leave an account behind when registration with a bad invite fails', async () => {
    const res = await api().post('/api/auth/register').send({ name: 'Nope', email: 'ghost-invite@example.com', password: PASSWORD, inviteToken: 'x'.repeat(40) });
    expect(res.status).toBe(400);
    const retry = await api().post('/api/auth/register').send({ name: 'Nope', email: 'ghost-invite@example.com', password: PASSWORD });
    expect(retry.status).toBe(201);
  });

  it('rejects expired and revoked invitations', async () => {
    const mk = async (email: string) => {
      const c = await api().post(`${base()}/invitations`).set(auth(admin)).send({ email, role: 'viewer' });
      return { id: c.body.invitation.id as string, token: new URL(c.body.invitation.devAcceptUrl).searchParams.get('token')! };
    };
    const expired = await mk('expired@example.com');
    await Invitation.updateOne({ _id: expired.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api().get(`/api/invitations/preview?token=${expired.token}`)).body.error.code).toBe('INVITATION_EXPIRED');

    const revoked = await mk('revoked@example.com');
    expect((await api().delete(`${base()}/invitations/${revoked.id}`).set(auth(admin))).status).toBe(204);
    expect((await api().get(`/api/invitations/preview?token=${revoked.token}`)).status).toBe(400);
  });

  it('enforces the organization email-domain allow-list', async () => {
    const o = await registerUser('Dom');
    const org = await createOrg(o, 'Domain Co');
    await api().patch(`/api/orgs/${org}`).set(auth(o)).send({ settings: { allowedEmailDomains: ['corp.test'] } });
    const bad = await api().post(`/api/orgs/${org}/invitations`).set(auth(o)).send({ email: 'x@gmail.com', role: 'viewer' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    expect((await api().post(`/api/orgs/${org}/invitations`).set(auth(o)).send({ email: 'x@corp.test', role: 'viewer' })).status).toBe(201);
  });
});

describe('membership management', () => {
  it('applies the role hierarchy to role changes', async () => {
    const agentM = await membershipOf(agent);
    const adminM = await membershipOf(admin);
    const ownerM = await membershipOf(owner);
    const change = (u: TestUser, m: string, role: string) => api().patch(`${base()}/members/${m}`).set(auth(u)).send({ role });

    expect((await change(agent, agentM, 'viewer')).status).toBe(403); // agents cannot manage roles
    expect((await change(admin, agentM, 'admin')).status).toBe(403); // admin cannot promote to admin
    expect((await change(admin, adminM, 'viewer')).status).toBe(403); // nor change their own role
    expect((await change(admin, ownerM, 'viewer')).status).toBe(403); // nor touch the owner
    expect((await change(owner, ownerM, 'admin')).status).toBe(403); // owner cannot change own role either
    expect((await change(admin, agentM, 'viewer')).status).toBe(200);
    expect((await change(owner, agentM, 'agent')).status).toBe(200);
  });

  it('keeps at least one owner', async () => {
    const solo = await registerUser('Solo');
    const org = await createOrg(solo, 'Solo Co');
    const m = String((await Membership.findOne({ userId: solo.id, organizationId: org }))!._id);
    const leave = await api().post(`/api/orgs/${org}/leave`).set(auth(solo));
    expect(leave.status).toBe(409);
    expect(leave.body.error.code).toBe('LAST_OWNER');
    expect(m).toBeTruthy();
  });

  it('removing a member revokes access immediately, releases their open incidents and evicts sockets', async () => {
    const temp = await addMember(owner, orgId, 'agent', 'temp');
    const inc = await createIncident(owner, orgId, { title: 'Held by temp', assigneeId: temp.id });
    expect((await api().get(`${base()}/incidents`).set(auth(temp))).status).toBe(200);
    emitted.length = 0;

    const res = await api().delete(`${base()}/members/${await membershipOf(temp)}`).set(auth(admin));
    expect(res.status).toBe(204);
    expect((await api().get(`${base()}/incidents`).set(auth(temp))).status).toBe(404);
    expect((await Incident.findById(inc.id))?.assigneeId).toBeNull();
    expect(emitted.some((e) => e.event === 'evict')).toBe(true);
  });

  it('admins cannot remove admins or owners; anyone can leave', async () => {
    const admin2 = await addMember(owner, orgId, 'admin', 'admin2');
    expect((await api().delete(`${base()}/members/${await membershipOf(admin2)}`).set(auth(admin))).status).toBe(403);
    expect((await api().delete(`${base()}/members/${await membershipOf(owner)}`).set(auth(admin))).status).toBe(403);
    expect((await api().post(`${base()}/leave`).set(auth(admin2))).status).toBe(204);
  });

  it('demoting to viewer evicts the staff room', async () => {
    const a = await addMember(owner, orgId, 'agent', 'demote');
    emitted.length = 0;
    await api().patch(`${base()}/members/${await membershipOf(a)}`).set(auth(owner)).send({ role: 'viewer' });
    const evict = emitted.find((e) => e.event === 'evict');
    expect(evict?.payload).toMatchObject({ orgId, staffOnly: true });
  });
});

describe('teams', () => {
  it('admins manage teams; members must belong to the org; duplicates are rejected', async () => {
    const created = await api().post(`${base()}/teams`).set(auth(admin)).send({ name: 'Platform', description: 'Infra' });
    expect(created.status).toBe(201);
    const teamId = created.body.team.id;
    expect((await api().post(`${base()}/teams`).set(auth(admin)).send({ name: 'Platform' })).status).toBe(409);
    expect((await api().post(`${base()}/teams`).set(auth(agent)).send({ name: 'Nope' })).status).toBe(403);

    const added = await api().post(`${base()}/teams/${teamId}/members`).set(auth(admin)).send({ userId: agent.id });
    expect(added.body.team.memberIds).toContain(agent.id);
    const stranger = await registerUser('Stranger');
    expect((await api().post(`${base()}/teams/${teamId}/members`).set(auth(admin)).send({ userId: stranger.id })).status).toBe(404);

    const inc = await createIncident(agent, orgId, { teamId });
    expect((await api().get(`${base()}/incidents?teamId=${teamId}`).set(auth(viewer))).body.total).toBe(1);
    const removed = await api().delete(`${base()}/teams/${teamId}/members/${agent.id}`).set(auth(admin));
    expect(removed.body.team.memberIds).not.toContain(agent.id);
    expect((await api().delete(`${base()}/teams/${teamId}`).set(auth(admin))).status).toBe(204);
    expect((await api().get(`${base()}/incidents/${inc.id}`).set(auth(viewer))).body.incident.team).toBeNull();
  });
});

describe('SLA policy admin', () => {
  it('only admins edit; invalid policies are rejected; changes apply to new incidents', async () => {
    const current = (await api().get(`${base()}/sla-policy`).set(auth(viewer))).body.policy;
    const edited = structuredClone(current);
    edited.targets.low.responseMinutes = 30;
    edited.targets.low.resolutionMinutes = 120;
    expect((await api().put(`${base()}/sla-policy`).set(auth(agent)).send(edited)).status).toBe(403);
    const bad = structuredClone(edited);
    bad.targets.low.resolutionMinutes = 5;
    expect((await api().put(`${base()}/sla-policy`).set(auth(admin)).send(bad)).status).toBe(422);
    expect((await api().put(`${base()}/sla-policy`).set(auth(admin)).send(edited)).status).toBe(200);
    const inc = await createIncident(agent, orgId, { severity: 'low' });
    const created = new Date((await api().get(`${base()}/incidents/${inc.id}`).set(auth(agent))).body.incident.createdAt).getTime();
    expect(new Date(inc.sla.resolutionDueAt).getTime() - created).toBe(120 * 60_000);
  });
});
