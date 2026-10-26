import crypto from 'node:crypto';
import path from 'node:path';
import { ATTACHMENT_LIMITS, SOCKET_EVENTS, type AttachmentDto } from '@opspilot/shared';
import { AppError, badRequest, notFound } from '../lib/errors';
import type { Actor } from '../lib/http';
import { Attachment, Incident, type AttachmentDoc } from '../models';
import { audit } from './audit';
import { emitToOrg } from './realtime';
import { loadRefs, toAttachmentDto } from './serializers';
import { getStorage } from './storage';

const EXT_TO_MIME: Record<string, string[]> = {
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain'],
  '.log': ['text/plain'],
  '.csv': ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
  '.json': ['application/json', 'text/plain'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
};

/** Verifies the file bytes match the claimed type, so a renamed executable cannot slip through. */
function matchesMagic(ext: string, buf: Buffer): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  switch (ext) {
    case '.png':
      return starts(0x89, 0x50, 0x4e, 0x47);
    case '.jpg':
    case '.jpeg':
      return starts(0xff, 0xd8, 0xff);
    case '.gif':
      return starts(0x47, 0x49, 0x46, 0x38);
    case '.webp':
      return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    case '.pdf':
      return buf.subarray(0, 5).toString('ascii') === '%PDF-';
    case '.zip':
      return starts(0x50, 0x4b);
    default:
      // text formats: reject anything containing NUL bytes (binary)
      return !buf.subarray(0, 8000).includes(0);
  }
}

export function validateUpload(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!file.size) throw badRequest('File is empty');
  if (file.size > ATTACHMENT_LIMITS.maxBytes) throw new AppError(413, 'FILE_TOO_LARGE', 'File is too large (max 5 MB)');
  if (!(ATTACHMENT_LIMITS.allowedExtensions as readonly string[]).includes(ext)) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', `Files of type "${ext || 'unknown'}" are not allowed`);
  }
  if (!(ATTACHMENT_LIMITS.allowedMimeTypes as readonly string[]).includes(file.mimetype) || !EXT_TO_MIME[ext]?.includes(file.mimetype)) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'File type does not match its extension');
  }
  if (!matchesMagic(ext, file.buffer)) {
    throw new AppError(415, 'FILE_CONTENT_MISMATCH', 'File contents do not match the declared type');
  }
}

const safeName = (n: string) =>
  path
    .basename(n)
    .replace(/[^\w.\- ()]/g, '_')
    .slice(0, 150);

export async function addAttachment(
  actor: Actor,
  incidentId: string,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
): Promise<AttachmentDto> {
  const incident = await Incident.findOne({ _id: incidentId, organizationId: actor.orgId }, { _id: 1 }).lean();
  if (!incident) throw notFound('Incident');
  validateUpload(file);
  const count = await Attachment.countDocuments({ organizationId: actor.orgId, incidentId });
  if (count >= ATTACHMENT_LIMITS.maxPerIncident) throw new AppError(409, 'ATTACHMENT_LIMIT', 'This incident has too many attachments');

  const storage = getStorage();
  // Server-generated key: user-supplied names never touch the filesystem path.
  const key = `${actor.orgId}/${incidentId}/${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
  await storage.put(key, file.buffer, file.mimetype);
  const doc = await Attachment.create({
    organizationId: actor.orgId,
    incidentId,
    uploadedBy: actor.userId,
    fileName: safeName(file.originalname),
    storageKey: key,
    storageDriver: storage.driver,
    mimeType: file.mimetype,
    size: file.size,
    checksum: crypto.createHash('sha256').update(file.buffer).digest('hex'),
  });
  await audit(actor, 'attachment.added', 'incident', incidentId, { fileName: doc.fileName, size: doc.size });
  emitToOrg(actor.orgId, SOCKET_EVENTS.incidentUpdated, { incidentId, reason: 'attachment' });
  const refs = await loadRefs([actor.userId]);
  return toAttachmentDto(doc.toObject() as unknown as AttachmentDoc, refs);
}

export async function listAttachments(orgId: string, incidentId: string): Promise<AttachmentDto[]> {
  const rows = await Attachment.find({ organizationId: orgId, incidentId }).sort({ createdAt: 1 }).lean();
  const refs = await loadRefs(rows.map((r) => r.uploadedBy));
  return rows.map((r) => toAttachmentDto(r as unknown as AttachmentDoc, refs));
}

/** Authorization is the (orgId, incidentId, attachmentId) triple — a leaked id from another org resolves to 404. */
export async function openAttachment(orgId: string, incidentId: string, attachmentId: string) {
  const att = await Attachment.findOne({ _id: attachmentId, organizationId: orgId, incidentId }).lean();
  if (!att) throw notFound('Attachment');
  const stream = await getStorage().get(att.storageKey);
  return { stream, fileName: att.fileName, mimeType: att.mimeType, size: att.size };
}

export async function removeAttachment(actor: Actor, incidentId: string, attachmentId: string) {
  const att = await Attachment.findOneAndDelete({ _id: attachmentId, organizationId: actor.orgId, incidentId }).lean();
  if (!att) throw notFound('Attachment');
  await getStorage().delete(att.storageKey).catch(() => undefined);
  await audit(actor, 'attachment.removed', 'incident', incidentId, { fileName: att.fileName });
}
