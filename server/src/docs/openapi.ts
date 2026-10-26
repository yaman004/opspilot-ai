type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Op {
  m: Method;
  path: string;
  summary: string;
  tag: string;
  /** minimum role (omit for public / any authenticated member) */
  role?: 'viewer' | 'agent' | 'admin' | 'owner';
  auth?: 'none' | 'bearer' | 'cookie';
  body?: string;
  query?: string[];
  res?: number;
}

const ORG = '/orgs/{orgId}';

const ops: Op[] = [
  // auth
  { m: 'post', path: '/auth/register', summary: 'Register (optionally redeeming an invitation token)', tag: 'Auth', auth: 'none', body: 'Register', res: 201 },
  { m: 'post', path: '/auth/login', summary: 'Sign in. Sets HttpOnly refresh + CSRF cookies, returns an access token', tag: 'Auth', auth: 'none', body: 'Login' },
  { m: 'post', path: '/auth/refresh', summary: 'Rotate the refresh cookie and get a new access token (requires X-CSRF-Token)', tag: 'Auth', auth: 'cookie' },
  { m: 'post', path: '/auth/logout', summary: 'Revoke the current session family (requires X-CSRF-Token)', tag: 'Auth', auth: 'cookie', res: 204 },
  { m: 'post', path: '/auth/logout-all', summary: 'Revoke every session of the current user', tag: 'Auth', auth: 'bearer', res: 204 },
  { m: 'post', path: '/auth/forgot-password', summary: 'Request a password reset email (always 202)', tag: 'Auth', auth: 'none', res: 202 },
  { m: 'post', path: '/auth/reset-password', summary: 'Set a new password with a reset token', tag: 'Auth', auth: 'none' },
  { m: 'get', path: '/auth/me', summary: 'Current user and memberships', tag: 'Auth', auth: 'bearer' },
  { m: 'patch', path: '/auth/me', summary: 'Update profile (name, timezone, theme)', tag: 'Auth', auth: 'bearer' },
  { m: 'post', path: '/auth/change-password', summary: 'Change password', tag: 'Auth', auth: 'bearer' },
  { m: 'get', path: '/invitations/preview', summary: 'Show which organization an invitation token is for', tag: 'Invitations', auth: 'none', query: ['token'] },
  { m: 'post', path: '/invitations/accept', summary: 'Accept an invitation (email must match the account)', tag: 'Invitations', auth: 'bearer' },
  // orgs
  { m: 'get', path: '/orgs', summary: 'Organizations the user belongs to', tag: 'Organizations', auth: 'bearer' },
  { m: 'post', path: '/orgs', summary: 'Create an organization (caller becomes owner)', tag: 'Organizations', auth: 'bearer', res: 201 },
  { m: 'get', path: ORG, summary: 'Get organization and caller role', tag: 'Organizations', role: 'viewer' },
  { m: 'patch', path: ORG, summary: 'Update organization settings', tag: 'Organizations', role: 'admin' },
  { m: 'delete', path: ORG, summary: 'Delete organization and all of its data', tag: 'Organizations', role: 'owner', res: 204 },
  { m: 'get', path: `${ORG}/members`, summary: 'List members', tag: 'Members', role: 'viewer' },
  { m: 'patch', path: `${ORG}/members/{membershipId}`, summary: 'Change a member role (hierarchy enforced)', tag: 'Members', role: 'admin' },
  { m: 'delete', path: `${ORG}/members/{membershipId}`, summary: 'Remove a member', tag: 'Members', role: 'admin', res: 204 },
  { m: 'post', path: `${ORG}/leave`, summary: 'Leave the organization', tag: 'Members', role: 'viewer', res: 204 },
  { m: 'get', path: `${ORG}/invitations`, summary: 'List invitations', tag: 'Invitations', role: 'admin' },
  { m: 'post', path: `${ORG}/invitations`, summary: 'Invite a member by email', tag: 'Invitations', role: 'admin', res: 201 },
  { m: 'delete', path: `${ORG}/invitations/{invitationId}`, summary: 'Revoke a pending invitation', tag: 'Invitations', role: 'admin', res: 204 },
  // teams
  { m: 'get', path: `${ORG}/teams`, summary: 'List teams', tag: 'Teams', role: 'viewer' },
  { m: 'post', path: `${ORG}/teams`, summary: 'Create a team', tag: 'Teams', role: 'admin', res: 201 },
  { m: 'patch', path: `${ORG}/teams/{teamId}`, summary: 'Update a team', tag: 'Teams', role: 'admin' },
  { m: 'delete', path: `${ORG}/teams/{teamId}`, summary: 'Delete a team (incidents become unassigned from it)', tag: 'Teams', role: 'admin', res: 204 },
  { m: 'post', path: `${ORG}/teams/{teamId}/members`, summary: 'Add an organization member to a team', tag: 'Teams', role: 'admin' },
  { m: 'delete', path: `${ORG}/teams/{teamId}/members/{userId}`, summary: 'Remove a user from a team', tag: 'Teams', role: 'admin' },
  // sla
  { m: 'get', path: `${ORG}/sla-policy`, summary: 'Get SLA policy, time scale and scan interval', tag: 'SLA', role: 'viewer' },
  { m: 'put', path: `${ORG}/sla-policy`, summary: 'Update SLA targets and escalation rules', tag: 'SLA', role: 'admin' },
  { m: 'post', path: `${ORG}/sla-policy/scan`, summary: 'Run the idempotent SLA scan now for this organization', tag: 'SLA', role: 'admin' },
  // incidents
  { m: 'get', path: `${ORG}/incidents`, summary: 'Search / filter / sort / paginate incidents', tag: 'Incidents', role: 'viewer', query: ['q', 'status', 'severity', 'priority', 'category', 'assigneeId', 'teamId', 'reporterId', 'tag', 'overdue', 'from', 'to', 'sort', 'order', 'page', 'pageSize'] },
  { m: 'post', path: `${ORG}/incidents`, summary: 'Create an incident (SLA deadlines computed from policy)', tag: 'Incidents', role: 'agent', body: 'CreateIncident', res: 201 },
  { m: 'get', path: `${ORG}/incidents/export.csv`, summary: 'Export filtered incidents as CSV (formula-injection safe)', tag: 'Incidents', role: 'agent', query: ['same filters as list'] },
  { m: 'get', path: `${ORG}/incidents/{incidentId}`, summary: 'Get an incident', tag: 'Incidents', role: 'viewer' },
  { m: 'patch', path: `${ORG}/incidents/{incidentId}`, summary: 'Edit incident fields', tag: 'Incidents', role: 'agent' },
  { m: 'post', path: `${ORG}/incidents/{incidentId}/assign`, summary: 'Assign / unassign', tag: 'Incidents', role: 'agent' },
  { m: 'post', path: `${ORG}/incidents/{incidentId}/transition`, summary: 'Change status (server-validated state machine; resolving needs a summary)', tag: 'Incidents', role: 'agent', body: 'Transition' },
  { m: 'get', path: `${ORG}/incidents/{incidentId}/related`, summary: 'Related incidents (shared tags / category / team)', tag: 'Incidents', role: 'viewer' },
  { m: 'get', path: `${ORG}/incidents/{incidentId}/activity`, summary: 'Chronological activity timeline', tag: 'Incidents', role: 'viewer' },
  { m: 'get', path: `${ORG}/incidents/{incidentId}/comments`, summary: 'List comments (internal notes hidden from viewers)', tag: 'Comments', role: 'viewer' },
  { m: 'post', path: `${ORG}/incidents/{incidentId}/comments`, summary: 'Add a comment or internal note', tag: 'Comments', role: 'agent', res: 201 },
  { m: 'get', path: `${ORG}/incidents/{incidentId}/attachments`, summary: 'List attachments', tag: 'Attachments', role: 'viewer' },
  { m: 'post', path: `${ORG}/incidents/{incidentId}/attachments`, summary: 'Upload a file (multipart "file", max 5 MB, type + magic-byte checked)', tag: 'Attachments', role: 'agent', res: 201 },
  { m: 'get', path: `${ORG}/incidents/{incidentId}/attachments/{attachmentId}`, summary: 'Download (authorized, always as attachment)', tag: 'Attachments', role: 'viewer' },
  { m: 'delete', path: `${ORG}/incidents/{incidentId}/attachments/{attachmentId}`, summary: 'Delete an attachment', tag: 'Attachments', role: 'agent', res: 204 },
  // ai
  { m: 'get', path: `${ORG}/ai/status`, summary: 'Which AI provider is active and whether it is the mock', tag: 'AI', role: 'viewer' },
  { m: 'post', path: `${ORG}/ai/triage`, summary: 'Run triage. Output is schema-validated; failures return typed errors', tag: 'AI', role: 'agent', body: 'AiTriage', res: 201 },
  { m: 'get', path: `${ORG}/ai/analyses`, summary: 'Recent analyses', tag: 'AI', role: 'agent' },
  { m: 'get', path: `${ORG}/incidents/{incidentId}/ai-analyses`, summary: 'Analyses for an incident', tag: 'AI', role: 'agent' },
  { m: 'post', path: `${ORG}/incidents/{incidentId}/ai/apply`, summary: 'Apply selected suggestions (category, severity, priority, team, notes)', tag: 'AI', role: 'agent' },
  // insights
  { m: 'get', path: `${ORG}/analytics/overview`, summary: 'KPIs, trend, distributions, workload — all DB-derived', tag: 'Analytics', role: 'viewer', query: ['from', 'to', 'teamId'] },
  { m: 'get', path: `${ORG}/audit-logs`, summary: 'Audit log', tag: 'Audit', role: 'admin', query: ['page', 'pageSize', 'action', 'entityType', 'actorId', 'from', 'to'] },
  { m: 'get', path: `${ORG}/search`, summary: 'Global search (incidents, teams, members)', tag: 'Search', role: 'viewer', query: ['q'] },
  { m: 'get', path: `${ORG}/notifications`, summary: 'Own notifications', tag: 'Notifications', role: 'viewer', query: ['page', 'pageSize', 'unread'] },
  { m: 'post', path: `${ORG}/notifications/read-all`, summary: 'Mark all own notifications read', tag: 'Notifications', role: 'viewer' },
  { m: 'patch', path: `${ORG}/notifications/{notificationId}/read`, summary: 'Mark one notification read', tag: 'Notifications', role: 'viewer' },
  // ops
  { m: 'get', path: '/health', summary: 'Liveness', tag: 'Operations', auth: 'none' },
  { m: 'get', path: '/ready', summary: 'Readiness (MongoDB + Redis)', tag: 'Operations', auth: 'none' },
];

const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const enumOf = (v: readonly string[]) => ({ type: 'string', enum: v });

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of ops) {
    const params: unknown[] = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    for (const q of op.query ?? []) params.push({ name: q, in: 'query', required: false, schema: { type: 'string' } });
    const secured = op.auth !== 'none';
    const status = String(op.res ?? 200);
    (paths[op.path] ??= {})[op.m] = {
      tags: [op.tag],
      summary: op.role ? `${op.summary} (min role: ${op.role})` : op.summary,
      parameters: params,
      ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: ref(op.body) } } } } : {}),
      ...(secured ? { security: op.auth === 'cookie' ? [{ cookieAuth: [], csrfHeader: [] }] : [{ bearerAuth: [] }] } : {}),
      responses: {
        [status]: { description: 'Success' },
        ...(secured ? { '401': { description: 'Not authenticated', content: { 'application/json': { schema: ref('Error') } } } } : {}),
        ...(op.role ? { '403': { description: 'Role too low', content: { 'application/json': { schema: ref('Error') } } }, '404': { description: 'Not found (also returned for organizations you do not belong to)' } } : {}),
        '422': { description: 'Validation error', content: { 'application/json': { schema: ref('Error') } } },
      },
    };
  }

  const sev = ['low', 'medium', 'high', 'critical'] as const;
  return {
    openapi: '3.0.3',
    info: {
      title: 'OpsPilot AI API',
      version: '1.0.0',
      description:
        'Incident management API. All /orgs/{orgId}/* routes verify the caller\'s membership in the database on every request; the role is never taken from the client.\n\nErrors: `{ "error": { "code", "message", "details?", "requestId" } }`.',
    },
    servers: [{ url: '/api' }],
    tags: [...new Set(ops.map((o) => o.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'refresh_token' },
        csrfHeader: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } },
            },
          },
        },
        Register: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 10 }, inviteToken: { type: 'string' } },
        },
        Login: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
        CreateIncident: {
          type: 'object',
          required: ['title', 'description', 'category', 'severity'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            category: enumOf(['infrastructure', 'application', 'database', 'network', 'security', 'access', 'data', 'hardware', 'other']),
            severity: enumOf(sev),
            priority: enumOf(['low', 'medium', 'high', 'urgent']),
            teamId: { type: 'string', nullable: true },
            assigneeId: { type: 'string', nullable: true },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
        Transition: {
          type: 'object',
          required: ['status'],
          properties: {
            status: enumOf(['open', 'triaged', 'in_progress', 'blocked', 'resolved', 'closed']),
            resolutionSummary: { type: 'string', description: 'Required when status = resolved' },
            note: { type: 'string' },
          },
        },
        AiTriage: {
          type: 'object',
          required: ['title', 'description'],
          properties: { title: { type: 'string' }, description: { type: 'string' }, incidentId: { type: 'string' } },
        },
      },
    },
  };
}
