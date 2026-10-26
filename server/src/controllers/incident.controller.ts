import type { Response } from 'express';
import { actorFrom, asyncHandler } from '../lib/http';
import { badRequest } from '../lib/errors';
import * as incidents from '../services/incidents';
import * as attachments from '../services/attachments';
import * as ai from '../services/ai';

const id = (req: { params: Record<string, string | undefined> }, key = 'incidentId') => req.params[key] as string;

export const list = asyncHandler(async (req, res) => {
  res.json(await incidents.listIncidents(actorFrom(req), req.query as any));
});
export const create = asyncHandler(async (req, res) => {
  res.status(201).json({ incident: await incidents.createIncident(actorFrom(req), req.body) });
});
export const get = asyncHandler(async (req, res) => {
  res.json({ incident: await incidents.getIncident(actorFrom(req), id(req)) });
});
export const update = asyncHandler(async (req, res) => {
  res.json({ incident: await incidents.updateIncident(actorFrom(req), id(req), req.body) });
});
export const assign = asyncHandler(async (req, res) => {
  res.json({ incident: await incidents.assignIncident(actorFrom(req), id(req), req.body.assigneeId) });
});
export const transition = asyncHandler(async (req, res) => {
  res.json({ incident: await incidents.transitionIncident(actorFrom(req), id(req), req.body) });
});
export const related = asyncHandler(async (req, res) => {
  res.json({ incidents: await incidents.relatedIncidents(actorFrom(req), id(req)) });
});
export const activity = asyncHandler(async (req, res) => {
  res.json({ activity: await incidents.getActivity(actorFrom(req), id(req)) });
});
export const listComments = asyncHandler(async (req, res) => {
  res.json({ comments: await incidents.listComments(actorFrom(req), id(req)) });
});
export const createComment = asyncHandler(async (req, res) => {
  res.status(201).json({ comment: await incidents.createComment(actorFrom(req), id(req), req.body) });
});

export const exportCsv = asyncHandler(async (req, res) => {
  const { csv } = await incidents.exportIncidentsCsv(actorFrom(req), req.query as any);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="incidents-${stamp}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send('﻿' + csv); // BOM so Excel reads UTF-8 correctly
});

/* attachments */
export const listAttachments = asyncHandler(async (req, res) => {
  res.json({ attachments: await attachments.listAttachments(req.org!.orgId, id(req)) });
});
export const uploadAttachment = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('Attach a file in the "file" field');
  res.status(201).json({ attachment: await attachments.addAttachment(actorFrom(req), id(req), req.file) });
});
export const downloadAttachment = asyncHandler(async (req, res: Response) => {
  const file = await attachments.openAttachment(req.org!.orgId, id(req), id(req, 'attachmentId'));
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.size));
  // Always a download, never rendered inline — uploaded content cannot run in our origin.
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  file.stream.on('error', () => res.destroy());
  file.stream.pipe(res);
});
export const deleteAttachment = asyncHandler(async (req, res) => {
  await attachments.removeAttachment(actorFrom(req), id(req), id(req, 'attachmentId'));
  res.status(204).end();
});

/* AI */
export const runTriage = asyncHandler(async (req, res) => {
  res.status(201).json({ analysis: await ai.runTriage(actorFrom(req), req.body) });
});
export const listAnalyses = asyncHandler(async (req, res) => {
  res.json({ analyses: await ai.listAnalyses(req.org!.orgId, { incidentId: req.query.incidentId as string | undefined }) });
});
export const incidentAnalyses = asyncHandler(async (req, res) => {
  res.json({ analyses: await ai.listAnalyses(req.org!.orgId, { incidentId: id(req) }) });
});
export const applyAi = asyncHandler(async (req, res) => {
  res.json(await ai.applySuggestions(actorFrom(req), id(req), req.body.analysisId, req.body.fields));
});
