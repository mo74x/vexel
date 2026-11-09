import { sanitizeRawToolInput } from '../payload-normalizer';
import { ZodExtractorService } from '../zod-extractor.service';
import { TenantDealStage } from '../../cache/pipeline-stage-cache.service';

const SAMPLE_STAGES: TenantDealStage[] = [
  {
    id: 'appointmentscheduled',
    label: 'Appointment Scheduled',
    displayOrder: 0,
    probability: 0.2,
    pipelineId: 'default',
    pipelineLabel: 'Sales Pipeline',
  },
  {
    id: 'contractsent',
    label: 'Contract Sent',
    displayOrder: 1,
    probability: 0.9,
    pipelineId: 'default',
    pipelineLabel: 'Sales Pipeline',
  },
];

describe('PayloadNormalizer & ZodExtractorService', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  });

  it('sanitizes stringified nulls, formatted amounts, ISO timestamps, confidence bounds, and stage labels', () => {
    const cleaned = sanitizeRawToolInput(
      {
        dealName: '  Acme Expansion ',
        dealStage: 'Contract Sent',
        amount: '$48,500.00',
        expectedCloseDateIso: '2026-12-15T14:30:00.000Z',
        competitorMentioned: 'N/A',
        confidenceScore: 112.4,
      },
      SAMPLE_STAGES,
    );

    expect(cleaned).toEqual({
      dealName: 'Acme Expansion',
      dealStage: 'contractsent',
      amount: 48500,
      expectedCloseDateIso: '2026-12-15',
      competitorMentioned: null,
      confidenceScore: 100,
    });
  });

  it('self-heals across repair turns when initial Claude tool_use output violates the Zod schema', async () => {
    const meteredCalls: any[] = [];
    const mockUsageMeter: any = {
      recordLlmUsage: async (params: any) => {
        meteredCalls.push(params);
      },
    };
    const mockStageCache: any = {
      getTenantStages: async () => SAMPLE_STAGES,
    };

    const extractor = new ZodExtractorService(mockUsageMeter, mockStageCache);
    let claudeTurn = 0;

    (extractor as any).anthropic = {
      messages: {
        create: async () => {
          claudeTurn += 1;
          if (claudeTurn === 1) {
            // Turn 1: Invalid dealStage ("invalid_stage_id") triggers Stage 2 Zod repair
            return {
              usage: { input_tokens: 400, output_tokens: 150 },
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_turn_1',
                  name: 'commit_crm_state_transition',
                  input: {
                    dealName: 'Acme Deal',
                    dealStage: 'non_existent_stage',
                    amount: 50000,
                    currency: 'USD',
                    expectedCloseDateIso: '2026-12-01',
                    summaryNote: 'Customer requested contract after demo call.',
                    meddic: {
                      metrics: null,
                      economicBuyer: 'Layla',
                      decisionCriteria: null,
                      decisionProcess: null,
                      identifiedPain: 'Manual CRM entry',
                      champion: 'Omar',
                    },
                    nextTask: null,
                    detectedLanguage: 'en',
                    confidenceScore: 91,
                    confidenceReasoning: 'Explicit contract request and budget confirmed.',
                  },
                },
              ],
            };
          }

          // Turn 2: Claude repairs dealStage to "contractsent"
          return {
            usage: { input_tokens: 520, output_tokens: 140 },
            content: [
              {
                type: 'tool_use',
                id: 'toolu_turn_2',
                name: 'commit_crm_state_transition',
                input: {
                  dealName: 'Acme Deal',
                  dealStage: 'contractsent',
                  amount: 50000,
                  currency: 'USD',
                  expectedCloseDateIso: '2026-12-01',
                  summaryNote: 'Customer requested contract after demo call.',
                  meddic: {
                    metrics: null,
                    economicBuyer: 'Layla',
                    decisionCriteria: null,
                    decisionProcess: null,
                    identifiedPain: 'Manual CRM entry',
                    champion: 'Omar',
                  },
                  nextTask: null,
                  detectedLanguage: 'en',
                  confidenceScore: 91,
                  confidenceReasoning: 'Explicit contract request and budget confirmed.',
                },
              },
            ],
          };
        },
      },
    };

    const result = await extractor.extractTransition(
      'tenant_acme',
      'run_55',
      'hs_token',
      {
        senderPhone: '+201001234567',
        messageCount: 2,
        totalAudioSeconds: 14,
        mergedTranscript: '[10:00:00 TEXT]: Please send the contract for $50k.',
      },
      {
        contactId: 'c_1',
        contactName: 'Omar',
        companyName: 'Acme',
        activeDealId: 'd_1',
        currentDealName: 'Acme Deal',
        currentDealStage: 'appointmentscheduled',
        currentAmount: 40000,
      },
    );

    expect(claudeTurn).toBe(2);
    expect(result.dealStage).toBe('contractsent');
    expect(result.amount).toBe(50000);
    expect(meteredCalls.length).toBe(2);
    expect(meteredCalls[0].provider).toBe('anthropic:claude-sonnet-4-20250514');
    expect(meteredCalls[1].provider).toBe('anthropic:claude-sonnet-4-20250514:repair-1');
  });

  it('respects configurable ANTHROPIC_MODEL environment variable and constructor override', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-3-7-sonnet-20250219';
    const meteredCalls: any[] = [];
    const mockUsageMeter: any = {
      recordLlmUsage: async (params: any) => {
        meteredCalls.push(params);
      },
    };
    const mockStageCache: any = {
      getTenantStages: async () => SAMPLE_STAGES,
    };

    const extractor = new ZodExtractorService(mockUsageMeter, mockStageCache);
    let requestedModel = '';
    (extractor as any).anthropic = {
      messages: {
        create: async (args: any) => {
          requestedModel = args.model;
          return {
            usage: { input_tokens: 300, output_tokens: 110 },
            content: [
              {
                type: 'tool_use',
                id: 'toolu_custom',
                name: 'commit_crm_state_transition',
                input: {
                  dealName: 'Acme Deal',
                  dealStage: 'contractsent',
                  amount: 50000,
                  currency: 'USD',
                  expectedCloseDateIso: '2026-12-01',
                  summaryNote: 'Customer requested contract.',
                  meddic: {
                    metrics: null,
                    economicBuyer: 'Layla',
                    decisionCriteria: null,
                    decisionProcess: null,
                    identifiedPain: 'Manual CRM entry',
                    champion: 'Omar',
                  },
                  nextTask: null,
                  detectedLanguage: 'en',
                  confidenceScore: 95,
                  confidenceReasoning: 'Explicit contract request.',
                },
              },
            ],
          };
        },
      },
    };

    await extractor.extractTransition(
      'tenant_acme',
      'run_56',
      'hs_token',
      {
        senderPhone: '+201001234567',
        messageCount: 1,
        totalAudioSeconds: 10,
        mergedTranscript: '[10:00:00 TEXT]: Send contract for $50k.',
      },
      {
        contactId: 'c_1',
        contactName: 'Omar',
        companyName: 'Acme',
        activeDealId: 'd_1',
        currentDealName: 'Acme Deal',
        currentDealStage: 'appointmentscheduled',
        currentAmount: 40000,
      },
    );

    expect(requestedModel).toBe('claude-3-7-sonnet-20250219');
    expect(meteredCalls[0].provider).toBe('anthropic:claude-3-7-sonnet-20250219');
    delete process.env.ANTHROPIC_MODEL;
  });
});
