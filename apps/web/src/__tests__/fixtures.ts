import type { RunDetail, RunListItem, TenantRepRecord } from '@/lib/types';

export const mockRepsFixture: TenantRepRecord[] = [
  {
    id: 'rep_1',
    tenantId: 'tenant_acme',
    hubspotOwnerId: 'owner_101',
    email: 'kareem@acme.com',
    fullName: 'Kareem Tarek',
    whatsappPhone: '+2010****567',
    isActive: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'rep_2',
    tenantId: 'tenant_acme',
    hubspotOwnerId: 'owner_102',
    email: 'sarah@acme.com',
    fullName: 'Sarah Nabil',
    whatsappPhone: '+2011****890',
    isActive: true,
    updatedAt: new Date().toISOString(),
  },
];

export const mockWaitingRunFixture: RunDetail = {
  id: 'run_waiting_1',
  workflowName: 'WhatsApp Deal Pipeline',
  externalDealId: '987654321',
  status: 'WAITING_APPROVAL',
  outcome: null,
  confidenceScore: 72,
  senderPhone: '+201012345678',
  oneLineSummary: 'Updated Stage to Presentation Scheduled ($45,000)',
  overriddenFields: null,
  errorMessage: null,
  decidedByRep: {
    id: 'rep_1',
    fullName: 'Kareem Tarek',
    email: 'kareem@acme.com',
  },
  decidedAt: null,
  undoneAt: null,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  inputPayload: { text: 'Agreed on demo next Tuesday for 45k' },
  extractedData: {
    deal_stage: 'Presentation Scheduled',
    amount: 45000,
    expected_close_date: '2026-12-15',
  },
  transcript: 'اتفقنا على موعد العرض التوضيحي يوم الثلاثاء القادم بقيمة 45000 دولار',
  undoAvailable: false,
  undoType: null,
  steps: [
    {
      id: 'step_1',
      stepKey: '1_audio_transcription',
      status: 'COMPLETED',
      durationMs: 420,
      executedAt: new Date().toISOString(),
    },
    {
      id: 'step_2',
      stepKey: '2_zod_extraction',
      status: 'COMPLETED',
      durationMs: 830,
      executedAt: new Date().toISOString(),
    },
    {
      id: 'step_3',
      stepKey: '3_approval_check',
      status: 'COMPLETED',
      durationMs: 95,
      executedAt: new Date().toISOString(),
    },
  ],
};

export const mockCompletedRunFixture: RunDetail = {
  ...mockWaitingRunFixture,
  id: 'run_completed_1',
  status: 'COMPLETED',
  outcome: 'AUTO_SYNCED',
  confidenceScore: 94,
  undoAvailable: true,
  undoType: 'STANDARD',
};

export const mockOverriddenRunFixture: RunDetail = {
  ...mockWaitingRunFixture,
  id: 'run_override_1',
  status: 'COMPLETED',
  outcome: 'APPROVED_WITH_OVERRIDE',
  confidenceScore: 76,
  overriddenFields: {
    amount: { from: 45000, to: 50000 },
  },
  undoAvailable: true,
};

export const mockFailedRunFixture: RunDetail = {
  ...mockWaitingRunFixture,
  id: 'run_failed_1',
  status: 'FAILED',
  outcome: 'FAILED',
  confidenceScore: 40,
  errorMessage: 'HubSpot API rate limit exhausted',
  undoAvailable: false,
};

export const mockLabelsFixture = {
  statusChips: {
    PENDING: 'Queued',
    RUNNING: 'Processing',
    WAITING_APPROVAL: 'Waiting for Rep',
    COMPLETED: 'Synced',
    FAILED: 'Action Required',
    DEAD_LETTER: 'Failed',
  },
  outcomeChips: {
    AUTO_SYNCED: 'Auto-Synced',
    APPROVED_AS_IS: 'Approved as Transcribed',
    APPROVED_WITH_OVERRIDE: 'Approved with Edits',
    REJECTED: 'Declined by Rep',
    EXPIRED: 'Expired (24h)',
    UNDONE: 'Reverted',
    FAILED: 'Failed',
  },
};

