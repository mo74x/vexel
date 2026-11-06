import Anthropic from '@anthropic-ai/sdk';
import {
  buildTenantCrmTransitionSchema,
  CrmTransitionPayload,
} from '../schemas/crm-transition.schema';
import { TenantDealStage } from '../cache/pipeline-stage-cache.service';
import { sanitizeRawToolInput } from '../llm/payload-normalizer';
import { UsageMeterService } from '../meter/usage-meter.service';

export interface ParsedOverrideResult {
  mergedPayload: CrmTransitionPayload;
  editedPatch: Partial<CrmTransitionPayload>;
  parserTier: 'DETERMINISTIC_REGEX' | 'BILINGUAL_LLM';
  action: 'APPROVE_WITH_PATCH' | 'REJECT';
}

export class RepOverrideParserService {
  private readonly anthropic: Anthropic;

  constructor(private readonly usageMeter: UsageMeterService) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async parseRepTextOverride(params: {
    tenantId: string;
    runId: string;
    rawRepText: string;
    existingPayload: CrmTransitionPayload;
    tenantStages: TenantDealStage[];
    referenceNow?: Date;
  }): Promise<ParsedOverrideResult> {
    const {
      tenantId,
      runId,
      rawRepText,
      existingPayload,
      tenantStages,
      referenceNow = new Date(),
    } = params;

    const trimmed = rawRepText.trim();

    // 1. Check for quick text rejection keywords ("cancel", "discard", "reject", "الغاء")
    if (/^(cancel|discard|reject|ignore|الغاء|إلغاء|كنسل)$/i.test(trimmed)) {
      return {
        mergedPayload: existingPayload,
        editedPatch: {},
        parserTier: 'DETERMINISTIC_REGEX',
        action: 'REJECT',
      };
    }

    // 2. Check for quick text approval without changes ("approve", "sync", "ok", "تمام", "اعتمد")
    if (/^(approve|sync|ok|yes|confirm|تمام|موافق|اعتمد)$/i.test(trimmed)) {
      return {
        mergedPayload: existingPayload,
        editedPatch: {},
        parserTier: 'DETERMINISTIC_REGEX',
        action: 'APPROVE_WITH_PATCH',
      };
    }

    const dynamicSchema = buildTenantCrmTransitionSchema(tenantStages);

    // 3. TIER 1: Try Zero-Token Deterministic Shorthand Parser (<1ms)
    const regexPatch = this.tryDeterministicRegexParse(trimmed, tenantStages);
    if (regexPatch) {
      const candidateMerge = {
        ...existingPayload,
        ...regexPatch,
        confidenceScore: 100, // Rep explicitly verified & overrode
      };

      const validated = dynamicSchema.safeParse(candidateMerge);
      if (validated.success) {
        return {
          mergedPayload: validated.data,
          editedPatch: { ...regexPatch, confidenceScore: 100 },
          parserTier: 'DETERMINISTIC_REGEX',
          action: 'APPROVE_WITH_PATCH',
        };
      }
    }

    // 4. TIER 2: Fallback to Bilingual Claude Delta Extractor for free-form Arabic/English
    const llmPatch = await this.extractDeltaViaLlm(
      tenantId,
      runId,
      trimmed,
      existingPayload,
      tenantStages,
      referenceNow,
    );

    const sanitizedPatch = sanitizeRawToolInput(llmPatch, tenantStages);
    const mergedCandidate = {
      ...existingPayload,
      ...Object.fromEntries(
        Object.entries(sanitizedPatch).filter(([, v]) => v !== null && v !== undefined),
      ),
      meddic: {
        ...existingPayload.meddic,
        ...(sanitizedPatch.meddic ?? {}),
      },
      confidenceScore: 100,
    };

    const finalValidation = dynamicSchema.parse(mergedCandidate);

    return {
      mergedPayload: finalValidation,
      editedPatch: { ...sanitizedPatch, confidenceScore: 100 },
      parserTier: 'BILINGUAL_LLM',
      action: 'APPROVE_WITH_PATCH',
    };
  }

  /**
   * Parses shorthand strings like:
   * - "Amount 18000 stage contractsent"
   * - "amount: 18k USD, stage: Legal Review, close: 2026-11-25"
   */
  private tryDeterministicRegexParse(
    text: string,
    tenantStages: TenantDealStage[],
  ): Partial<CrmTransitionPayload> | null {
    // Bail out to Tier-2 LLM if message contains Arabic script or complex sentences
    if (/[\u0600-\u06FF]/.test(text)) {
      return null;
    }

    const rawPatch: Record<string, any> = {};
    let matchedCount = 0;

    // Match `amount 18000`, `amount: $18,500`, or `amount 18k`
    const amountMatch = text.match(
      /\b(?:amount|price|value|deal)\s*[:=]?\s*\$?([0-9,]+(?:\.[0-9]+)?)(k)?\s*(USD|EUR|GBP|EGP|SAR|AED)?\b/i,
    );
    if (amountMatch) {
      let num = Number(amountMatch[1].replace(/,/g, ''));
      if (amountMatch[2]?.toLowerCase() === 'k') {
        num *= 1000;
      }
      rawPatch.amount = num;
      if (amountMatch[3]) {
        rawPatch.currency = amountMatch[3].toUpperCase();
      }
      matchedCount++;
    }

    // Match `close 2026-11-20` or `date: 2026-11-20`
    const dateMatch = text.match(/\b(?:close|closedate|date)\s*[:=]?\s*(\d{4}-\d{2}-\d{2})\b/i);
    if (dateMatch) {
      rawPatch.expectedCloseDateIso = dateMatch[1];
      matchedCount++;
    }

    // Match `stage <stageId or multi-word stage label>` up to next keyword or end of line
    const stageMatch = text.match(
      /\bstage\s*[:=]?\s*([A-Za-z0-9_-\s]+?)(?=\s+\b(?:amount|price|value|close|date|currency)\b|$)/i,
    );
    if (stageMatch) {
      rawPatch.dealStage = stageMatch[1].trim();
      matchedCount++;
    }

    if (matchedCount === 0) {
      return null;
    }

    // Normalize stage label -> internal HubSpot ID via Stage 1 normalizer
    const normalized = sanitizeRawToolInput(rawPatch, tenantStages);

    // Verify that if dealStage was provided, it resolved to a valid tenant stage ID
    if (
      normalized.dealStage &&
      normalized.dealStage !== 'unchanged' &&
      !tenantStages.some((s) => s.id === normalized.dealStage)
    ) {
      return null; // Unrecognized fuzzy stage name -> let Tier-2 LLM resolve semantically
    }

    return normalized as Partial<CrmTransitionPayload>;
  }

  private async extractDeltaViaLlm(
    tenantId: string,
    runId: string,
    repInstruction: string,
    existingPayload: CrmTransitionPayload,
    tenantStages: TenantDealStage[],
    referenceNow: Date,
  ): Promise<Record<string, any>> {
    const stageLegend = tenantStages
      .map((s) => `ID: "${s.id}" -> Label: "${s.label}"`)
      .join('\n');

    const response = await this.anthropic.messages.create({
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 600,
      system: `You are Vexel's CRM Override Parser. A sales rep is replying on WhatsApp to patch a pending HubSpot update.
Reference UTC Time: ${referenceNow.toISOString()}.
Valid Tenant HubSpot Stages:
${stageLegend}

Return ONLY the fields the sales rep explicitly asked to change.`,
      messages: [
        {
          role: 'user',
          content: `EXISTING EXTRACTED PAYLOAD:
${JSON.stringify(existingPayload, null, 2)}

SALES REP WHATSAPP OVERRIDE INSTRUCTION:
"${repInstruction}"`,
        },
      ],
      tools: [
        {
          name: 'apply_crm_override_patch',
          description: 'Apply partial field overrides from the sales rep',
          input_schema: {
            type: 'object',
            properties: {
              dealStage: { type: 'string', description: 'Exact HubSpot stage ID from legend' },
              amount: { type: 'number' },
              currency: { type: 'string', enum: ['USD', 'EUR', 'GBP', 'EGP', 'SAR', 'AED'] },
              expectedCloseDateIso: { type: 'string', description: 'YYYY-MM-DD' },
              summaryNote: { type: 'string' },
              nextTask: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  dueInHours: { type: 'number' },
                  priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
                },
              },
            },
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'apply_crm_override_patch' },
    });

    await this.usageMeter.recordLlmUsage({
      tenantId,
      runId,
      provider: 'anthropic-claude-3-7-sonnet:rep-override',
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    });

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    return (toolBlock?.input as Record<string, any>) ?? {};
  }
}