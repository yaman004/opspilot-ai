import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, auth, createIncident, createOrg, registerUser, setupDb, teardownDb, type TestUser } from './helpers';
import { Incident } from '../src/models';

let owner: TestUser, agent: TestUser, viewer: TestUser;
let orgId: string, teamId: string;
const base = () => `/api/orgs/${orgId}`;
const overview = (u: TestUser, q = '') => api().get(`${base()}/analytics/overview${q}`).set(auth(u));

beforeAll(async () => {
  await setupDb('analytics');
  owner = await registerUser('Owner');
  orgId = await createOrg(owner);
  agent = await addMember(owner, orgId, 'agent');
  viewer = await addMember(owner, orgId, 'viewer');
  teamId = (await api().post(`${base()}/teams`).set(auth(owner)).send({ name: 'Ops' })).body.team.id;
});
afterAll(teardownDb);

describe('analytics overview', () => {
  it('returns empty-state numbers for an organization without incidents', async () => {
    const res = await overview(viewer);
    expect(res.status).toBe(200);
    expect(res.body.kpis).toMatchObject({ openIncidents: 0, criticalIncidents: 0, overdueIncidents: 0, totalInRange: 0 });
    expect(res.body.kpis.avgResolutionMs).toBeNull();
    expect(res.body.kpis.resolutionSlaCompliance).toBeNull();
    expect(res.body.trend.length).toBeGreaterThan(0);
    expect(res.body.severity.every((s: any) => s.count === 0)).toBe(true);
  });

  it('derives every figure from real incident data', async () => {
    const a = await createIncident(agent, orgId, { severity: 'critical', category: 'database', teamId, assigneeId: agent.id });
    const b = await createIncident(agent, orgId, { severity: 'high', category: 'network', teamId });
    const c = await createIncident(agent, orgId, { severity: 'low', category: 'network' });
    await createIncident(agent, orgId, { severity: 'medium', category: 'application' });

    await api().post(`${base()}/incidents/${b.id}/transition`).set(auth(agent)).send({ status: 'in_progress' });
    await api().post(`${base()}/incidents/${b.id}/transition`).set(auth(agent)).send({ status: 'resolved', resolutionSummary: 'restarted router' });
    await api().post(`${base()}/incidents/${c.id}/transition`).set(auth(agent)).send({ status: 'triaged' });

    // make incident A overdue
    await Incident.updateOne({ _id: a.id }, { $set: { 'sla.resolutionDueAt': new Date(Date.now() - 3_600_000) } });

    const res = await overview(viewer);
    const k = res.body.kpis;
    expect(k.openIncidents).toBe(3); // a, c, d active; b resolved
    expect(k.criticalIncidents).toBe(1);
    expect(k.overdueIncidents).toBe(1);
    expect(k.totalInRange).toBe(4);
    expect(k.resolvedInRange).toBe(1);
    expect(k.avgResolutionMs).toBeGreaterThanOrEqual(0);
    expect(k.avgResponseMs).toBeGreaterThanOrEqual(0); // b and c were responded to
    expect(k.resolutionSlaCompliance).toBe(75); // 4 eligible, 1 overdue

    expect(Object.fromEntries(res.body.severity.map((s: any) => [s.severity, s.count]))).toEqual({ low: 1, medium: 1, high: 1, critical: 1 });
    expect(Object.fromEntries(res.body.categories.map((s: any) => [s.category, s.count]))).toEqual({ database: 1, network: 2, application: 1 });
    const today = res.body.trend[res.body.trend.length - 1];
    expect(today).toMatchObject({ created: 4, resolved: 1 });
    const ops = res.body.workload.find((w: any) => w.teamName === 'Ops');
    expect(ops).toMatchObject({ active: 1, resolved: 1 });
    expect(res.body.workload.find((w: any) => w.teamName === 'Unassigned')).toMatchObject({ active: 2 });
    expect(res.body.resolutionRates.find((r: any) => r.severity === 'high')).toMatchObject({ created: 1, resolved: 1, rate: 100 });
    expect(res.body.range.from < res.body.range.to).toBe(true);
  });

  it('honours date-range and team filters', async () => {
    const past = new Date(Date.now() - 10 * 86_400_000);
    // Mongoose treats createdAt as immutable, so backdate through the raw collection.
    await Incident.collection.updateOne({ organizationId: new Types.ObjectId(orgId), severity: 'low' }, { $set: { createdAt: past } });
    const narrow = await overview(viewer, `?from=${new Date(Date.now() - 86_400_000).toISOString()}`);
    expect(narrow.body.kpis.totalInRange).toBe(3);
    const wide = await overview(viewer, `?from=${new Date(Date.now() - 20 * 86_400_000).toISOString()}`);
    expect(wide.body.kpis.totalInRange).toBe(4);
    const byTeam = await overview(viewer, `?teamId=${teamId}`);
    expect(byTeam.body.kpis.totalInRange).toBe(2);
    expect((await overview(viewer, '?from=not-a-date')).status).toBe(422);
    expect((await overview(viewer, '?teamId=zzz')).status).toBe(422);
  });

  it('updates as incidents change (no cached or hardcoded values)', async () => {
    const before = (await overview(viewer)).body.kpis.openIncidents;
    await createIncident(agent, orgId, { severity: 'critical' });
    const after = (await overview(viewer)).body.kpis;
    expect(after.openIncidents).toBe(before + 1);
    expect(after.criticalIncidents).toBe(2);
  });

  it('requires authentication', async () => {
    expect((await api().get(`${base()}/analytics/overview`)).status).toBe(401);
  });
});

describe('audit log', () => {
  it('records actions, is admin-only, filterable and paginated', async () => {
    const admin = await addMember(owner, orgId, 'admin');
    expect((await api().get(`${base()}/audit-logs`).set(auth(agent))).status).toBe(403);
    expect((await api().get(`${base()}/audit-logs`).set(auth(viewer))).status).toBe(403);
    const all = await api().get(`${base()}/audit-logs?pageSize=5`).set(auth(admin));
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(5);
    expect(all.body.total).toBeGreaterThan(5);
    expect(all.body.items[0].createdAt >= all.body.items[4].createdAt).toBe(true);
    const created = await api().get(`${base()}/audit-logs?action=incident.created&pageSize=100`).set(auth(admin));
    expect(created.body.items.every((i: any) => i.action === 'incident.created')).toBe(true);
    expect(created.body.items[0].actor.name).toBeTruthy();
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|tokenHash/);
  });
});

describe('global search', () => {
  it('finds incidents by key/title, teams and members within the org only', async () => {
    const inc = await createIncident(agent, orgId, { title: 'Quokka outage in the warehouse' });
    const byTitle = await api().get(`${base()}/search?q=quokka`).set(auth(viewer));
    expect(byTitle.body.incidents[0]).toMatchObject({ key: inc.key });
    expect((await api().get(`${base()}/search?q=${inc.key}`).set(auth(viewer))).body.incidents[0].key).toBe(inc.key);
    expect((await api().get(`${base()}/search?q=ops`).set(auth(viewer))).body.teams[0].name).toBe('Ops');
    expect((await api().get(`${base()}/search?q=a`).set(auth(viewer))).body.incidents).toEqual([]); // too short
  });
});
