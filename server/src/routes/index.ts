import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  ATTACHMENT_LIMITS,
  acceptInvitationSchema,
  aiTriageRequestSchema,
  analyticsQuerySchema,
  applyAiSuggestionsSchema,
  assignIncidentSchema,
  auditQuerySchema,
  changePasswordSchema,
  createCommentSchema,
  createIncidentSchema,
  createOrganizationSchema,
  createTeamSchema,
  forgotPasswordSchema,
  inviteMemberSchema,
  listIncidentsQuerySchema,
  loginSchema,
  notificationQuerySchema,
  registerSchema,
  resetPasswordSchema,
  teamMemberSchema,
  transitionIncidentSchema,
  updateIncidentSchema,
  updateMemberRoleSchema,
  updateOrganizationSchema,
  updateProfileSchema,
  updateTeamSchema,
  upsertSlaPolicySchema,
} from '@opspilot/shared';
import { isObjectId } from '../lib/http';
import { notFound } from '../lib/errors';
import { authenticate, requireCsrf, requireOrg, requirePermission as can, validate } from '../middleware/core';
import { aiLimiter, authLimiter } from '../middleware/rateLimit';
import * as authCtl from '../controllers/auth.controller';
import * as orgCtl from '../controllers/org.controller';
import * as incCtl from '../controllers/incident.controller';
import * as insightCtl from '../controllers/insights.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_LIMITS.maxBytes, files: 1, fields: 5 },
});

const applyAiBody = applyAiSuggestionsSchema.extend({ analysisId: z.string().regex(/^[a-f\d]{24}$/i) });
const analysesQuery = z.object({ incidentId: z.string().regex(/^[a-f\d]{24}$/i).optional() });
const searchQuery = z.object({ q: z.string().trim().max(100).default('') });

export function buildRouter(): Router {
  const api = Router();

  /* ---------------------------- authentication --------------------------- */
  const auth = Router();
  auth.post('/register', authLimiter, validate({ body: registerSchema }), authCtl.register);
  auth.post('/login', authLimiter, validate({ body: loginSchema }), authCtl.login);
  auth.post('/refresh', authLimiter, requireCsrf, authCtl.refresh);
  auth.post('/logout', requireCsrf, authCtl.logout);
  auth.post('/logout-all', authenticate, authCtl.logoutAll);
  auth.post('/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), authCtl.forgotPassword);
  auth.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), authCtl.resetPassword);
  auth.get('/me', authenticate, authCtl.me);
  auth.patch('/me', authenticate, validate({ body: updateProfileSchema }), authCtl.updateMe);
  auth.post('/change-password', authenticate, authLimiter, validate({ body: changePasswordSchema }), authCtl.changePassword);
  api.use('/auth', auth);

  api.get('/invitations/preview', authLimiter, authCtl.invitationPreview);
  api.post('/invitations/accept', authenticate, validate({ body: acceptInvitationSchema }), authCtl.acceptInvitation);

  /* ----------------------------- organizations --------------------------- */
  api.get('/orgs', authenticate, orgCtl.listMine);
  api.post('/orgs', authenticate, validate({ body: createOrganizationSchema }), orgCtl.create);

  // Everything below is scoped to one organization. requireOrg proves membership from the database.
  const org = Router({ mergeParams: true });
  org.use(authenticate, requireOrg);
  for (const p of ['incidentId', 'teamId', 'userId', 'membershipId', 'invitationId', 'notificationId', 'attachmentId']) {
    org.param(p, (_req, _res, next, value) => (isObjectId(value) ? next() : next(notFound('Resource'))));
  }

  org.get('/', orgCtl.get);
  org.patch('/', can('org:update'), validate({ body: updateOrganizationSchema }), orgCtl.update);
  org.delete('/', can('org:delete'), orgCtl.remove);

  org.get('/members', can('member:read'), orgCtl.listMembers);
  org.patch('/members/:membershipId', can('member:update_role'), validate({ body: updateMemberRoleSchema }), orgCtl.updateMemberRole);
  org.delete('/members/:membershipId', can('member:remove'), orgCtl.removeMember);
  org.post('/leave', orgCtl.leave);

  org.get('/invitations', can('member:invite'), orgCtl.listInvites);
  org.post('/invitations', can('member:invite'), validate({ body: inviteMemberSchema }), orgCtl.invite);
  org.delete('/invitations/:invitationId', can('member:invite'), orgCtl.revokeInvite);

  org.get('/teams', can('team:read'), orgCtl.listTeams);
  org.post('/teams', can('team:manage'), validate({ body: createTeamSchema }), orgCtl.createTeam);
  org.patch('/teams/:teamId', can('team:manage'), validate({ body: updateTeamSchema }), orgCtl.updateTeam);
  org.delete('/teams/:teamId', can('team:manage'), orgCtl.deleteTeam);
  org.post('/teams/:teamId/members', can('team:manage'), validate({ body: teamMemberSchema }), orgCtl.addTeamMember);
  org.delete('/teams/:teamId/members/:userId', can('team:manage'), orgCtl.removeTeamMember);

  org.get('/sla-policy', can('sla:read'), orgCtl.getSla);
  org.put('/sla-policy', can('sla:manage'), validate({ body: upsertSlaPolicySchema }), orgCtl.updateSla);
  org.post('/sla-policy/scan', can('sla:manage'), orgCtl.scanSlaNow);

  /* ------------------------------- incidents ----------------------------- */
  org.get('/incidents', can('incident:read'), validate({ query: listIncidentsQuerySchema }), incCtl.list);
  org.post('/incidents', can('incident:create'), validate({ body: createIncidentSchema }), incCtl.create);
  org.get('/incidents/export.csv', can('incident:export'), validate({ query: listIncidentsQuerySchema }), incCtl.exportCsv);
  org.get('/incidents/:incidentId', can('incident:read'), incCtl.get);
  org.patch('/incidents/:incidentId', can('incident:update'), validate({ body: updateIncidentSchema }), incCtl.update);
  org.post('/incidents/:incidentId/assign', can('incident:assign'), validate({ body: assignIncidentSchema }), incCtl.assign);
  org.post('/incidents/:incidentId/transition', can('incident:transition'), validate({ body: transitionIncidentSchema }), incCtl.transition);
  org.get('/incidents/:incidentId/related', can('incident:read'), incCtl.related);
  org.get('/incidents/:incidentId/activity', can('incident:read'), incCtl.activity);
  org.get('/incidents/:incidentId/comments', can('incident:read'), incCtl.listComments);
  org.post('/incidents/:incidentId/comments', can('comment:create'), validate({ body: createCommentSchema }), incCtl.createComment);

  org.get('/incidents/:incidentId/attachments', can('attachment:read'), incCtl.listAttachments);
  org.post('/incidents/:incidentId/attachments', can('attachment:upload'), upload.single('file'), incCtl.uploadAttachment);
  org.get('/incidents/:incidentId/attachments/:attachmentId', can('attachment:read'), incCtl.downloadAttachment);
  org.delete('/incidents/:incidentId/attachments/:attachmentId', can('attachment:delete'), incCtl.deleteAttachment);

  /* ---------------------------------- AI --------------------------------- */
  org.get('/ai/status', can('incident:read'), orgCtl.aiInfo);
  org.post('/ai/triage', can('ai:triage'), aiLimiter, validate({ body: aiTriageRequestSchema }), incCtl.runTriage);
  org.get('/ai/analyses', can('ai:triage'), validate({ query: analysesQuery }), incCtl.listAnalyses);
  org.get('/incidents/:incidentId/ai-analyses', can('ai:triage'), incCtl.incidentAnalyses);
  org.post('/incidents/:incidentId/ai/apply', can('ai:triage'), can('incident:update'), validate({ body: applyAiBody }), incCtl.applyAi);

  /* ------------------------- analytics, audit, search --------------------- */
  org.get('/analytics/overview', can('analytics:read'), validate({ query: analyticsQuerySchema }), insightCtl.overview);
  org.get('/audit-logs', can('audit:read'), validate({ query: auditQuerySchema }), insightCtl.auditLogs);
  org.get('/search', can('incident:read'), validate({ query: searchQuery }), insightCtl.search);

  org.get('/notifications', validate({ query: notificationQuerySchema }), insightCtl.listNotifications);
  org.post('/notifications/read-all', insightCtl.markAllRead);
  org.patch('/notifications/:notificationId/read', insightCtl.markRead);

  api.use('/orgs/:orgId', org);
  return api;
}
