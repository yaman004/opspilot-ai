import { conflict, notFound } from '../lib/errors';
import type { Actor } from '../lib/http';
import { Incident, Membership, Team, type TeamDoc } from '../models';
import { audit } from './audit';
import { toTeamDto } from './serializers';

const asDoc = (t: unknown) => t as TeamDoc;

export async function listTeams(orgId: string) {
  const teams = await Team.find({ organizationId: orgId }).sort({ name: 1 }).lean();
  return teams.map((t) => toTeamDto(asDoc(t)));
}

export async function createTeam(actor: Actor, input: { name: string; description?: string }) {
  try {
    const team = await Team.create({ organizationId: actor.orgId, ...input, memberIds: [] });
    await audit(actor, 'team.created', 'team', String(team._id), { name: team.name });
    return toTeamDto(asDoc(team.toObject()));
  } catch (err: any) {
    if (err?.code === 11000) throw conflict('A team with this name already exists', 'TEAM_EXISTS');
    throw err;
  }
}

export async function updateTeam(actor: Actor, teamId: string, patch: { name?: string; description?: string }) {
  try {
    const team = await Team.findOneAndUpdate({ _id: teamId, organizationId: actor.orgId }, { $set: patch }, { new: true }).lean();
    if (!team) throw notFound('Team');
    await audit(actor, 'team.updated', 'team', teamId, { changes: Object.keys(patch) });
    return toTeamDto(asDoc(team));
  } catch (err: any) {
    if (err?.code === 11000) throw conflict('A team with this name already exists', 'TEAM_EXISTS');
    throw err;
  }
}

export async function deleteTeam(actor: Actor, teamId: string) {
  const team = await Team.findOneAndDelete({ _id: teamId, organizationId: actor.orgId }).lean();
  if (!team) throw notFound('Team');
  await Incident.updateMany({ organizationId: actor.orgId, teamId }, { $set: { teamId: null } });
  await audit(actor, 'team.deleted', 'team', teamId, { name: team.name });
}

export async function addTeamMember(actor: Actor, teamId: string, userId: string) {
  // The user must already belong to this organization — a client-supplied id is never trusted.
  if (!(await Membership.exists({ organizationId: actor.orgId, userId }))) throw notFound('Member');
  const team = await Team.findOneAndUpdate(
    { _id: teamId, organizationId: actor.orgId },
    { $addToSet: { memberIds: userId } },
    { new: true },
  ).lean();
  if (!team) throw notFound('Team');
  await audit(actor, 'team.member_added', 'team', teamId, { userId });
  return toTeamDto(asDoc(team));
}

export async function removeTeamMember(actor: Actor, teamId: string, userId: string) {
  const team = await Team.findOneAndUpdate(
    { _id: teamId, organizationId: actor.orgId },
    { $pull: { memberIds: userId } },
    { new: true },
  ).lean();
  if (!team) throw notFound('Team');
  await audit(actor, 'team.member_removed', 'team', teamId, { userId });
  return toTeamDto(asDoc(team));
}
