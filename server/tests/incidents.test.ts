import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_IS_ATOMIC, addMember, api, auth, createIncident, createOrg, registerUser, setupDb, teardownDb, type TestUser } from './helpers';
import { AuditLog, Incident } from '../src/models';
import { emitted } from '../src/services/realtime';

let owner: TestUser, admin: TestUser, agent: TestUser, agent2: TestUser, viewer: TestUser;
let orgId: string;
const base = () => `/api/orgs/${orgId}`;

beforeAll(async () => {
  await setupDb('incidents');
  owner = await registerUser('Owner');
  orgId = await createOrg(owner);
  admin = await addMember(owner, orgId, 'admin');
  agent = await addMember(owner, orgId, 'agent');
  agent2 = await addMember(owner, orgId, 'agent', 'agent2');
  viewer = await addMember(owner, orgId, 'viewer');
});
afterAll(teardownDb);

const transition = (u: TestUser, id: string, body: object) =>
  api().post(`${base()}/incidents/${id}/transition`).set(auth(u)).send(body);

describe('incident creation', () => {
  it('numbers incidents sequentially and computes SLA deadlines from the policy', async () => {
    const a = await createIncident(agent, orgId, { severity: 'critical' });
    const b = await createIncident(agent, orgId);
    expect(b.number).toBe(a.number + 1);
    expect(a.key).toBe(`INC-${a.number}`);
    expect(a.status).toBe('open');
    expect(a.priority).toBe('urgent'); // derived from critical severity
    const resp = new Date(a.sla.responseDueAt).getTime();
    const created = new Date((await api().get(`${base()}/incidents/${a.id}`).set(auth(agent))).body.incident.createdAt).getTime();
    expect(resp - created).toBe(15 * 60_000); // critical response target
    expect(new Date(a.sla.resolutionDueAt).getTime() - created).toBe(4 * 3_600_000);
  });

  it('hands out unique numbers under concurrent creation', async () => {
    const created = await Promise.all(Array.from({ length: 8 }, (_, i) => createIncident(agent, orgId, { title: `Parallel ${i}` })));
    expect(new Set(created.map((c) => c.number)).size).toBe(8);
  });

  it('validates input', async () => {
    const res = await api().post(`${base()}/incidents`).set(auth(agent)).send({ title: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('rejects assigning viewers, non-members and foreign teams', async () => {
    const stranger = await registerUser('Stranger');
    const r1 = await api().post(`${base()}/incidents`).set(auth(agent)).send({ title: 'abc', description: 'd', category: 'other', severity: 'low', assigneeId: viewer.id });
    const r2 = await api().post(`${base()}/incidents`).set(auth(agent)).send({ title: 'abc', description: 'd', category: 'other', severity: 'low', assigneeId: stranger.id });
    const r3 = await api().post(`${base()}/incidents`).set(auth(agent)).send({ title: 'abc', description: 'd', category: 'other', severity: 'low', teamId: '0123456789abcdef01234567' });
    expect([r1.status, r2.status, r3.status]).toEqual([400, 400, 400]);
  });
});

describe('incident lifecycle', () => {
  it('walks open → triaged → in_progress → resolved → closed → reopened with full history', async () => {
    const inc = await createIncident(agent, orgId, { title: 'Lifecycle incident' });

    expect((await transition(agent, inc.id, { status: 'triaged' })).body.incident.status).toBe('triaged');
    expect((await transition(agent, inc.id, { status: 'in_progress' })).status).toBe(200);

    const noSummary = await transition(agent, inc.id, { status: 'resolved' });
    expect(noSummary.status).toBe(422);

    const resolved = await transition(agent, inc.id, { status: 'resolved', resolutionSummary: 'Rolled back the bad deploy' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.incident.resolvedAt).toBeTruthy();
    expect(resolved.body.incident.resolutionSummary).toBe('Rolled back the bad deploy');
    expect(resolved.body.incident.sla.resolution).toBe('met');

    expect((await transition(agent, inc.id, { status: 'closed' })).body.incident.closedAt).toBeTruthy();
    const edit = await api().patch(`${base()}/incidents/${inc.id}`).set(auth(agent)).send({ title: 'Edited after close' });
    expect(edit.status).toBe(409); // closed incidents are read-only until reopened

    const reopened = await transition(agent, inc.id, { status: 'open' });
    expect(reopened.body.incident.status).toBe('open');
    expect(reopened.body.incident.reopenCount).toBe(1);
    expect(reopened.body.incident.resolvedAt).toBeNull();

    const timeline = (await api().get(`${base()}/incidents/${inc.id}/activity`).set(auth(agent))).body.activity;
    expect(timeline.map((t: any) => t.action)).toEqual([
      'incident.created',
      'incident.status_changed',
      'incident.status_changed',
      'incident.status_changed',
      'incident.status_changed',
      'incident.status_changed',
    ]);
    expect(timeline[timeline.length - 1].message).toMatch(/changed status from closed to open/);
  });

  it('rejects invalid transitions on the server', async () => {
    const inc = await createIncident(agent, orgId);
    const res = await transition(agent, inc.id, { status: 'closed' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(res.body.error.details.allowed).toContain('triaged');
    expect((await Incident.findById(inc.id))?.status).toBe('open'); // nothing persisted
  });

  it('records first response when work starts and when a responder replies publicly', async () => {
    const a = await createIncident(agent, orgId);
    expect(a.sla.firstRespondedAt).toBeNull();
    await transition(agent, a.id, { status: 'triaged' });
    expect((await api().get(`${base()}/incidents/${a.id}`).set(auth(agent))).body.incident.sla.firstRespondedAt).toBeTruthy();

    const b = await createIncident(agent, orgId);
    await api().post(`${base()}/incidents/${b.id}/comments`).set(auth(agent)).send({ body: 'internal only', internal: true });
    expect((await api().get(`${base()}/incidents/${b.id}`).set(auth(agent))).body.incident.sla.firstRespondedAt).toBeNull();
    await api().post(`${base()}/incidents/${b.id}/comments`).set(auth(agent2)).send({ body: 'We are looking into it' });
    expect((await api().get(`${base()}/incidents/${b.id}`).set(auth(agent))).body.incident.sla.firstRespondedAt).toBeTruthy();
  });

  it.skipIf(!DB_IS_ATOMIC)('prevents two simultaneous conflicting transitions from both succeeding (needs real MongoDB)', async () => {
    const inc = await createIncident(agent, orgId);
    const [r1, r2] = await Promise.all([
      transition(agent, inc.id, { status: 'resolved', resolutionSummary: 'first writer wins' }),
      transition(agent2, inc.id, { status: 'blocked' }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('assigns, notifies the assignee, and audits it', async () => {
    const inc = await createIncident(agent, orgId);
    const res = await api().post(`${base()}/incidents/${inc.id}/assign`).set(auth(agent)).send({ assigneeId: agent2.id });
    expect(res.status).toBe(200);
    expect(res.body.incident.assignee.id).toBe(agent2.id);
    const notes = await api().get(`${base()}/notifications`).set(auth(agent2));
    expect(notes.body.items.some((n: any) => n.type === 'incident_assigned' && n.incidentId === inc.id)).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'incident.assigned', entityId: inc.id })).toBe(1);
    const unassign = await api().post(`${base()}/incidents/${inc.id}/assign`).set(auth(agent)).send({ assigneeId: null });
    expect(unassign.body.incident.assignee).toBeNull();
  });

  it('changing severity re-computes SLA deadlines', async () => {
    const inc = await createIncident(agent, orgId, { severity: 'low' });
    const before = new Date(inc.sla.resolutionDueAt).getTime();
    const res = await api().patch(`${base()}/incidents/${inc.id}`).set(auth(agent)).send({ severity: 'critical' });
    expect(res.status).toBe(200);
    expect(new Date(res.body.incident.sla.resolutionDueAt).getTime()).toBeLessThan(before);
  });
});

describe('search, filters, sorting, pagination', () => {
  it('filters, searches by key, sorts by severity rank and paginates', async () => {
    await createIncident(agent, orgId, { title: 'Zebra database failover', category: 'database', severity: 'critical', tags: ['zebra'] });
    await createIncident(agent, orgId, { title: 'Zebra printer jam', category: 'hardware', severity: 'low', tags: ['zebra'] });

    const byTag = await api().get(`${base()}/incidents?tag=zebra&sort=severity&order=desc`).set(auth(viewer));
    expect(byTag.body.items.map((i: any) => i.severity)).toEqual(['critical', 'low']);

    const byText = await api().get(`${base()}/incidents?q=failover`).set(auth(viewer));
    expect(byText.body.total).toBe(1);

    const key = byText.body.items[0].key;
    expect((await api().get(`${base()}/incidents?q=${key}`).set(auth(viewer))).body.items[0].key).toBe(key);

    const multi = await api().get(`${base()}/incidents?severity=critical,low&category=hardware`).set(auth(viewer));
    expect(multi.body.items.every((i: any) => i.category === 'hardware')).toBe(true);

    const page1 = await api().get(`${base()}/incidents?pageSize=5&page=1`).set(auth(viewer));
    const page2 = await api().get(`${base()}/incidents?pageSize=5&page=2`).set(auth(viewer));
    expect(page1.body.items).toHaveLength(5);
    expect(page1.body.totalPages).toBeGreaterThan(1);
    const ids1 = new Set(page1.body.items.map((i: any) => i.id));
    expect(page2.body.items.some((i: any) => ids1.has(i.id))).toBe(false);

    expect((await api().get(`${base()}/incidents?sort=hacker`).set(auth(viewer))).status).toBe(422);
    expect((await api().get(`${base()}/incidents?q=${encodeURIComponent('.*(')}`).set(auth(viewer))).status).toBe(200); // regex-escaped
  });

  it('finds related incidents by shared tags/category', async () => {
    const a = await createIncident(agent, orgId, { title: 'Rel A', category: 'network', tags: ['relnet'] });
    const b = await createIncident(agent, orgId, { title: 'Rel B', category: 'network', tags: ['relnet'] });
    const res = await api().get(`${base()}/incidents/${a.id}/related`).set(auth(viewer));
    expect(res.body.incidents[0].id).toBe(b.id);
    expect(res.body.incidents.some((i: any) => i.id === a.id)).toBe(false);
  });
});

describe('comments & internal notes', () => {
  it('hides internal notes from viewers (API + timeline + realtime)', async () => {
    const inc = await createIncident(agent, orgId);
    emitted.length = 0;
    await api().post(`${base()}/incidents/${inc.id}/comments`).set(auth(agent)).send({ body: 'public reply' });
    await api().post(`${base()}/incidents/${inc.id}/comments`).set(auth(agent)).send({ body: 'secret note', internal: true });

    const forViewer = (await api().get(`${base()}/incidents/${inc.id}/comments`).set(auth(viewer))).body.comments;
    const forAgent = (await api().get(`${base()}/incidents/${inc.id}/comments`).set(auth(agent))).body.comments;
    expect(forViewer.map((c: any) => c.body)).toEqual(['public reply']);
    expect(forAgent).toHaveLength(2);

    const internalEvents = emitted.filter((e) => e.event === 'comment:created' && (e.payload as any).internal);
    expect(internalEvents).toHaveLength(1);
    expect(internalEvents[0]!.room).toMatch(/:staff$/); // never the all-members room
    const publicEvents = emitted.filter((e) => e.event === 'comment:created' && !(e.payload as any).internal);
    expect(publicEvents[0]!.room).not.toMatch(/:staff$/);

    const viewerTimeline = (await api().get(`${base()}/incidents/${inc.id}/activity`).set(auth(viewer))).body.activity;
    expect(viewerTimeline.some((t: any) => t.metadata.internal === true)).toBe(false);
  });

  it('forbids viewers from commenting', async () => {
    const inc = await createIncident(agent, orgId);
    const res = await api().post(`${base()}/incidents/${inc.id}/comments`).set(auth(viewer)).send({ body: 'hi' });
    expect(res.status).toBe(403);
  });
});

describe('CSV export', () => {
  it('is restricted to agents and above, scoped to the org, and neutralizes formulas', async () => {
    await createIncident(agent, orgId, { title: '=HYPERLINK("http://evil","click"), "quoted"', description: 'csv test' });
    expect((await api().get(`${base()}/incidents/export.csv`).set(auth(viewer))).status).toBe(403);
    expect((await api().get(`${base()}/incidents/export.csv`)).status).toBe(401);

    const ok = await api().get(`${base()}/incidents/export.csv?q=HYPERLINK`).set(auth(agent));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/text\/csv/);
    expect(ok.headers['content-disposition']).toMatch(/attachment; filename="incidents-/);
    expect(ok.text).toContain(`"'=HYPERLINK(""http://evil"",""click""), ""quoted"""`);
    expect(ok.text.split('\r\n')[0]).toContain('Key,Title,Status');

    // another organization's export never contains this org's incidents
    const other = await registerUser('OtherOwner');
    const otherOrg = await createOrg(other, 'Other Co');
    const theirs = await api().get(`/api/orgs/${otherOrg}/incidents/export.csv`).set(auth(other));
    expect(theirs.status).toBe(200);
    expect(theirs.text).not.toContain('HYPERLINK');
    expect(await AuditLog.countDocuments({ action: 'incident.exported' })).toBeGreaterThanOrEqual(2);
  });
});

describe('role-based authorization', () => {
  it('enforces the matrix on incident endpoints', async () => {
    const inc = await createIncident(agent, orgId);
    const id = inc.id;
    const body = { title: 'Changed title' };
    const cases: Array<[string, () => Promise<{ status: number }>, number]> = [
      ['viewer create', () => api().post(`${base()}/incidents`).set(auth(viewer)).send({ title: 'abc', description: 'd', category: 'other', severity: 'low' }), 403],
      ['viewer edit', () => api().patch(`${base()}/incidents/${id}`).set(auth(viewer)).send(body), 403],
      ['viewer assign', () => api().post(`${base()}/incidents/${id}/assign`).set(auth(viewer)).send({ assigneeId: null }), 403],
      ['viewer transition', () => transition(viewer, id, { status: 'triaged' }), 403],
      ['viewer ai triage', () => api().post(`${base()}/ai/triage`).set(auth(viewer)).send({ title: 'abc', description: 'long enough description' }), 403],
      ['viewer read', () => api().get(`${base()}/incidents/${id}`).set(auth(viewer)), 200],
      ['agent edit', () => api().patch(`${base()}/incidents/${id}`).set(auth(agent)).send(body), 200],
      ['agent manage teams', () => api().post(`${base()}/teams`).set(auth(agent)).send({ name: 'Nope' }), 403],
      ['agent sla policy', () => api().get(`${base()}/sla-policy`).set(auth(agent)), 200],
      ['agent audit logs', () => api().get(`${base()}/audit-logs`).set(auth(agent)), 403],
      ['admin audit logs', () => api().get(`${base()}/audit-logs`).set(auth(admin)), 200],
      ['admin delete org', () => api().delete(`${base()}`).set(auth(admin)).send({ confirmName: 'Acme Ops' }), 403],
    ];
    for (const [name, run, expected] of cases) {
      const res = await run();
      expect(res.status, name).toBe(expected);
    }
  });

  it('refuses unauthenticated access everywhere', async () => {
    for (const path of ['/incidents', '/members', '/teams', '/analytics/overview', '/notifications', '/audit-logs']) {
      expect((await api().get(`${base()}${path}`)).status, path).toBe(401);
    }
  });
});
