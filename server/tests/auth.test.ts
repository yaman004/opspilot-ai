import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, PASSWORD, registerUser, setupDb, teardownDb, toTestUser } from './helpers';
import { RefreshSession, User } from '../src/models';
import { devOutbox } from '../src/services/mailer';

beforeAll(async () => { await setupDb('auth'); });
afterAll(teardownDb);

describe('registration & login', () => {
  it('registers, hashes the password, and sets hardened cookies', async () => {
    const u = await registerUser('Alice');
    const stored = await User.findOne({ email: u.email }).select('+passwordHash').lean();
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored?.passwordHash).not.toContain(PASSWORD);
    const refresh = u.cookies.find((c) => c.startsWith('refresh_token='))!;
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/Path=\/api\/auth/);
    expect(refresh).toMatch(/SameSite=Lax/i);
    expect(u.cookies.find((c) => c.startsWith('csrf_token='))).not.toMatch(/HttpOnly/i);
  });

  it('rejects weak passwords, bad emails and duplicate accounts', async () => {
    const weak = await api().post('/api/auth/register').send({ name: 'Bob', email: 'bob@example.com', password: 'short' });
    expect(weak.status).toBe(422);
    const badEmail = await api().post('/api/auth/register').send({ name: 'Bob', email: 'nope', password: PASSWORD });
    expect(badEmail.status).toBe(422);
    const u = await registerUser('Dup');
    const dup = await api().post('/api/auth/register').send({ name: 'Dup', email: u.email, password: PASSWORD });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('logs in with correct credentials and gives a generic error otherwise', async () => {
    const u = await registerUser('Carol');
    const ok = await api().post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    const wrongPw = await api().post('/api/auth/login').send({ email: u.email, password: 'WrongPassword1' });
    const noUser = await api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'WrongPassword1' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body.error.message).toBe(noUser.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    const u = await registerUser('Locky');
    for (let i = 0; i < 5; i++) await api().post('/api/auth/login').send({ email: u.email, password: 'WrongPassword1' });
    const res = await api().post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('access tokens', () => {
  it('requires a valid bearer token', async () => {
    expect((await api().get('/api/auth/me')).status).toBe(401);
    expect((await api().get('/api/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
    const u = await registerUser('Dave');
    const me = await api().get('/api/auth/me').set(auth(u));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(u.email);
    expect(me.body.user.passwordHash).toBeUndefined();
  });
});

describe('refresh sessions', () => {
  const cookieHeader = (cookies: string[]) => cookies.map((c) => c.split(';')[0]).join('; ');

  it('rotates the refresh token and issues a working access token', async () => {
    const u = await registerUser('Erin');
    const res = await api().post('/api/auth/refresh').set('Cookie', cookieHeader(u.cookies)).set('X-CSRF-Token', u.csrf);
    expect(res.status).toBe(200);
    const next = toTestUser(u.email, res);
    expect(next.cookies.find((c) => c.startsWith('refresh_token='))).not.toEqual(u.cookies.find((c) => c.startsWith('refresh_token=')));
    expect((await api().get('/api/auth/me').set(auth(next))).status).toBe(200);
  });

  it('rejects refresh without a valid CSRF token or from a foreign origin', async () => {
    const u = await registerUser('Frank');
    const noCsrf = await api().post('/api/auth/refresh').set('Cookie', cookieHeader(u.cookies));
    expect(noCsrf.status).toBe(403);
    const badCsrf = await api().post('/api/auth/refresh').set('Cookie', cookieHeader(u.cookies)).set('X-CSRF-Token', 'x'.repeat(u.csrf.length));
    expect(badCsrf.status).toBe(403);
    const evil = await api().post('/api/auth/refresh').set('Cookie', cookieHeader(u.cookies)).set('X-CSRF-Token', u.csrf).set('Origin', 'https://evil.example');
    expect(evil.status).toBe(403);
  });

  it('detects refresh-token reuse and revokes the whole family', async () => {
    const u = await registerUser('Grace');
    const first = await api().post('/api/auth/refresh').set('Cookie', cookieHeader(u.cookies)).set('X-CSRF-Token', u.csrf);
    expect(first.status).toBe(200);
    const newer = toTestUser(u.email, first);

    // Age the rotation beyond the benign-race grace window, then replay the stale token.
    await RefreshSession.updateMany({ revokedAt: { $ne: null } }, { $set: { revokedAt: new Date(Date.now() - 60_000) } });
    const replay = await api().post('/api/auth/refresh').set('Cookie', cookieHeader(u.cookies)).set('X-CSRF-Token', u.csrf);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSE');

    // The legitimate newer session is dead too, and so is its access token.
    const again = await api().post('/api/auth/refresh').set('Cookie', cookieHeader(newer.cookies)).set('X-CSRF-Token', newer.csrf);
    expect(again.status).toBe(401);
    expect((await api().get('/api/auth/me').set(auth(newer))).status).toBe(401);
  });

  it('treats an immediate double-refresh as a retryable race, not theft', async () => {
    const u = await registerUser('Heidi');
    await api().post('/api/auth/refresh').set('Cookie', cookieHeader(u.cookies)).set('X-CSRF-Token', u.csrf);
    const second = await api().post('/api/auth/refresh').set('Cookie', cookieHeader(u.cookies)).set('X-CSRF-Token', u.csrf);
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe('REFRESH_RACE');
    expect(((second.headers['set-cookie'] ?? []) as unknown as string[]).join(';')).not.toMatch(/refresh_token=;/); // cookie not cleared
  });

  it('logout revokes the session so the access token stops working', async () => {
    const u = await registerUser('Ivan');
    const out = await api().post('/api/auth/logout').set('Cookie', cookieHeader(u.cookies)).set('X-CSRF-Token', u.csrf);
    expect(out.status).toBe(204);
    expect((await api().get('/api/auth/me').set(auth(u))).status).toBe(401);
    const refresh = await api().post('/api/auth/refresh').set('Cookie', cookieHeader(u.cookies)).set('X-CSRF-Token', u.csrf);
    expect(refresh.status).toBe(401);
  });
});

describe('password reset', () => {
  it('does not reveal whether an account exists, and resets with a one-time token', async () => {
    const u = await registerUser('Judy');
    devOutbox.length = 0;
    const known = await api().post('/api/auth/forgot-password').send({ email: u.email });
    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(devOutbox).toHaveLength(1);

    const token = /token=([\w-]+)/.exec(devOutbox[0]!.text)![1]!;
    const reset = await api().post('/api/auth/reset-password').send({ token, password: 'BrandNewPassw0rd' });
    expect(reset.status).toBe(200);
    expect((await api().post('/api/auth/reset-password').send({ token, password: 'AnotherPassw0rd1' })).status).toBe(400);
    expect((await api().get('/api/auth/me').set(auth(u))).status).toBe(401); // old sessions revoked
    expect((await api().post('/api/auth/login').send({ email: u.email, password: 'BrandNewPassw0rd' })).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(401);
  });
});
