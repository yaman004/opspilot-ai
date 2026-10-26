import { z } from 'zod';
import { CATEGORIES, INCIDENT_STATUSES, PRIORITIES, ROLES, SEVERITIES } from './constants';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/\d/, 'Password needs a number');

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email').max(254);

/* ----------------------------- auth ----------------------------- */
export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(80),
  email: emailSchema,
  password: passwordSchema,
  inviteToken: z.string().min(10).max(200).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  themePreference: z.enum(['light', 'dark', 'system']).optional(),
});

/* ------------------------ organizations ------------------------- */
export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Use 3-40 lowercase letters, numbers or dashes')
    .optional(),
});
export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  settings: z
    .object({
      allowedEmailDomains: z.array(z.string().trim().toLowerCase().max(100)).max(20).optional(),
      defaultIncidentCategory: z.enum(CATEGORIES).optional(),
    })
    .optional(),
});

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLES).refine((r) => r !== 'owner', 'Invite as admin, agent or viewer'),
  teamIds: z.array(objectId).max(20).optional(),
});
export const updateMemberRoleSchema = z.object({ role: z.enum(ROLES) });
export const acceptInvitationSchema = z.object({ token: z.string().min(10).max(200) });

/* ------------------------------ teams --------------------------- */
export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
});
export const updateTeamSchema = createTeamSchema.partial();
export const teamMemberSchema = z.object({ userId: objectId });

/* ---------------------------- incidents ------------------------- */
const tagsSchema = z
  .array(z.string().trim().toLowerCase().min(1).max(30))
  .max(10)
  .transform((tags) => Array.from(new Set(tags)));

export const createIncidentSchema = z.object({
  title: z.string().trim().min(3, 'Title is too short').max(200),
  description: z.string().trim().min(1, 'Description is required').max(10000),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  priority: z.enum(PRIORITIES).optional(),
  teamId: objectId.nullable().optional(),
  assigneeId: objectId.nullable().optional(),
  tags: tagsSchema.optional(),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const updateIncidentSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(1).max(10000),
    category: z.enum(CATEGORIES),
    severity: z.enum(SEVERITIES),
    priority: z.enum(PRIORITIES),
    teamId: objectId.nullable(),
    tags: tagsSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;

export const assignIncidentSchema = z.object({ assigneeId: objectId.nullable() });

export const transitionIncidentSchema = z.object({
  status: z.enum(INCIDENT_STATUSES),
  resolutionSummary: z.string().trim().min(5, 'Describe how it was resolved').max(5000).optional(),
  note: z.string().trim().max(1000).optional(),
});
export type TransitionIncidentInput = z.infer<typeof transitionIncidentSchema>;

export const listIncidentsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.string().optional(), // comma separated
  severity: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
  assigneeId: z.string().optional(), // id | 'me' | 'unassigned'
  teamId: z.string().optional(),
  reporterId: z.string().optional(),
  tag: z.string().trim().toLowerCase().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sort: z
    .enum(['createdAt', 'updatedAt', 'severity', 'priority', 'status', 'number', 'resolutionDueAt'])
    .default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(5000),
  internal: z.boolean().default(false),
});

/* ------------------------------ SLA ----------------------------- */
const slaTargetSchema = z.object({
  responseMinutes: z.number().int().min(1).max(60 * 24 * 30),
  resolutionMinutes: z.number().int().min(1).max(60 * 24 * 365),
});
export const slaTargetsSchema = z
  .object({
    low: slaTargetSchema,
    medium: slaTargetSchema,
    high: slaTargetSchema,
    critical: slaTargetSchema,
  })
  .superRefine((t, ctx) => {
    for (const sev of SEVERITIES) {
      if (t[sev].resolutionMinutes < t[sev].responseMinutes) {
        ctx.addIssue({
          code: 'custom',
          path: [sev, 'resolutionMinutes'],
          message: 'Resolution target must be at least the response target',
        });
      }
    }
  });

export const escalationRuleSchema = z.object({
  id: z.string().min(1).max(40),
  trigger: z.enum(['response_warning', 'response_breach', 'resolution_warning', 'resolution_breach']),
  /** Only used by warning triggers: percentage of the window elapsed. */
  thresholdPercent: z.number().int().min(10).max(99).optional(),
  notifyRoles: z.array(z.enum(['owner', 'admin', 'agent'])).max(3).default([]),
  notifyAssignee: z.boolean().default(true),
  notifyTeamMembers: z.boolean().default(false),
  /** Raise priority by one step when this rule fires. */
  bumpPriority: z.boolean().default(false),
});
export type EscalationRule = z.infer<typeof escalationRuleSchema>;

export const upsertSlaPolicySchema = z.object({
  name: z.string().trim().min(2).max(80),
  targets: slaTargetsSchema,
  escalationRules: z.array(escalationRuleSchema).max(12).default([]),
  isActive: z.boolean().default(true),
});
export type UpsertSlaPolicyInput = z.infer<typeof upsertSlaPolicySchema>;

/* ------------------------------- AI ------------------------------ */
export const aiTriageRequestSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10, 'Add more detail so triage can help').max(10000),
  incidentId: objectId.optional(),
});

/** The only shape an AI provider is allowed to return. Everything else is rejected. */
export const aiTriageResultSchema = z.object({
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  priority: z.enum(PRIORITIES),
  suggestedTeam: z.string().trim().max(60).nullable(),
  summary: z.string().trim().min(5).max(600),
  diagnosticQuestions: z.array(z.string().trim().min(3).max(300)).min(1).max(8),
  troubleshootingSteps: z.array(z.string().trim().min(3).max(400)).min(1).max(10),
  confidence: z.number().min(0).max(1),
});
export type AiTriageResult = z.infer<typeof aiTriageResultSchema>;

export const AI_APPLY_FIELDS = ['category', 'severity', 'priority', 'team', 'notes'] as const;
export const applyAiSuggestionsSchema = z.object({
  fields: z.array(z.enum(AI_APPLY_FIELDS)).min(1, 'Choose at least one suggestion'),
});

/* ---------------------------- analytics -------------------------- */
export const analyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  teamId: objectId.optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/* --------------------------- pagination -------------------------- */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(40).optional(),
  actorId: objectId.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export const notificationQuerySchema = paginationQuerySchema.extend({
  unread: z.enum(['true', 'false']).optional(),
});
