import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, auth, createIncident, createOrg, registerUser, setupDb, teardownDb, type TestUser } from './helpers';
import { createApp } from '../src/app';
import { createRedis } from '../src/config/redis';
import { attachSockets } from '../src/sockets';
import { initRealtime } from '../src/services/realtime';
import { Membership } from '../src/models';
import { signAccessToken } from '../src/lib/tokens';

/**
 * Real Socket.IO server + client, real Redis adapter/emitter. Redis must be reachable (REDIS_URL).
 */
let server: http.Server;
let url: string;
let owner: TestUser, agent: TestUser, viewer: TestUser, outsider: TestUser;
let orgId: string, otherOrgId: string;
const sockets: Socket[] = [];
const redisClients: Array<{ quit(): Promise<unknown> }> = [];

const open = (token?: string) =>
  new Promise<Socket>((resolve, reject) => {
    const s = connect(url, { auth: token === undefined ? {} : { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
  });
const join = (s: Socket, org: string) =>
  new Promise<{ ok: boolean; role?: string; error?: string }>((res) => s.emit('org:join', org, res));
const collect = (s: Socket, event: string) => {
  const got: any[] = [];
  s.on(event, (p) => got.push(p));
  return got;
};
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const app = await setupDb('realtime');
  const pub = createRedis('t-pub');
  const sub = pub.duplicate();
  const emitter = createRedis('t-emitter');
  redisClients.push(pub, sub, emitter);
  initRealtime(emitter);
  server = http.createServer(createApp());
  attachSockets(server, { pub, sub });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  void app;

  owner = await registerUser('Owner');
  orgId = await createOrg(owner);
  agent = await addMember(owner, orgId, 'agent');
  viewer = await addMember(owner, orgId, 'viewer');
  outsider = await registerUser('Outsider');
  otherOrgId = await createOrg(outsider, 'Elsewhere');
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await new Promise((r) => server.close(r));
  await Promise.allSettled(redisClients.map((c) => c.quit()));
  await teardownDb();
});

describe('socket authentication', () => {
  it('rejects missing, garbage and revoked tokens', async () => {
    await expect(open()).rejects.toThrow(/UNAUTHORIZED/);
    await expect(open('garbage')).rejects.toThrow(/UNAUTHORIZED/);
    await expect(open(signAccessToken(owner.id, 'family-that-does-not-exist'))).rejects.toThrow(/UNAUTHORIZED/);
    const u = await registerUser('Revoked');
    await api().post('/api/auth/logout-all').set(auth(u));
    await expect(open(u.token)).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('accepts a valid token', async () => {
    const s = await open(owner.token);
    expect(s.connected).toBe(true);
  });
});

describe('room authorization', () => {
  it('refuses to join an organization you are not a member of, and bad ids', async () => {
    const s = await open(outsider.token);
    expect((await join(s, orgId)).ok).toBe(false);
    expect((await join(s, 'nonsense')).error).toBe('INVALID_ORG');
    expect((await join(s, otherOrgId)).ok).toBe(true);
  });

  it('delivers org events to members only, never across organizations', async () => {
    const member = await open(agent.token);
    const outside = await open(outsider.token);
    expect((await join(member, orgId)).role).toBe('agent');
    await join(outside, otherOrgId);
    const mine = collect(member, 'incident:created');
    const theirs = collect(outside, 'incident:created');

    const inc = await createIncident(owner, orgId, { title: 'Realtime incident' });
    await settle();
    expect(mine.map((e) => e.incidentId)).toEqual([inc.id]);
    expect(theirs).toEqual([]);
  });

  it('does not deliver anything to a socket that connected but never joined an org', async () => {
    const lurker = await open(agent.token);
    const got = collect(lurker, 'incident:created');
    await createIncident(owner, orgId, { title: 'Nobody told the lurker' });
    await settle();
    expect(got).toEqual([]);
  });

  it('sends internal notes only to staff sockets, public comments to everyone', async () => {
    const staff = await open(agent.token);
    const readonly = await open(viewer.token);
    expect((await join(staff, orgId)).ok).toBe(true);
    expect((await join(readonly, orgId)).role).toBe('viewer');
    const staffEvents = collect(staff, 'comment:created');
    const viewerEvents = collect(readonly, 'comment:created');
    const inc = await createIncident(owner, orgId, { title: 'Comment fan-out' });

    await api().post(`/api/orgs/${orgId}/incidents/${inc.id}/comments`).set(auth(owner)).send({ body: 'secret', internal: true });
    await api().post(`/api/orgs/${orgId}/incidents/${inc.id}/comments`).set(auth(owner)).send({ body: 'public' });
    await settle();
    expect(staffEvents.map((e) => e.internal)).toEqual([true, false]);
    expect(viewerEvents.map((e) => e.internal)).toEqual([false]);
  });

  it('sends notifications only to the recipient', async () => {
    const recipient = await open(agent.token);
    const bystander = await open(viewer.token);
    const mine = collect(recipient, 'notification:created');
    const others = collect(bystander, 'notification:created');
    const inc = await createIncident(owner, orgId, { title: 'Notify socket' });
    await api().post(`/api/orgs/${orgId}/incidents/${inc.id}/assign`).set(auth(owner)).send({ assigneeId: agent.id });
    await settle();
    expect(mine).toHaveLength(1);
    expect(mine[0].notification).toMatchObject({ type: 'incident_assigned', incidentId: inc.id });
    expect(others).toEqual([]);
  });
});

describe('membership changes take effect on live sockets', () => {
  it('stops delivering org events to a removed member immediately', async () => {
    const temp = await addMember(owner, orgId, 'agent', 'temp');
    const s = await open(temp.token);
    expect((await join(s, orgId)).ok).toBe(true);
    const events = collect(s, 'incident:created');
    await createIncident(owner, orgId, { title: 'Before removal' });
    await settle();
    expect(events).toHaveLength(1);

    const m = await Membership.findOne({ userId: temp.id, organizationId: orgId });
    await api().delete(`/api/orgs/${orgId}/members/${m!._id}`).set(auth(owner));
    await settle(200);
    await createIncident(owner, orgId, { title: 'After removal' });
    await settle();
    expect(events).toHaveLength(1);
    expect((await join(s, orgId)).ok).toBe(false); // and cannot re-join
  });
});
