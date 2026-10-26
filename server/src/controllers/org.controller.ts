import { z } from 'zod';
import { actorFrom, asyncHandler } from '../lib/http';
import { loadMemberships } from '../services/auth';
import { createInvitation, listInvitations, revokeInvitation } from '../services/invitations';
import * as orgs from '../services/organizations';
import { scanSlas } from '../services/sla';
import * as teams from '../services/teams';
import { aiStatus } from '../services/ai';
import { env } from '../config/env';

/* organizations */
export const listMine = asyncHandler(async (req, res) => {
  res.json({ memberships: await loadMemberships(req.auth!.userId) });
});
export const create = asyncHandler(async (req, res) => {
  const organization = await orgs.createOrganization(req.auth!.userId, req.body);
  res.status(201).json({ organization, memberships: await loadMemberships(req.auth!.userId) });
});
export const get = asyncHandler(async (req, res) => {
  res.json({ organization: await orgs.getOrganization(req.org!.orgId), role: req.org!.role });
});
export const update = asyncHandler(async (req, res) => {
  res.json({ organization: await orgs.updateOrganization(actorFrom(req), req.body) });
});
export const remove = asyncHandler(async (req, res) => {
  await orgs.deleteOrganization(actorFrom(req), z.object({ confirmName: z.string() }).parse(req.body).confirmName);
  res.status(204).end();
});

/* members */
export const listMembers = asyncHandler(async (req, res) => {
  res.json({ members: await orgs.listMembers(req.org!.orgId) });
});
export const updateMemberRole = asyncHandler(async (req, res) => {
  res.json({ member: await orgs.updateMemberRole(actorFrom(req), req.params.membershipId as string, req.body.role) });
});
export const removeMember = asyncHandler(async (req, res) => {
  await orgs.removeMember(actorFrom(req), req.params.membershipId as string);
  res.status(204).end();
});
export const leave = asyncHandler(async (req, res) => {
  await orgs.removeMember(actorFrom(req), req.org!.membershipId);
  res.status(204).end();
});

/* invitations */
export const listInvites = asyncHandler(async (req, res) => {
  res.json({ invitations: await listInvitations(req.org!.orgId) });
});
export const invite = asyncHandler(async (req, res) => {
  res.status(201).json({ invitation: await createInvitation(actorFrom(req), req.body) });
});
export const revokeInvite = asyncHandler(async (req, res) => {
  await revokeInvitation(actorFrom(req), req.params.invitationId as string);
  res.status(204).end();
});

/* teams */
export const listTeams = asyncHandler(async (req, res) => {
  res.json({ teams: await teams.listTeams(req.org!.orgId) });
});
export const createTeam = asyncHandler(async (req, res) => {
  res.status(201).json({ team: await teams.createTeam(actorFrom(req), req.body) });
});
export const updateTeam = asyncHandler(async (req, res) => {
  res.json({ team: await teams.updateTeam(actorFrom(req), req.params.teamId as string, req.body) });
});
export const deleteTeam = asyncHandler(async (req, res) => {
  await teams.deleteTeam(actorFrom(req), req.params.teamId as string);
  res.status(204).end();
});
export const addTeamMember = asyncHandler(async (req, res) => {
  res.json({ team: await teams.addTeamMember(actorFrom(req), req.params.teamId as string, req.body.userId) });
});
export const removeTeamMember = asyncHandler(async (req, res) => {
  res.json({ team: await teams.removeTeamMember(actorFrom(req), req.params.teamId as string, req.params.userId as string) });
});

/* SLA policy */
export const getSla = asyncHandler(async (req, res) => {
  res.json({
    policy: await orgs.getSlaPolicyDto(req.org!.orgId),
    // Shown in the UI so nobody mistakes compressed development deadlines for real ones.
    timeScale: env.SLA_TIME_SCALE,
    scanIntervalSeconds: env.SLA_SCAN_INTERVAL_SECONDS,
  });
});
export const updateSla = asyncHandler(async (req, res) => {
  res.json({ policy: await orgs.updateSlaPolicy(actorFrom(req), req.body) });
});
/** Runs the same idempotent scan the worker runs, for this organization only. */
export const scanSlaNow = asyncHandler(async (req, res) => {
  res.json({ result: await scanSlas({ orgId: req.org!.orgId }) });
});

export const aiInfo = asyncHandler(async (_req, res) => {
  res.json(aiStatus());
});
