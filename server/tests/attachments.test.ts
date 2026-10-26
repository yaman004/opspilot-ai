import fs from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, auth, createIncident, createOrg, registerUser, setupDb, teardownDb, type TestUser } from './helpers';
import { Attachment } from '../src/models';

let owner: TestUser, agent: TestUser, viewer: TestUser;
let orgId: string, incId: string;
const base = () => `/api/orgs/${orgId}/incidents/${incId}/attachments`;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const upload = (u: TestUser, buf: Buffer, name: string, type: string, url = base()) =>
  api().post(url).set(auth(u)).attach('file', buf, { filename: name, contentType: type });

beforeAll(async () => {
  await setupDb('attachments');
  owner = await registerUser('Owner');
  orgId = await createOrg(owner);
  agent = await addMember(owner, orgId, 'agent');
  viewer = await addMember(owner, orgId, 'viewer');
  incId = (await createIncident(agent, orgId)).id;
});
afterAll(async () => {
  await fs.rm('./.data/test-uploads', { recursive: true, force: true });
  await teardownDb();
});

describe('upload validation', () => {
  it('accepts a valid image and stores it under a server-generated key', async () => {
    const res = await upload(agent, PNG, '../../etc/shadow screenshot.png', 'image/png');
    expect(res.status).toBe(201);
    expect(res.body.attachment).toMatchObject({ mimeType: 'image/png', size: PNG.length });
    expect(res.body.attachment.fileName).not.toContain('..');
    const stored = await Attachment.findById(res.body.attachment.id).lean();
    expect(stored?.storageKey).toMatch(new RegExp(`^${orgId}/${incId}/[0-9a-f-]{36}\\.png$`));
    expect(stored?.storageKey).not.toContain('shadow');
    expect(stored?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects disallowed types, mismatched content, empty and oversized files', async () => {
    const exe = await upload(agent, Buffer.from('MZ\x90\x00'), 'malware.exe', 'application/octet-stream');
    expect(exe.status).toBe(415);
    const html = await upload(agent, Buffer.from('<script>alert(1)</script>'), 'x.html', 'text/html');
    expect(html.status).toBe(415);
    // extension says png, bytes say something else
    const fake = await upload(agent, Buffer.from('#!/bin/sh\necho pwned'), 'fake.png', 'image/png');
    expect(fake.status).toBe(415);
    expect(fake.body.error.code).toBe('FILE_CONTENT_MISMATCH');
    // mime/extension disagreement
    const mismatch = await upload(agent, PNG, 'photo.png', 'application/pdf');
    expect(mismatch.status).toBe(415);
    // text file with binary content
    const bin = await upload(agent, Buffer.from([0x41, 0x00, 0x42]), 'notes.txt', 'text/plain');
    expect(bin.status).toBe(415);
    const empty = await upload(agent, Buffer.alloc(0), 'empty.txt', 'text/plain');
    expect(empty.status).toBe(400);
    const big = await upload(agent, Buffer.alloc(5 * 1024 * 1024 + 10, 0x61), 'big.txt', 'text/plain');
    expect(big.status).toBe(413);
    const none = await api().post(base()).set(auth(agent));
    expect(none.status).toBe(400);
  });
});

describe('authorization', () => {
  it('lets viewers download but not upload or delete', async () => {
    const up = await upload(agent, Buffer.from('hello log file\n'), 'app.log', 'text/plain');
    expect(up.status).toBe(201);
    const id = up.body.attachment.id;
    expect((await upload(viewer, PNG, 'v.png', 'image/png')).status).toBe(403);
    expect((await api().delete(`${base()}/${id}`).set(auth(viewer))).status).toBe(403);

    const dl = await api().get(`${base()}/${id}`).set(auth(viewer)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect((dl.body as Buffer).toString()).toBe('hello log file\n');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['cache-control']).toMatch(/no-store/);
  });

  it('requires authentication and blocks other organizations', async () => {
    const up = await upload(agent, Buffer.from('private\n'), 'p.txt', 'text/plain');
    const id = up.body.attachment.id;
    expect((await api().get(`${base()}/${id}`)).status).toBe(401);

    const other = await registerUser('Other');
    const otherOrg = await createOrg(other, 'Other Org');
    const otherInc = await createIncident(other, otherOrg);
    // other org's URL, our attachment id
    expect((await api().get(`/api/orgs/${otherOrg}/incidents/${otherInc.id}/attachments/${id}`).set(auth(other))).status).toBe(404);
    // our org's URL
    expect((await api().get(`${base()}/${id}`).set(auth(other))).status).toBe(404);
    // right org, wrong incident
    const sibling = await createIncident(agent, orgId);
    expect((await api().get(`/api/orgs/${orgId}/incidents/${sibling.id}/attachments/${id}`).set(auth(agent))).status).toBe(404);
    expect((await upload(other, PNG, 'x.png', 'image/png', base())).status).toBe(404);
  });

  it('deletes the record and the stored file, and audits both actions', async () => {
    const up = await upload(agent, Buffer.from('to delete\n'), 'd.txt', 'text/plain');
    const id = up.body.attachment.id;
    const key = (await Attachment.findById(id).lean())!.storageKey;
    await expect(fs.stat(`./.data/test-uploads/${key}`)).resolves.toBeTruthy();
    expect((await api().delete(`${base()}/${id}`).set(auth(agent))).status).toBe(204);
    await expect(fs.stat(`./.data/test-uploads/${key}`)).rejects.toThrow();
    expect((await api().get(`${base()}/${id}`).set(auth(agent))).status).toBe(404);
    const timeline = (await api().get(`/api/orgs/${orgId}/incidents/${incId}/activity`).set(auth(agent))).body.activity;
    expect(timeline.map((t: any) => t.action)).toEqual(expect.arrayContaining(['attachment.added', 'attachment.removed']));
  });

  it('works with local storage only — no S3 configuration needed', async () => {
    const list = await api().get(base()).set(auth(viewer));
    expect(list.status).toBe(200);
    expect(list.body.attachments.length).toBeGreaterThan(0);
    expect(await Attachment.countDocuments({ storageDriver: 's3' })).toBe(0);
  });
});
