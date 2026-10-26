import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, auth, createIncident, createOrg, registerUser, setupDb, teardownDb, type TestUser } from './helpers';
import { Membership, Notification, Team } from '../src/models';

let alice: TestUser, bob: TestUser; // two unrelated organizations
let orgA: string, orgB: string;
let incA: { id: string };
let teamA: string;

beforeAll(async () => {
  await setupDb('isolation');
  alice = await registerUser('Alice');
  bob = await registerUser('Bob');
  orgA = await createOrg(alice, 'Alpha Corp');
  orgB = await createOrg(bob, 'Beta Corp');
  incA = await createIncident(alice, orgA, { title: 'Alpha secret incident' });
  teamA = (await api().post(`/api/orgs/${orgA}/teams`).set(auth(alice)).send({ name: 'Alpha Team' })).body.team.id;
});
afterAll(teardownDb);

describe('cross-organization data isolation', () => {
  it('returns 404 (not 403) for every org-scoped route of an org you do not belong to', async () => {
    const paths = ['', '/incidents', '/members', '/teams', '/sla-policy', '/analytics/overview', '/audit-logs', '/notifications', '/search?q=alpha', '/ai/status'];
    for (const p of paths) {
      const res = await api().get(`/api/orgs/${orgA}${p}`).set(auth(bob));
      expect(res.status, p).toBe(404);
    }
    expect((await api().post(`/api/orgs/${orgA}/incidents`).set(auth(bob)).send({ title: 'abc', description: 'd', category: 'other', severity: 'low' })).status).toBe(404);
    expect((await api().delete(`/api/orgs/${orgA}`).set(auth(bob)).send({ confirmName: 'Alpha Corp' })).status).toBe(404);
  });

  it('cannot read or touch an incident by id through another organization', async () => {
    const id = incA.id;
    // Bob is a legitimate owner of org B, but uses org B's URL with org A's incident id.
    expect((await api().get(`/api/orgs/${orgB}/incidents/${id}`).set(auth(bob))).status).toBe(404);
    expect((await api().patch(`/api/orgs/${orgB}/incidents/${id}`).set(auth(bob)).send({ title: 'pwned title' })).status).toBe(404);
    expect((await api().post(`/api/orgs/${orgB}/incidents/${id}/transition`).set(auth(bob)).send({ status: 'triaged' })).status).toBe(404);
    expect((await api().post(`/api/orgs/${orgB}/incidents/${id}/assign`).set(auth(bob)).send({ assigneeId: bob.id })).status).toBe(404);
    expect((await api().post(`/api/orgs/${orgB}/incidents/${id}/comments`).set(auth(bob)).send({ body: 'hi' })).status).toBe(404);
    expect((await api().get(`/api/orgs/${orgB}/incidents/${id}/activity`).set(auth(bob))).status).toBe(404);
    expect((await api().get(`/api/orgs/${orgB}/incidents/${id}/related`).set(auth(bob))).status).toBe(404);
    expect((await api().post(`/api/orgs/${orgB}/ai/triage`).set(auth(bob)).send({ title: 'abc', description: 'long enough description here', incidentId: id })).status).toBe(404);
    const stillOk = await api().get(`/api/orgs/${orgA}/incidents/${id}`).set(auth(alice));
    expect(stillOk.body.incident.title).toBe('Alpha secret incident');
  });

  it("lists, searches, exports and counts only the caller's own organization", async () => {
    const list = await api().get(`/api/orgs/${orgB}/incidents`).set(auth(bob));
    expect(list.body.total).toBe(0);
    const search = await api().get(`/api/orgs/${orgB}/search?q=alpha`).set(auth(bob));
    expect(search.body.incidents).toEqual([]);
    expect(search.body.teams).toEqual([]);
    const csv = await api().get(`/api/orgs/${orgB}/incidents/export.csv`).set(auth(bob));
    expect(csv.text).not.toContain('Alpha');
    const stats = await api().get(`/api/orgs/${orgB}/analytics/overview`).set(auth(bob));
    expect(stats.body.kpis.openIncidents).toBe(0);
    expect(stats.body.kpis.totalInRange).toBe(0);
  });

  it('refuses client-supplied ids that belong to another organization', async () => {
    const mk = (extra: object) =>
      api().post(`/api/orgs/${orgB}/incidents`).set(auth(bob)).send({ title: 'abc', description: 'd', category: 'other', severity: 'low', ...extra });
    expect((await mk({ teamId: teamA })).status).toBe(400); // foreign team
    expect((await mk({ assigneeId: alice.id })).status).toBe(400); // user of another org
    const addForeign = await api().post(`/api/orgs/${orgB}/teams`).set(auth(bob)).send({ name: 'Beta Team' });
    const addMember = await api().post(`/api/orgs/${orgB}/teams/${addForeign.body.team.id}/members`).set(auth(bob)).send({ userId: alice.id });
    expect(addMember.status).toBe(404);
    expect((await api().patch(`/api/orgs/${orgB}/teams/${teamA}`).set(auth(bob)).send({ name: 'Hijacked' })).status).toBe(404);
    expect((await Team.findById(teamA))?.name).toBe('Alpha Team');
    const aliceMembership = await Membership.findOne({ userId: alice.id, organizationId: orgA });
    expect((await api().patch(`/api/orgs/${orgB}/members/${aliceMembership!._id}`).set(auth(bob)).send({ role: 'viewer' })).status).toBe(404);
    expect((await api().delete(`/api/orgs/${orgB}/members/${aliceMembership!._id}`).set(auth(bob))).status).toBe(404);
    expect((await Membership.findById(aliceMembership!._id))?.role).toBe('owner');
  });

  it('does not let a membership in one org grant a role in another (role comes from the DB)', async () => {
    const viewerInA = await addMember(alice, orgA, 'viewer');
    // viewerInA creates their own org (owner there) — still only a viewer in org A
    await createOrg(viewerInA, 'Viewer Own Org');
    const res = await api().post(`/api/orgs/${orgA}/incidents`).set(auth(viewerInA)).send({ title: 'abc', description: 'd', category: 'other', severity: 'low' });
    expect(res.status).toBe(403);
    const spoof = await api()
      .post(`/api/orgs/${orgA}/incidents`)
      .set(auth(viewerInA))
      .set('X-Org-Role', 'owner')
      .send({ title: 'abc', description: 'd', category: 'other', severity: 'low', role: 'owner', organizationId: orgB });
    expect(spoof.status).toBe(403);
  });

  it('keeps notifications private to their recipient and organization', async () => {
    const agentA = await addMember(alice, orgA, 'agent');
    const inc = await createIncident(alice, orgA, { title: 'Assigned to agentA' });
    await api().post(`/api/orgs/${orgA}/incidents/${inc.id}/assign`).set(auth(alice)).send({ assigneeId: agentA.id });
    const mine = await api().get(`/api/orgs/${orgA}/notifications`).set(auth(agentA));
    expect(mine.body.items.length).toBeGreaterThan(0);
    const note = mine.body.items[0];

    // owner (different user, same org) sees nothing of agentA's and cannot mark it read
    expect((await api().patch(`/api/orgs/${orgA}/notifications/${note.id}/read`).set(auth(alice))).status).toBe(404);
    // someone from another org cannot either
    expect((await api().patch(`/api/orgs/${orgB}/notifications/${note.id}/read`).set(auth(bob))).status).toBe(404);
    expect((await Notification.findById(note.id))?.readAt).toBeNull();
    expect((await api().patch(`/api/orgs/${orgA}/notifications/${note.id}/read`).set(auth(agentA))).body.notification.readAt).toBeTruthy();

    const other = await api().get(`/api/orgs/${orgB}/notifications`).set(auth(bob));
    expect(other.body.items).toEqual([]);
  });

  it('rejects malformed ids without leaking details', async () => {
    expect((await api().get(`/api/orgs/not-an-id/incidents`).set(auth(alice))).status).toBe(404);
    expect((await api().get(`/api/orgs/${orgA}/incidents/%7B%24ne%3Anull%7D`).set(auth(alice))).status).toBe(404);
    expect((await api().get(`/api/orgs/${orgA}/incidents?assigneeId[$ne]=x`).set(auth(alice))).status).toBeLessThan(500);
  });
});
