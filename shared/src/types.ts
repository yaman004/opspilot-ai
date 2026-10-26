import type { IncidentStatus, NotificationType, Priority, Role, Severity } from './constants';
import type { AiTriageResult, EscalationRule } from './schemas';
import type { SlaTargets } from './sla';

/** DTOs returned by the API (dates are ISO strings on the wire). */
export interface UserDto {
  id: string;
  name: string;
  email: string;
  timezone: string;
  themePreference: 'light' | 'dark' | 'system';
  createdAt: string;
}

export interface UserRefDto {
  id: string;
  name: string;
  email?: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  settings: { allowedEmailDomains: string[]; defaultIncidentCategory?: string };
  createdAt: string;
}

export interface MembershipDto {
  id: string;
  organization: OrganizationDto;
  role: Role;
}

export interface MemberDto {
  id: string; // membership id
  user: UserDto | (UserRefDto & { createdAt?: string });
  role: Role;
  teamIds: string[];
  createdAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  /** Only present immediately after creation in non-production, to allow testing without email. */
  devAcceptUrl?: string;
}

export interface TeamDto {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  createdAt: string;
}

export interface SlaStateDto {
  responseDueAt: string | null;
  resolutionDueAt: string | null;
  firstRespondedAt: string | null;
  response: 'met' | 'met_late' | 'pending' | 'breached';
  resolution: 'met' | 'met_late' | 'pending' | 'breached';
}

export interface IncidentDto {
  id: string;
  number: number;
  key: string; // INC-1001
  title: string;
  description: string;
  category: string;
  severity: Severity;
  priority: Priority;
  status: IncidentStatus;
  reporter: UserRefDto | null;
  assignee: UserRefDto | null;
  team: { id: string; name: string } | null;
  tags: string[];
  sla: SlaStateDto;
  resolutionSummary: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  reopenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommentDto {
  id: string;
  incidentId: string;
  author: UserRefDto | null;
  body: string;
  internal: boolean;
  createdAt: string;
}

export interface ActivityDto {
  id: string;
  action: string;
  actor: UserRefDto | null;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  incidentId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SlaPolicyDto {
  id: string;
  name: string;
  targets: SlaTargets;
  escalationRules: EscalationRule[];
  isActive: boolean;
  isDefault: boolean;
  updatedAt: string;
}

export interface AiAnalysisDto {
  id: string;
  incidentId: string | null;
  provider: string;
  model: string;
  /** True when produced by the built-in mock provider — NOT a real AI model. */
  isMock: boolean;
  status: 'succeeded' | 'failed';
  result: AiTriageResult | null;
  errorCode: string | null;
  errorMessage: string | null;
  appliedFields: string[];
  createdAt: string;
}

export interface AttachmentDto {
  id: string;
  incidentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy: UserRefDto | null;
  createdAt: string;
}

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: UserRefDto | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface AuthResponse {
  accessToken: string;
  expiresInSeconds: number;
  user: UserDto;
  memberships: MembershipDto[];
}
