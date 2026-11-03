import Anthropic from '@anthropic-ai/sdk';
import { z, ZodError } from 'zod';
import {
  CrmTransitionSchema,
  CrmTransitionPayload,
} from '../schemas/crm-transition.schema';
import { sanitizeRawToolInput } from './payload-normalizer';
import { UsageMeterService } from '../meter/usage-meter.service';
import { MergedTranscriptBundle } from '../transcriber/transcriber.service';

export interface ResolvedCrmContext {
  contactId: string | null;
  contactName: string | null;
  companyName: string | null;
  activeDealId: string | null;
  currentDealName: string | null;
  currentDealStage: string | null;
  currentAmount: number | null;
}

export class ZodExtractorService {
  private readonly anthropic: Anthropic;
  private readonly jsonSchema: Record<string, any>;
  private readonly MAX_REPAIR_ATTEMPTS = 2; // 1 initial call + up to 2 self-healing turns

  constructor(private readonly usageMeter: UsageMeterService) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.jsonSchema = z.toJSONSchema(CrmTransitionSchema);
  }

  async extractTransition(
    tenantId: string,
    runId: string,
    bundle: MergedTranscriptBundle,
    crmContext: ResolvedCrmContext,
    referenceNow = new Date(),
  ): Promise<CrmTransitionPayload> {
    const systemPrompt = `You are Vexel, an autonomous RevOps execution engine.
Current UTC Reference Time: ${referenceNow.toISOString()} (${referenceNow.toLocaleDateString('en-US', { weekday: 'long' })}).

RULES FOR EXTRACTION:
1. BILINGUAL RESOLUTION: The input may mix English, Arabic (Egyptian/Levantine/Gulf), or Franco-Arabic. Always output "summaryNote" and "nextTask.title" in clear professional English while preserving exact numbers, currencies, and proper nouns.
2. RELATIVE DATES: Resolve relative expressions (e.g., "يوم الحد الجاي", "بكرا", "next Tuesday", "end of month") strictly against the Current UTC Reference Time in YYYY-MM-DD format.
3. STAGE DISCIPLINE: Only advance "dealStage" if the transcript contains concrete evidence. Otherwise set "dealStage" to "unchanged".
4. CONFIDENCE SCORING RUBRIC:
   - 86 to 100: Active deal exists AND buyer intent, numbers, and stage transition are unambiguous.
   - 65 to 85: Deal context is clear, but pricing is tentative, date is vague, or no active deal exists yet.
   - 0 to 64: Casual check-in, ambiguous sender identity, or conflicting numbers requiring rep review.`;

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `CURRENT HUBSPOT CONTEXT:
${JSON.stringify(crmContext, null, 2)}

INBOUND OMNICHANNEL TRANSCRIPT (${bundle.messageCount} messages, ${bundle.totalAudioSeconds}s audio):
${bundle.mergedTranscript}`,
      },
    ];

    let lastZodError: ZodError | null = null;

    for (let attempt = 0; attempt <= this.MAX_REPAIR_ATTEMPTS; attempt++) {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 1200,
        system: systemPrompt,
        messages,
        tools: [
          {
            name: 'commit_crm_state_transition',
            description: 'Commit structured CRM deal updates, MEDDIC fields, and follow-up tasks',
            input_schema: (this.jsonSchema.definitions?.CrmTransitionSchema ??
              this.jsonSchema) as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: 'commit_crm_state_transition' },
      });

      // 1. Meter every attempt (initial or repair) to UsageLedger
      await this.usageMeter.recordLlmUsage({
        tenantId,
        runId,
        provider:
          attempt === 0
            ? 'anthropic-claude-3-7-sonnet'
            : `anthropic-claude-3-7-sonnet:repair-${attempt}`,
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      });

      const toolBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );

      if (!toolBlock) {
        throw new Error(`Claude failed to emit tool_use block on attempt ${attempt}`);
      }

      // 2. Stage 1 Repair: Zero-token deterministic coercion & sanitization
      const sanitizedInput = sanitizeRawToolInput(toolBlock.input);

      // 3. Validate against strict Zod contract
      const parsed = CrmTransitionSchema.safeParse(sanitizedInput);
      if (parsed.success) {
        return parsed.data;
      }

      lastZodError = parsed.error;

      // 4. Stage 2 Repair: Feed structured Zod path errors back via tool_result
      if (attempt < this.MAX_REPAIR_ATTEMPTS) {
        const diagnosticReport = this.formatZodErrorsForLlm(parsed.error);

        messages.push({
          role: 'assistant',
          content: response.content,
        });

        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              is_error: true,
              content: `ZOD_SCHEMA_VALIDATION_FAILED (Attempt ${attempt + 1}/${this.MAX_REPAIR_ATTEMPTS}).
Fix the following field violations and invoke "commit_crm_state_transition" again with corrected values:
${diagnosticReport}`,
            },
          ],
        });
      }
    }

    // Exhausted all in-memory repair turns; fail the Anvil step
    throw new Error(
      `Zod validation failed after ${this.MAX_REPAIR_ATTEMPTS} self-healing attempts: ${this.formatZodErrorsForLlm(lastZodError!)}`,
    );
  }

  /**
   * Formats Zod issues into concise path -> expected/received instructions for Claude
   */
  private formatZodErrorsForLlm(error: ZodError): string {
    return error.issues
      .map((issue) => {
        const fieldPath = issue.path.length > 0 ? issue.path.join('.') : 'root';
        return `- Field "${fieldPath}" (${issue.code}): ${issue.message}`;
      })
      .join('\n');
  }
}