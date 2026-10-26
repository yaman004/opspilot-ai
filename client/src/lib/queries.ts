import { useQuery } from '@tanstack/react-query';
import type { IncidentDto, MemberDto, TeamDto } from '@opspilot/shared';
import { api } from './api';
import { useOrgId } from './auth';

export const useTeams = () => {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['org', orgId, 'teams'],
    queryFn: async () => (await api.get<{ teams: TeamDto[] }>(`/orgs/${orgId}/teams`)).teams,
    staleTime: 60_000,
  });
};

export const useMembers = () => {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['org', orgId, 'members'],
    queryFn: async () => (await api.get<{ members: MemberDto[] }>(`/orgs/${orgId}/members`)).members,
    staleTime: 60_000,
  });
};

export const useIncident = (id: string) => {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['org', orgId, 'incident', id, 'detail'],
    queryFn: async () => (await api.get<{ incident: IncidentDto }>(`/orgs/${orgId}/incidents/${id}`)).incident,
    enabled: Boolean(id),
  });
};

export const CATEGORY_OPTIONS = ['infrastructure', 'application', 'database', 'network', 'security', 'access', 'data', 'hardware', 'other'].map((v) => ({
  value: v,
  label: v[0]!.toUpperCase() + v.slice(1),
}));
export const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));
export const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));
export const STATUS_OPTIONS = ['open', 'triaged', 'in_progress', 'blocked', 'resolved', 'closed'].map((v) => ({
  value: v,
  label: v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
}));
