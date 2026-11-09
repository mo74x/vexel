export type RunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'DEAD_LETTER';

export type RunOutcome =
  | 'AUTO_SYNCED'
  | 'APPROVED_AS_IS'
  | 'APPROVED_WITH_OVERRIDE'
  | 'REJECTED'
  | 'EXPIRED'
  | 'UNDONE'
  | 'FAILED';

export type MembershipRole = 'ADMIN' | 'MANAGER' | 'SUPPORT';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  locale: string;
  isOperator: boolean;
  createdAt: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
  autoSyncThreshold: number;
  manualMinutesPerUpdate: number;
}

export interface TenantSettings {
  id: string;
  name: string;
  slug: string;
  hubspotPortalId?: string | null;
  hubspotConnected: boolean;
  whatsappPhoneId?: string | null;
  whatsappConnected: boolean;
  fallbackApprovalPhone?: string | null;
  autoSyncThreshold: number;
  manualMinutesPerUpdate: number;
  locale: string;
  timezone: string;
}

export interface UpdateSettingsPayload {
  name?: string;
  autoSyncThreshold?: number;
  fallbackApprovalPhone?: string | null;
  whatsappPhoneId?: string | null;
  rawWhatsAppToken?: string;
  manualMinutesPerUpdate?: number;
}

export interface MembershipSummary {
  id: string;
  tenantId: string;
  role: MembershipRole;
  tenant: TenantSummary;
}

export interface RepSummary {
  id: string;
  fullName: string;
  email: string;
  whatsappPhone?: string | null;
}

export interface RunListItem {
  id: string;
  workflowName: string;
  externalDealId?: string | null;
  status: RunStatus;
  outcome?: RunOutcome | null;
  confidenceScore?: number | null;
  senderPhone?: string | null;
  oneLineSummary: string;
  overriddenFields?: Record<string, { from: unknown; to: unknown }> | null;
  errorMessage?: string | null;
  decidedByRep?: RepSummary | null;
  decidedAt?: string | null;
  undoneAt?: string | null;
  createdAt: string;
  startedAt: string;
  completedAt?: string | null;
}

export interface RunListResponse {
  items: RunListItem[];
  nextCursor?: string | null;
  hasMore: boolean;
  limit: number;
}

export interface WorkflowStepItem {
  id: string;
  stepKey: string;
  status: string;
  durationMs?: number | null;
  executedAt: string;
  errorLog?: string | null;
  outputData?: Record<string, unknown> | null;
}

export interface RunDetail extends RunListItem {
  inputPayload: Record<string, unknown>;
  extractedData?: Record<string, unknown> | null;
  transcript?: string | null;
  undoAvailable: boolean;
  undoType?: 'STANDARD' | 'FORCE' | null;
  steps: WorkflowStepItem[];
}

export interface TenantRepRecord {
  id: string;
  tenantId: string;
  hubspotOwnerId: string;
  email: string;
  fullName: string;
  whatsappPhone?: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface DailyMetricBucket {
  date: string;
  total: number;
  autoSynced: number;
  approvedAsIs: number;
  approvedWithOverride: number;
  rejected: number;
  failed: number;
}

export interface RepActivitySummary {
  repId: string;
  fullName: string;
  email: string;
  totalRuns: number;
  autoSyncedCount: number;
  approvedCount: number;
  overrideCount: number;
  rejectedCount: number;
  averageConfidence?: number | null;
}

export interface MetricsSummary {
  window: {
    from: string;
    to: string;
  };
  totalRuns: number;
  runsByOutcome: Record<string, number>;
  runsByStatus: Record<string, number>;
  autoSyncRate: number;
  approvalRate: number;
  editRate: number;
  averageConfidence?: number | null;
  estimatedMinutesSaved: number;
  manualMinutesPerUpdate: number;
  totalCostUsd: number;
  costPerRun: number;
  dailyBuckets: DailyMetricBucket[];
  repsActivity: RepActivitySummary[];
}

export interface OnboardingStatus {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  hubspotConnected: boolean;
  hubspotPortalId?: string | null;
  whatsappConnected: boolean;
  whatsappPhoneId?: string | null;
  repsLinkedCount: number;
  totalRepsCount: number;
  firstRunReceived: boolean;
  firstRunAt?: string | null;
  autoSyncThreshold: number;
  manualMinutesPerUpdate: number;
}

export interface MeResponse {
  user: UserProfile;
  memberships: MembershipSummary[];
  activeTenant?: TenantSummary | null;
  currentRole?: MembershipRole | null;
}

export interface MagicLinkRequestPayload {
  email: string;
}

export interface MagicLinkVerifyPayload {
  token: string;
}

export interface MagicLinkVerifyResponse {
  message: string;
  user: UserProfile;
  token?: string;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  error?: string;
}

