import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { syncAllIndexes } from '../src/models';
import { recordRealtimeForTests } from '../src/services/realtime';

let app: Express | null = null;

export async function setupDb(name: string) {
  const base = (process.env.MONGODB_URI as string).replace(/\/[^/?]*(\?.*)?$/, '');
  await mongoose.connect(`${base}/opspilot_t_${name}`);
  await mongoose.connection.dropDatabase();
  await syncAllIndexes();
  recordRealtimeForTests(true);
  app = createApp();
  return app;
}

export async function teardownDb() {
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
}

export const api = () => request(app as Express);

export interface TestUser {
  email: string;
  password: string;
  token: string;
  id: string;
  cookies: string[];
  csrf: string;
}

let counter = 0;
export const PASSWORD = 'CorrectHorse9Battery';

export async function registerUser(name = 'User', extra: Record<string, unknown> = {}): Promise<TestUser> {
  const email = `${name.toLowerCase().replace(/\W/g, '')}${++counter}@example.com`;
  const res = await api().post('/api/auth/register').send({ name, email, password: PASSWORD, ...extra });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return toTestUser(email, res);
}

export function toTestUser(email: string, res: request.Response): TestUser {
  const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  const csrf = /csrf_token=([^;]+)/.exec(cookies.join(';'))?.[1] ?? '';
  return { email, password: PASSWORD, token: res.body.accessToken, id: res.body.user.id, cookies, csrf };
}

export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

export async function createOrg(owner: TestUser, name = 'Acme Ops') {
  const res = await api().post('/api/orgs').set(auth(owner)).send({ name });
  if (res.status !== 201) throw new Error(`createOrg failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.organization.id as string;
}

/** Invites `email` into the org, registers them through the invitation, and returns the new user. */
export async function addMember(owner: TestUser, orgId: string, role: 'admin' | 'agent' | 'viewer', name: string = role) {
  const email = `${name}${++counter}@example.com`;
  const inv = await api().post(`/api/orgs/${orgId}/invitations`).set(auth(owner)).send({ email, role });
  if (inv.status !== 201) throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.body)}`);
  const token = new URL(inv.body.invitation.devAcceptUrl).searchParams.get('token') as string;
  const res = await api().post('/api/auth/register').send({ name, email, password: PASSWORD, inviteToken: token });
  if (res.status !== 201) throw new Error(`register via invite failed: ${res.status} ${JSON.stringify(res.body)}`);
  return toTestUser(email, res);
}

export const incidentBody = (over: Record<string, unknown> = {}) => ({
  title: 'Checkout API returning 500',
  description: 'Customers cannot complete checkout since the last deploy.',
  category: 'application',
  severity: 'high',
  tags: ['checkout'],
  ...over,
});

export async function createIncident(u: TestUser, orgId: string, over: Record<string, unknown> = {}) {
  const res = await api().post(`/api/orgs/${orgId}/incidents`).set(auth(u)).send(incidentBody(over));
  if (res.status !== 201) throw new Error(`createIncident failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.incident as { id: string; number: number; key: string; sla: any; status: string; priority: string };
}

/**
 * True when the test database gives MongoDB's single-document atomicity guarantees. FerretDB's SQLite backend
 * does not (guarded updates can all "win"), so race-condition tests only run against a real MongoDB (CI).
 */
export const DB_IS_ATOMIC = process.env.TEST_DB_ATOMIC === 'true';
