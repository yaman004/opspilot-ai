import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addMember, api, auth, createIncident, createOrg, registerUser, setupDb, teardownDb, type TestUser } from './helpers';
import { AiAnalysis, Incident } from '../src/models';
import {
  AiError,
  parseAndValidate,
  setAiProviderForTests,
  setAiSleepForTests,
} from '../src/services/ai';
import { createAnthropicProvider, createOpenAiProvider, errorForHttpStatus, mockAnalyze, type AiProvider } from '../src/services/ai/providers';

let owner: TestUser, agent: TestUser, viewer: TestUser;
let orgId: string;
const base = () => `/api/orgs/${orgId}`;
const body = { title: 'Primary database unreachable', description: 'Postgres primary is down and all users are seeing errors in production.' };

const validResult = {
  category: 'database',
  severity: 'critical',
  priority: 'urgent',
  suggestedTeam: null,
  summary: 'Primary database outage',
  diagnosticQuestions: ['When did it start?'],
  troubleshootingSteps: ['Check replication status'],
  confidence: 0.8,
};
const fake = (complete: AiProvider['complete'], isMock = false): AiProvider => ({ name: 'fake', model: 'fake-1', isMock, complete });

beforeAll(async () => {
  await setupDb('ai');
  setAiSleepForTests(async () => undefined);
  owner = await registerUser('Owner');
  orgId = await createOrg(owner);
  agent = await addMember(owner, orgId, 'agent');
  viewer = await addMember(owner, orgId, 'viewer');
});
afterAll(teardownDb);
afterEach(() => setAiProviderForTests(null));

describe('response validation (pure)', () => {
  it('accepts clean JSON, fenced JSON and JSON surrounded by chatter', () => {
    const json = JSON.stringify(validResult);
    expect(parseAndValidate(json, []).severity).toBe('critical');
    expect(parseAndValidate('```json\n' + json + '\n```', []).category).toBe('database');
    expect(parseAndValidate(`Sure! Here you go: ${json} Hope it helps.`, []).priority).toBe('urgent');
  });
  it('rejects non-JSON, wrong shapes and out-of-range values', () => {
    const bad = (raw: string) => expect(() => parseAndValidate(raw, [])).toThrow(AiError);
    bad('I cannot help with that');
    bad('{not json}');
    bad(JSON.stringify({ ...validResult, severity: 'apocalyptic' }));
    bad(JSON.stringify({ ...validResult, confidence: 7 }));
    bad(JSON.stringify({ ...validResult, troubleshootingSteps: [] }));
    bad(JSON.stringify({ ...validResult, category: undefined }));
    bad(JSON.stringify({ result: validResult })); // right data, wrong nesting
  });
  it('only keeps a suggested team that really exists (case-insensitive)', () => {
    const r = (team: string | null) => parseAndValidate(JSON.stringify({ ...validResult, suggestedTeam: team }), ['Platform', 'Security']);
    expect(r('platform').suggestedTeam).toBe('Platform');
    expect(r('Imaginary Team').suggestedTeam).toBeNull();
  });
  it('maps provider HTTP statuses to typed errors', () => {
    expect(errorForHttpStatus(429, '2')).toMatchObject({ code: 'AI_RATE_LIMITED', retryable: true, retryAfterMs: 2000 });
    expect(errorForHttpStatus(401)).toMatchObject({ code: 'AI_AUTH_ERROR', retryable: false });
    expect(errorForHttpStatus(503)).toMatchObject({ code: 'AI_UPSTREAM_ERROR', retryable: true });
    expect(errorForHttpStatus(400)).toMatchObject({ code: 'AI_REQUEST_REJECTED', retryable: false });
  });
});

describe('mock provider', () => {
  it('is deterministic, plausible and clearly labeled as a mock everywhere', async () => {
    const r = mockAnalyze('Postgres replication lag', 'The database primary is down for all users', ['Data Platform']);
    expect(r.category).toBe('database');
    expect(r.severity).toBe('critical');
    expect(r.suggestedTeam).toBe('Data Platform');
    expect(r.confidence).toBeLessThanOrEqual(0.6);

    const status = await api().get(`${base()}/ai/status`).set(auth(viewer));
    expect(status.body).toMatchObject({ provider: 'mock', isMock: true });
    expect(status.body.notice).toMatch(/NOT an AI model/);

    const res = await api().post(`${base()}/ai/triage`).set(auth(agent)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.analysis).toMatchObject({ provider: 'mock', isMock: true, status: 'succeeded' });
    expect(res.body.analysis.model).toMatch(/mock/);
    expect(res.body.analysis.result.severity).toBe('critical');
  });
});

describe('triage endpoint', () => {
  it('validates the request and restricts to agents+', async () => {
    expect((await api().post(`${base()}/ai/triage`).set(auth(agent)).send({ title: 'x', description: 'short' })).status).toBe(422);
    expect((await api().post(`${base()}/ai/triage`).set(auth(viewer)).send(body)).status).toBe(403);
  });

  it('persists a failed analysis and returns a typed error when the model output is malformed', async () => {
    setAiProviderForTests(fake(async () => 'Sorry, I am not able to produce JSON today.'));
    const res = await api().post(`${base()}/ai/triage`).set(auth(agent)).send(body);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_RESPONSE');
    const saved = await AiAnalysis.findById(res.body.error.details.analysisId);
    expect(saved).toMatchObject({ status: 'failed', errorCode: 'AI_INVALID_RESPONSE', isMock: false });
  });

  it('retries retryable failures and then succeeds', async () => {
    let calls = 0;
    setAiProviderForTests(
      fake(async () => {
        if (++calls === 1) throw new AiError(503, 'AI_UPSTREAM_ERROR', 'down', true);
        return JSON.stringify(validResult);
      }),
    );
    const res = await api().post(`${base()}/ai/triage`).set(auth(agent)).send(body);
    expect(res.status).toBe(201);
    expect(calls).toBe(2);
    expect(res.body.analysis).toMatchObject({ provider: 'fake', isMock: false });
  });

  it('surfaces provider rate limiting after retries are exhausted', async () => {
    let calls = 0;
    setAiProviderForTests(fake(async () => { calls++; throw new AiError(429, 'AI_RATE_LIMITED', 'slow down', true, 10); }));
    const res = await api().post(`${base()}/ai/triage`).set(auth(agent)).send(body);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('AI_RATE_LIMITED');
    expect(calls).toBe(2); // 1 try + AI_MAX_RETRIES=1
  });

  it('does not retry non-retryable errors and never leaks credentials', async () => {
    let calls = 0;
    setAiProviderForTests(fake(async () => { calls++; throw errorForHttpStatus(401); }));
    const res = await api().post(`${base()}/ai/triage`).set(auth(agent)).send(body);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_AUTH_ERROR');
    expect(calls).toBe(1);
    expect(JSON.stringify(res.body)).not.toMatch(/key|secret|bearer/i);
  });

  it('times out slow providers (real 2s timeout, retried once)', async () => {
    let calls = 0;
    setAiProviderForTests(
      fake(
        (_p, signal) =>
          new Promise((_res, rej) => {
            calls++;
            signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      ),
    );
    const res = await api().post(`${base()}/ai/triage`).set(auth(agent)).send(body);
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('AI_TIMEOUT');
    expect(calls).toBe(2);
  }, 15_000);

  it('a provider returning an unexpected thrown error becomes a safe 502', async () => {
    setAiProviderForTests(fake(async () => { throw new Error('socket hang up with sk-secret-123'); }));
    const res = await api().post(`${base()}/ai/triage`).set(auth(agent)).send(body);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('sk-secret-123');
  });
});

describe('real provider adapters (stubbed fetch)', () => {
  const prompt = { system: 's', user: 'u', teamNames: [], title: 't', description: 'd' };
  const signal = new AbortController().signal;
  const resp = (status: number, json: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json', ...headers } });

  it('anthropic: sends the key only in a header and extracts text blocks', async () => {
    const fetchMock = vi.fn(async () => resp(200, { content: [{ type: 'text', text: '{"a":1}' }] })) as unknown as typeof fetch;
    process.env.AI_API_KEY = 'unused-in-test'; // env is parsed at import; provider reads parsed env
    const p = createAnthropicProvider(fetchMock);
    expect(p).toMatchObject({ name: 'anthropic', isMock: false });
    expect(await p.complete(prompt, signal)).toBe('{"a":1}');
    const [url, init] = (fetchMock as any).mock.calls[0];
    expect(url).toMatch(/\/v1\/messages$/);
    expect(String(init.body)).not.toMatch(/x-api-key/);
  });

  it('openai: extracts the message and maps 429/500/garbage to typed errors', async () => {
    const ok = createOpenAiProvider((async () => resp(200, { choices: [{ message: { content: '{"b":2}' } }] })) as typeof fetch);
    expect(await ok.complete(prompt, signal)).toBe('{"b":2}');
    const rl = createOpenAiProvider((async () => resp(429, {}, { 'retry-after': '1' })) as typeof fetch);
    await expect(rl.complete(prompt, signal)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', retryable: true });
    const down = createOpenAiProvider((async () => resp(500, {})) as typeof fetch);
    await expect(down.complete(prompt, signal)).rejects.toMatchObject({ code: 'AI_UPSTREAM_ERROR' });
    const empty = createOpenAiProvider((async () => resp(200, { choices: [] })) as typeof fetch);
    await expect(empty.complete(prompt, signal)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    const net = createOpenAiProvider((async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
    await expect(net.complete(prompt, signal)).rejects.toMatchObject({ code: 'AI_NETWORK_ERROR', retryable: true });
    const abort = createOpenAiProvider((async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }) as typeof fetch);
    await expect(abort.complete(prompt, signal)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });
});

describe('applying suggestions', () => {
  it('applies only the selected fields, records them, and labels notes by origin', async () => {
    const team = (await api().post(`${base()}/teams`).set(auth(owner)).send({ name: 'Data Platform' })).body.team;
    const inc = await createIncident(agent, orgId, { title: 'Postgres down', description: 'The database is down', category: 'other', severity: 'low' });
    const analysis = (await api().post(`${base()}/ai/triage`).set(auth(agent)).send({ title: 'Postgres down', description: 'The database primary is down for all users', incidentId: inc.id })).body.analysis;
    expect(analysis.result.suggestedTeam).toBe('Data Platform');

    const applied = await api().post(`${base()}/incidents/${inc.id}/ai/apply`).set(auth(agent)).send({ analysisId: analysis.id, fields: ['category', 'severity', 'team'] });
    expect(applied.status).toBe(200);
    expect(applied.body.incident).toMatchObject({ category: 'database', severity: 'critical', priority: 'low' }); // priority untouched
    expect(applied.body.incident.team.id).toBe(team.id);
    expect(applied.body.analysis.appliedFields).toEqual(expect.arrayContaining(['category', 'severity', 'team']));
    expect(applied.body.analysis.appliedFields).not.toContain('priority');

    const withNotes = await api().post(`${base()}/incidents/${inc.id}/ai/apply`).set(auth(agent)).send({ analysisId: analysis.id, fields: ['notes'] });
    expect(withNotes.status).toBe(200);
    const comments = (await api().get(`${base()}/incidents/${inc.id}/comments`).set(auth(agent))).body.comments;
    const note = comments.find((c: any) => /MOCK triage provider/.test(c.body));
    expect(note).toMatchObject({ internal: true });
    expect(note.body).toMatch(/not an AI model/);
  });

  it('refuses to apply a failed analysis, a mismatched incident, or one from another org', async () => {
    const inc = await createIncident(agent, orgId);
    const other = await createIncident(agent, orgId);
    setAiProviderForTests(fake(async () => 'garbage'));
    const failed = await api().post(`${base()}/ai/triage`).set(auth(agent)).send(body);
    setAiProviderForTests(null);
    const analysisId = failed.body.error.details.analysisId;
    expect((await api().post(`${base()}/incidents/${inc.id}/ai/apply`).set(auth(agent)).send({ analysisId, fields: ['category'] })).status).toBe(409);

    const good = (await api().post(`${base()}/ai/triage`).set(auth(agent)).send({ ...body, incidentId: inc.id })).body.analysis;
    expect((await api().post(`${base()}/incidents/${other.id}/ai/apply`).set(auth(agent)).send({ analysisId: good.id, fields: ['category'] })).status).toBe(409);

    const stranger = await registerUser('Stranger');
    const strangerOrg = await createOrg(stranger, 'Other');
    const foreignInc = await createIncident(stranger, strangerOrg);
    expect((await api().post(`/api/orgs/${strangerOrg}/incidents/${foreignInc.id}/ai/apply`).set(auth(stranger)).send({ analysisId: good.id, fields: ['category'] })).status).toBe(404);
    expect((await api().post(`${base()}/incidents/${inc.id}/ai/apply`).set(auth(viewer)).send({ analysisId: good.id, fields: ['category'] })).status).toBe(403);
    expect((await api().post(`${base()}/incidents/${inc.id}/ai/apply`).set(auth(agent)).send({ analysisId: good.id, fields: [] })).status).toBe(422);
    expect((await Incident.findById(inc.id))?.category).toBe('application');
  });
});
