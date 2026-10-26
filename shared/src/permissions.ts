import { ROLE_RANK, type Role } from './constants';

/** Minimum role required for each permission. Single source of truth for server + UI. */
export const PERMISSION_MIN_ROLE = {
  'incident:read': 'viewer',
  'incident:create': 'agent',
  'incident:update': 'agent',
  'incident:assign': 'agent',
  'incident:transition': 'agent',
  'incident:export': 'agent',
  'comment:create': 'agent',
  'comment:read_internal': 'agent',
  'ai:triage': 'agent',
  'attachment:upload': 'agent',
  'attachment:read': 'viewer',
  'attachment:delete': 'agent',
  'team:read': 'viewer',
  'team:manage': 'admin',
  'member:read': 'viewer',
  'member:invite': 'admin',
  'member:update_role': 'admin',
  'member:remove': 'admin',
  'sla:read': 'viewer',
  'sla:manage': 'admin',
  'audit:read': 'admin',
  'analytics:read': 'viewer',
  'org:update': 'admin',
  'org:delete': 'owner',
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSION_MIN_ROLE;

export function hasRole(role: Role | undefined | null, min: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function can(role: Role | undefined | null, permission: Permission): boolean {
  return hasRole(role, PERMISSION_MIN_ROLE[permission]);
}

/**
 * Role-management hierarchy:
 *  - nobody can change their own role
 *  - owners can grant/revoke any role
 *  - admins can only manage agents and viewers (both the target's current role and the new role)
 */
export function canAssignRole(actor: Role, target: Role, newRole: Role, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (!can(actor, 'member:update_role')) return false;
  if (actor === 'owner') return true;
  const manageable: Role[] = ['agent', 'viewer'];
  return manageable.includes(target) && manageable.includes(newRole);
}

export function canRemoveMember(actor: Role, target: Role): boolean {
  if (!can(actor, 'member:remove')) return false;
  if (actor === 'owner') return true;
  return target === 'agent' || target === 'viewer';
}
