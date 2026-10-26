import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';
import {
  CATEGORIES,
  INCIDENT_STATUSES,
  NOTIFICATION_TYPES,
  PRIORITIES,
  ROLES,
  SEVERITIES,
} from '@opspilot/shared';
import { env } from '../config/env';

const oidRef = (ref: string, required = false) => ({ type: Schema.Types.ObjectId, ref, required });
const opts = { timestamps: true } as const;

/* -------------------------------- User -------------------------------- */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    timezone: { type: String, default: 'UTC' },
    themePreference: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
  },
  opts,
);
export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const User = mongoose.model('User', userSchema);

/* ----------------------------- Organization --------------------------- */
const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    timezone: { type: String, default: 'UTC' },
    settings: {
      allowedEmailDomains: { type: [String], default: [] },
      defaultIncidentCategory: { type: String, enum: CATEGORIES, default: 'other' },
    },
    incidentCounter: { type: Number, default: 1000 },
    createdBy: oidRef('User', true),
  },
  opts,
);
export type OrganizationDoc = InferSchemaType<typeof organizationSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const Organization = mongoose.model('Organization', organizationSchema);

/* ------------------------- OrganizationMembership --------------------- */
const membershipSchema = new Schema(
  {
    userId: oidRef('User', true),
    organizationId: oidRef('Organization', true),
    role: { type: String, enum: ROLES, required: true },
  },
  opts,
);
membershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
membershipSchema.index({ organizationId: 1, role: 1 });
export type MembershipDoc = InferSchemaType<typeof membershipSchema> & { _id: Types.ObjectId; createdAt: Date };
export const Membership = mongoose.model('OrganizationMembership', membershipSchema);

/* --------------------------------- Team -------------------------------- */
const teamSchema = new Schema(
  {
    organizationId: oidRef('Organization', true),
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300 },
    memberIds: [oidRef('User')],
  },
  opts,
);
teamSchema.index({ organizationId: 1, name: 1 }, { unique: true });
export type TeamDoc = InferSchemaType<typeof teamSchema> & { _id: Types.ObjectId; createdAt: Date };
export const Team = mongoose.model('Team', teamSchema);

/* ------------------------------- Incident ------------------------------ */
const incidentSchema = new Schema(
  {
    organizationId: oidRef('Organization', true),
    number: { type: Number, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 10000 },
    category: { type: String, enum: CATEGORIES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    priority: { type: String, enum: PRIORITIES, required: true },
    /** Numeric ranks so severity/priority sort by importance rather than alphabetically. */
    severityRank: { type: Number, required: true },
    priorityRank: { type: Number, required: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: 'open' },
    reporterId: oidRef('User', true),
    assigneeId: { ...oidRef('User'), default: null },
    teamId: { ...oidRef('Team'), default: null },
    tags: { type: [String], default: [] },
    sla: {
      responseDueAt: { type: Date, default: null },
      resolutionDueAt: { type: Date, default: null },
      firstRespondedAt: { type: Date, default: null },
      /** Escalation rule ids that have already fired — makes alerts idempotent. */
      alertsSent: { type: [String], default: [] },
    },
    resolutionSummary: { type: String, default: null, maxlength: 5000 },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    reopenCount: { type: Number, default: 0 },
  },
  opts,
);
incidentSchema.index({ organizationId: 1, number: 1 }, { unique: true });
incidentSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
incidentSchema.index({ organizationId: 1, assigneeId: 1, status: 1 });
incidentSchema.index({ organizationId: 1, severity: 1, status: 1 });
incidentSchema.index({ organizationId: 1, teamId: 1, status: 1 });
incidentSchema.index({ organizationId: 1, tags: 1 });
incidentSchema.index({ organizationId: 1, createdAt: -1 });
incidentSchema.index({ status: 1, 'sla.resolutionDueAt': 1 });
export type IncidentDoc = InferSchemaType<typeof incidentSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export const Incident = mongoose.model('Incident', incidentSchema);

/* ------------------------------- Comment ------------------------------- */
const commentSchema = new Schema(
  {
    organizationId: oidRef('Organization', true),
    incidentId: oidRef('Incident', true),
    authorId: oidRef('User', true),
    body: { type: String, required: true, maxlength: 5000 },
    internal: { type: Boolean, default: false },
  },
  opts,
);
commentSchema.index({ organizationId: 1, incidentId: 1, createdAt: 1 });
export type CommentDoc = InferSchemaType<typeof commentSchema> & { _id: Types.ObjectId; createdAt: Date };
export const Comment = mongoose.model('Comment', commentSchema);

/* ----------------------------- Notification ---------------------------- */
const notificationSchema = new Schema(
  {
    organizationId: oidRef('Organization', true),
    userId: oidRef('User', true),
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 1000 },
    incidentId: { ...oidRef('Incident'), default: null },
    /** Unique per user. Used to guarantee an automated alert is delivered at most once. */
    dedupeKey: { type: String, required: true },
    readAt: { type: Date, default: null },
  },
  opts,
);
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ organizationId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, userId: 1, readAt: 1 });
export type NotificationDoc = InferSchemaType<typeof notificationSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const Notification = mongoose.model('Notification', notificationSchema);

/* -------------------------------- AuditLog ----------------------------- */
const auditLogSchema = new Schema(
  {
    organizationId: oidRef('Organization', true),
    actorId: { ...oidRef('User'), default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
    requestId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ organizationId: 1, createdAt: -1 });
auditLogSchema.index({ organizationId: 1, entityType: 1, entityId: 1, createdAt: 1 });
auditLogSchema.index({ organizationId: 1, action: 1, createdAt: -1 });
export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & { _id: Types.ObjectId; createdAt: Date };
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);

/* -------------------------------- SLAPolicy ---------------------------- */
const slaTargetSchema = new Schema(
  { responseMinutes: { type: Number, required: true }, resolutionMinutes: { type: Number, required: true } },
  { _id: false },
);
const slaPolicySchema = new Schema(
  {
    organizationId: oidRef('Organization', true),
    name: { type: String, required: true, maxlength: 80 },
    targets: {
      low: slaTargetSchema,
      medium: slaTargetSchema,
      high: slaTargetSchema,
      critical: slaTargetSchema,
    },
    escalationRules: { type: [Schema.Types.Mixed], default: [] },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: true },
    updatedBy: { ...oidRef('User'), default: null },
  },
  opts,
);
slaPolicySchema.index({ organizationId: 1, isDefault: 1 });
export type SlaPolicyDoc = InferSchemaType<typeof slaPolicySchema> & {
  _id: Types.ObjectId;
  updatedAt: Date;
};
export const SlaPolicy = mongoose.model('SLAPolicy', slaPolicySchema);

/* ------------------------------- Invitation ---------------------------- */
const invitationSchema = new Schema(
  {
    organizationId: oidRef('Organization', true),
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ROLES, required: true },
    teamIds: [oidRef('Team')],
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'accepted', 'revoked'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    invitedBy: oidRef('User', true),
    acceptedBy: { ...oidRef('User'), default: null },
  },
  opts,
);
invitationSchema.index({ organizationId: 1, email: 1, status: 1 });
export type InvitationDoc = InferSchemaType<typeof invitationSchema> & { _id: Types.ObjectId; createdAt: Date };
export const Invitation = mongoose.model('Invitation', invitationSchema);

/* ----------------------------- RefreshSession -------------------------- */
const refreshSessionSchema = new Schema(
  {
    userId: oidRef('User', true),
    /** All rotated tokens of one login share a family so reuse can revoke the whole chain. */
    familyId: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  opts,
);
refreshSessionSchema.index({ familyId: 1, revokedAt: 1 });
refreshSessionSchema.index({ userId: 1 });
// Expired sessions are purged by MongoDB itself. Disabled only for MongoDB-compatible stores without TTL support.
if (env.MONGO_TTL_INDEXES) refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type RefreshSessionDoc = InferSchemaType<typeof refreshSessionSchema> & { _id: Types.ObjectId };
export const RefreshSession = mongoose.model('RefreshSession', refreshSessionSchema);

/* -------------------------------- AIAnalysis --------------------------- */
const aiAnalysisSchema = new Schema(
  {
    organizationId: oidRef('Organization', true),
    incidentId: { ...oidRef('Incident'), default: null },
    requestedBy: oidRef('User', true),
    provider: { type: String, required: true },
    model: { type: String, required: true },
    isMock: { type: Boolean, required: true },
    status: { type: String, enum: ['succeeded', 'failed'], required: true },
    inputTitle: { type: String, required: true, maxlength: 200 },
    inputDescription: { type: String, required: true, maxlength: 10000 },
    result: { type: Schema.Types.Mixed, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    latencyMs: { type: Number, default: 0 },
    appliedFields: { type: [String], default: [] },
  },
  opts,
);
aiAnalysisSchema.index({ organizationId: 1, createdAt: -1 });
aiAnalysisSchema.index({ organizationId: 1, incidentId: 1, createdAt: -1 });
export type AiAnalysisDoc = InferSchemaType<typeof aiAnalysisSchema> & { _id: Types.ObjectId; createdAt: Date };
export const AiAnalysis = mongoose.model('AIAnalysis', aiAnalysisSchema);

/* ------------------------------- Attachment ---------------------------- */
const attachmentSchema = new Schema(
  {
    organizationId: oidRef('Organization', true),
    incidentId: oidRef('Incident', true),
    uploadedBy: oidRef('User', true),
    fileName: { type: String, required: true, maxlength: 255 },
    storageKey: { type: String, required: true },
    storageDriver: { type: String, enum: ['local', 's3'], required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    checksum: { type: String, required: true },
  },
  opts,
);
attachmentSchema.index({ organizationId: 1, incidentId: 1, createdAt: 1 });
export type AttachmentDoc = InferSchemaType<typeof attachmentSchema> & { _id: Types.ObjectId; createdAt: Date };
export const Attachment = mongoose.model('Attachment', attachmentSchema);

export async function syncAllIndexes(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}
