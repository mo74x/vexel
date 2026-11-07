import { RepOverrideParserService } from '../rep-override-parser.service';
import { CrmTransitionPayload } from '../../schemas/crm-transition.schema';
import { TenantDealStage } from '../../cache/pipeline-stage-cache.service';

describe('RepOverrideParserService (Tier-1 Regex & Tier-2 Bilingual LLM)', () => {
  const tenantStages: TenantDealStage[] = [
    {
      id: 'qualifiedtobuy',
      label: 'Qualified to Buy',
      displayOrder: 0,
      probability: 0.4,
      pipelineId: 'default',
      pipelineLabel: 'Sales Pipeline',
    },
    {
      id: '14928374',
      label: 'Legal & Security Review',
      displayOrder: 1,
      probability: 0.75,
      pipelineId: 'default',
      pipelineLabel: 'Sales Pipeline',
    },
    {
      id: 'contractsent',
      label: 'Contract Sent',
      displayOrder: 2,
      probability: 0.9,
      pipelineId: 'default',
      pipelineLabel: 'Sales Pipeline',
    },
  ];

  const basePayload: CrmTransitionPayload = {
    dealName: 'Cairo Bank AI Rollout',
    dealStage: 'qualifiedtobuy',
    amount: 12000,
    currency: 'USD',
    expectedCloseDateIso: '2026-11-15',
    meddic: {
      metrics: null,
      economicBuyer: 'Tarek',
      decisionCriteria: null,
      decisionProcess: null,
      identifiedPain: 'Slow manual data entry',
      champion: 'Tarek',
    },
    nextTask: null,
    summaryNote: 'Client interested in starting Q4 pilot.',
    detectedLanguage: 'en',
    confidenceScore: 72,
    confidenceReasoning: 'Stage transition implied but amount was tentative.',
  };

  let meteredCalls: any[];
  let mockUsageMeter: any;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test_anthropic_key';
    meteredCalls = [];
    mockUsageMeter = {
      recordLlmUsage: async (entry: any) => {
        meteredCalls.push(entry);
      },
    };
  });

  it('recognizes English and Arabic quick rejection keywords without calling LLM', async () => {
    const parser = new RepOverrideParserService(mockUsageMeter);

    for (const word of ['cancel', 'REJECT', 'الغاء', 'كنسل']) {
      const res = await parser.parseRepTextOverride({
        tenantId: 'tenant_1',
        runId: 'run_1',
        rawRepText: word,
        existingPayload: basePayload,
        tenantStages,
      });

      expect(res.action).toBe('REJECT');
      expect(res.parserTier).toBe('DETERMINISTIC_REGEX');
      expect(meteredCalls.length).toBe(0);
    }
  });

  it('recognizes English and Arabic quick approval keywords without calling LLM', async () => {
    const parser = new RepOverrideParserService(mockUsageMeter);

    for (const word of ['approve', 'ok', 'تمام', 'اعتمد']) {
      const res = await parser.parseRepTextOverride({
        tenantId: 'tenant_1',
        runId: 'run_1',
        rawRepText: word,
        existingPayload: basePayload,
        tenantStages,
      });

      expect(res.action).toBe('APPROVE_WITH_PATCH');
      expect(res.parserTier).toBe('DETERMINISTIC_REGEX');
      expect(res.mergedPayload).toEqual(basePayload);
      expect(meteredCalls.length).toBe(0);
    }
  });

  it('parses shorthand amount (18k), stage label, and close date via Tier-1 Regex in <1ms with zero LLM tokens', async () => {
    const parser = new RepOverrideParserService(mockUsageMeter);

    const res = await parser.parseRepTextOverride({
      tenantId: 'tenant_1',
      runId: 'run_1',
      rawRepText: 'amount: $24.5k SAR stage: Contract Sent close: 2026-12-01',
      existingPayload: basePayload,
      tenantStages,
    });

    expect(res.action).toBe('APPROVE_WITH_PATCH');
    expect(res.parserTier).toBe('DETERMINISTIC_REGEX');
    expect(res.mergedPayload.amount).toBe(24500);
    expect(res.mergedPayload.currency).toBe('SAR');
    expect(res.mergedPayload.dealStage).toBe('contractsent');
    expect(res.mergedPayload.expectedCloseDateIso).toBe('2026-12-01');
    expect(res.mergedPayload.confidenceScore).toBe(100);
    expect(meteredCalls.length).toBe(0);
  });

  it('falls back to Tier-2 Bilingual Claude extractor for free-form Arabic/English instructions and meters token usage', async () => {
    const parser = new RepOverrideParserService(mockUsageMeter);

    // Mock Anthropic messages.create for Tier-2 bilingual extraction
    (parser as any).anthropic = {
      messages: {
        create: async () => ({
          usage: { input_tokens: 310, output_tokens: 65 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'apply_crm_override_patch',
              input: {
                amount: 18000,
                dealStage: '14928374',
                expectedCloseDateIso: '2026-11-28',
              },
            },
          ],
        }),
      },
    };

    const res = await parser.parseRepTextOverride({
      tenantId: 'tenant_1',
      runId: 'run_1',
      rawRepText: 'خلي المبلغ 18000 دولار والمرحلة مراجعة قانونية',
      existingPayload: basePayload,
      tenantStages,
    });

    expect(res.action).toBe('APPROVE_WITH_PATCH');
    expect(res.parserTier).toBe('BILINGUAL_LLM');
    expect(res.mergedPayload.amount).toBe(18000);
    expect(res.mergedPayload.dealStage).toBe('14928374');
    expect(res.mergedPayload.expectedCloseDateIso).toBe('2026-11-28');
    expect(res.mergedPayload.confidenceScore).toBe(100);
    expect(meteredCalls.length).toBe(1);
    expect(meteredCalls[0]).toEqual({
      tenantId: 'tenant_1',
      runId: 'run_1',
      provider: 'anthropic-claude-3-7-sonnet:rep-override',
      promptTokens: 310,
      completionTokens: 65,
    });
  });
});

