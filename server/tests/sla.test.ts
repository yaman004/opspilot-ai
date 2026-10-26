import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_IS_ATOMIC, addMember, api, auth, createIncident, createOrg, registerUser, setupDb, teardownDb, type TestUser } from './helpers';
import { AuditLog, Incident, Notification } from '../src/models';
import { scanSlas } from '../src/services/sla';
import * as notifications from '../src/services/notifications';

let owner: TestUser, admin: TestUser, agent: TestUser, viewer: TestUser;
let orgId: string;
const base = () => `/api/orgs/${orgId}`;
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);
const alertsOf = async (id: string) => (await Incident.findById(id))?.sla?.alertsSent ?? [];
const notesFor = (u: TestUser, type: string, incidentId?: string) =>
  Notification.countDocuments({ userId: u.id, type, ...(incidentId ? { incidentId } : {}) });

beforeAll(async () => {
  await setupDb('sla');
  owner = await registerUser('Owner');
  orgId = await createOrg(owner);
  admin = await addMember(owner, orgId, 'admin');
  agent = await addMember(owner, orgId, 'agent');
  viewer = await addMember(owner, orgId, 'viewer');
});
afterAll(teardownDb);

describe('SLA scan', () => {
  it('raises nothing before any threshold is reached', async () => {
    const inc = await createIncident(agent, orgId, { severity: 'high', assigneeId: agent.id });
    const r = await scanSlas({ now: inMinutes(5), orgId });
    expect(r.alertsRaised).toBe(0);
    expect(await alertsOf(inc.id)).toEqual([]);
  });

  it('warns the assignee at the warning threshold, exactly once, even across repeated scans', async () => {
    const inc = await createIncident(owner, orgId, { title: 'Warn me', severity: 'critical', assigneeId: agent.id });
    const before = await notesFor(agent, 'sla_warning');
    // critical response target = 15m, warning at 75% => 11.25m
    const at = inMinutes(12);
    const first = await scanSlas({ now: at, orgId });
    const second = await scanSlas({ now: at, orgId });
    const third = await scanSlas({ now: inMinutes(13), orgId });
    expect(first.alertsRaised).toBeGreaterThanOrEqual(1);
    expect(second.alertsRaised).toBe(0);
    expect(third.alertsRaised).toBe(0);
    expect(await alertsOf(inc.id)).toContain('resp-warn-75');
    expect(await notesFor(agent, 'sla_warning')).toBe(before + 1);
    expect(await AuditLog.countDocuments({ action: 'incident.sla_alert', entityId: inc.id, 'metadata.ruleId': 'resp-warn-75' })).toBe(1);
  });

  it('escalates a breach to admins/owners and the assignee, and bumps priority on resolution breach', async () => {
    const inc = await createIncident(owner, orgId, { title: 'Breach me', severity: 'critical', priority: 'low', assigneeId: agent.id });
    await scanSlas({ now: inMinutes(20), orgId }); // response breached (15m)
    expect(await alertsOf(inc.id)).toContain('resp-breach');
    // counted per incident: other critical incidents from earlier tests breach at the same moment
    expect(await notesFor(admin, 'sla_breached', inc.id)).toBe(1);
    expect(await notesFor(owner, 'sla_breached', inc.id)).toBe(1);
    expect(await notesFor(agent, 'sla_breached', inc.id)).toBe(1);
    expect(await notesFor(viewer, 'sla_breached', inc.id)).toBe(0);
    expect((await Incident.findById(inc.id))!.priority).toBe('low'); // response breach doesn't bump

    await scanSlas({ now: inMinutes(4 * 60 + 5), orgId }); // resolution breached (4h)
    const after = (await Incident.findById(inc.id))!;
    expect(after.sla?.alertsSent).toEqual(expect.arrayContaining(['resp-breach', 'res-breach']));
    expect(after.priority).toBe('medium'); // bumped exactly one step
    expect(after.priorityRank).toBe(2);
    await scanSlas({ now: inMinutes(5 * 60), orgId });
    expect((await Incident.findById(inc.id))!.priority).toBe('medium'); // not bumped again
    const timeline = (await api().get(`${base()}/incidents/${inc.id}/activity`).set(auth(agent))).body.activity;
    expect(timeline.some((t: any) => /SLA alert/.test(t.message))).toBe(true);
  });

  it('stops response alerts once the incident has been responded to', async () => {
    const inc = await createIncident(owner, orgId, { title: 'Responded', severity: 'critical', assigneeId: agent.id });
    await api().post(`${base()}/incidents/${inc.id}/transition`).set(auth(agent)).send({ status: 'in_progress' });
    await scanSlas({ now: inMinutes(20), orgId });
    const sent = await alertsOf(inc.id);
    expect(sent).not.toContain('resp-breach');
    expect(sent).not.toContain('resp-warn-75');
  });

  it('ignores resolved/closed incidents', async () => {
    const inc = await createIncident(owner, orgId, { title: 'Done', severity: 'critical', assigneeId: agent.id });
    await api().post(`${base()}/incidents/${inc.id}/transition`).set(auth(agent)).send({ status: 'resolved', resolutionSummary: 'fixed it quickly' });
    await scanSlas({ now: inMinutes(24 * 60), orgId });
    expect(await alertsOf(inc.id)).toEqual([]);
  });

  it('re-arms alerts when severity changes, and respects a disabled policy', async () => {
    const inc = await createIncident(owner, orgId, { title: 'Rearm', severity: 'critical', assigneeId: agent.id });
    await scanSlas({ now: inMinutes(20), orgId });
    expect((await alertsOf(inc.id)).length).toBeGreaterThan(0);
    await api().patch(`${base()}/incidents/${inc.id}`).set(auth(agent)).send({ severity: 'low' });
    expect(await alertsOf(inc.id)).toEqual([]);

    const policy = (await api().get(`${base()}/sla-policy`).set(auth(admin))).body.policy;
    await api().put(`${base()}/sla-policy`).set(auth(admin)).send({ ...policy, isActive: false });
    const count = (await scanSlas({ now: inMinutes(60 * 24 * 30), orgId })).alertsRaised;
    expect(count).toBe(0);
    await api().put(`${base()}/sla-policy`).set(auth(admin)).send({ ...policy, isActive: true });
  });

  it('can be triggered by admins through the API, scoped to their own org', async () => {
    expect((await api().post(`${base()}/sla-policy/scan`).set(auth(agent))).status).toBe(403);
    const res = await api().post(`${base()}/sla-policy/scan`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.result).toHaveProperty('scanned');
  });
});

describe('retries and concurrency', () => {
  it('a retry after a crash between notify and claim completes the alert without duplicating notifications', async () => {
    const inc = await createIncident(owner, orgId, { title: 'Crashy', severity: 'critical', assigneeId: agent.id });
    const before = await notesFor(agent, 'sla_warning', inc.id);
    const original = notifications.notify;
    let failOnce = true;
    // Simulate a worker that sends the notification, then dies before it can record the alert.
    const incidentModel = Incident as any;
    const realUpdateOne = incidentModel.updateOne.bind(incidentModel);
    incidentModel.updateOne = (...args: any[]) => {
      const update = args[1];
      if (failOnce && update?.$addToSet?.['sla.alertsSent'] && String(args[0]?._id) === inc.id) {
        failOnce = false;
        throw new Error('worker crashed');
      }
      return realUpdateOne(...args);
    };
    try {
      await scanSlas({ now: inMinutes(12), orgId }); // error is caught per-alert and logged; scan survives
    } finally {
      incidentModel.updateOne = realUpdateOne;
    }
    expect(original).toBe(notifications.notify);
    expect(await alertsOf(inc.id)).toEqual([]); // claim never happened
    expect(await notesFor(agent, 'sla_warning', inc.id)).toBe(before + 1); // but the notification went out once

    await scanSlas({ now: inMinutes(12), orgId }); // BullMQ retry / next tick
    expect(await alertsOf(inc.id)).toContain('resp-warn-75');
    expect(await notesFor(agent, 'sla_warning', inc.id)).toBe(before + 1); // deduped — still exactly one
  });

  it('notifications dedupe by key per user', async () => {
    const inc = await createIncident(owner, orgId, { title: 'Dedupe' });
    const input = { orgId, userIds: [agent.id], type: 'system' as const, title: 'once', incidentId: inc.id, dedupeKey: `test:${inc.id}` };
    expect(await notifications.notify(input)).toBe(1);
    expect(await notifications.notify(input)).toBe(0);
    expect(await Notification.countDocuments({ dedupeKey: input.dedupeKey })).toBe(1);
  });

  it('never notifies users outside the organization', async () => {
    const stranger = await registerUser('Stranger');
    const n = await notifications.notify({ orgId, userIds: [stranger.id], type: 'system', title: 'leak?' });
    expect(n).toBe(0);
    expect(await Notification.countDocuments({ userId: stranger.id })).toBe(0);
  });

  it('honours minRole so viewers do not receive agent-only notices', async () => {
    const n = await notifications.notify({ orgId, userIds: [viewer.id, agent.id], type: 'system', title: 'staff only', minRole: 'agent' });
    expect(n).toBe(1);
    expect(await Notification.countDocuments({ userId: viewer.id, title: 'staff only' })).toBe(0);
  });

  it.skipIf(!DB_IS_ATOMIC)('two workers scanning at once raise each alert once (needs real MongoDB)', async () => {
    const inc = await createIncident(owner, orgId, { title: 'Race', severity: 'critical', assigneeId: agent.id });
    const at = inMinutes(12);
    const [a, b] = await Promise.all([scanSlas({ now: at, orgId }), scanSlas({ now: at, orgId })]);
    expect(a.alertsRaised + b.alertsRaised).toBeGreaterThanOrEqual(1);
    expect(await AuditLog.countDocuments({ action: 'incident.sla_alert', entityId: inc.id, 'metadata.ruleId': 'resp-warn-75' })).toBe(1);
  });
});

describe('notification API', () => {
  it('lists, filters unread, marks read and mark-all-read', async () => {
    const list = await api().get(`${base()}/notifications?pageSize=100`).set(auth(agent));
    expect(list.body.unreadCount).toBeGreaterThan(0);
    const first = list.body.items[0];
    const read = await api().patch(`${base()}/notifications/${first.id}/read`).set(auth(agent));
    expect(read.body.notification.readAt).toBeTruthy();
    const unread = await api().get(`${base()}/notifications?unread=true&pageSize=100`).set(auth(agent));
    expect(unread.body.items.every((n: any) => n.readAt === null)).toBe(true);
    expect(unread.body.items.some((n: any) => n.id === first.id)).toBe(false);
    const all = await api().post(`${base()}/notifications/read-all`).set(auth(agent));
    expect(all.body.updated).toBeGreaterThan(0);
    expect((await api().get(`${base()}/notifications?unread=true`).set(auth(agent))).body.total).toBe(0);
  });
});
