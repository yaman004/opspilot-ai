export const ROLES = ['owner', 'admin', 'agent', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_RANK: Record<Role, number> = { viewer: 1, agent: 2, admin: 3, owner: 4 };

export const INCIDENT_STATUSES = ['open', 'triaged', 'in_progress', 'blocked', 'resolved', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CATEGORIES = [
  'infrastructure',
  'application',
  'database',
  'network',
  'security',
  'access',
  'data',
  'hardware',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Server-enforced status state machine. Resolving requires a resolution summary. */
export const STATUS_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['triaged', 'in_progress', 'blocked', 'resolved'],
  triaged: ['open', 'in_progress', 'blocked', 'resolved'],
  in_progress: ['triaged', 'blocked', 'resolved'],
  blocked: ['open', 'triaged', 'in_progress'],
  resolved: ['closed', 'open', 'in_progress'],
  closed: ['open'],
};

export const ACTIVE_STATUSES: IncidentStatus[] = ['open', 'triaged', 'in_progress', 'blocked'];
export const DONE_STATUSES: IncidentStatus[] = ['resolved', 'closed'];

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** A transition that moves an incident back out of resolved/closed. */
export function isReopen(from: IncidentStatus, to: IncidentStatus): boolean {
  return (from === 'resolved' || from === 'closed') && !DONE_STATUSES.includes(to);
}

export const severityRank = (s: Severity): number => SEVERITIES.indexOf(s) + 1;
export const priorityRank = (p: Priority): number => PRIORITIES.indexOf(p) + 1;

export const DEFAULT_PRIORITY_FOR_SEVERITY: Record<Severity, Priority> = {
  critical: 'urgent',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export const NOTIFICATION_TYPES = [
  'incident_assigned',
  'incident_created',
  'incident_status_changed',
  'incident_comment',
  'sla_warning',
  'sla_breached',
  'sla_escalated',
  'member_invited',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const SOCKET_EVENTS = {
  incidentCreated: 'incident:created',
  incidentUpdated: 'incident:updated',
  incidentAssigned: 'incident:assigned',
  incidentStatusChanged: 'incident:status_changed',
  commentCreated: 'comment:created',
  notificationCreated: 'notification:created',
  membershipChanged: 'membership:changed',
} as const;

export const ATTACHMENT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxPerIncident: 20,
  allowedMimeTypes: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/json',
    'application/zip',
  ],
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.txt', '.log', '.csv', '.json', '.zip'],
} as const;
