import Anthropic from '@anthropic-ai/sdk';
import { z, ZodError } from 'zod';
import {
    buildTenantCrmTransitionSchema,
    CrmTransitionPayload,
} from '../schemas/crm-transition.schema';
import { sanitizeRawToolInput } from './payload-normalizer';
import { UsageMeterService } from '../meter/usage-meter.service';
import { MergedTranscriptBundle } from '../transcriber/transcriber.service';
import { PipelineStageCacheService } from '../cache/pipeline-stage-cache.service';

export interface ResolvedCrmContext {
    contactId: string | null;
    contactName: string | null;
    companyName: string | null;
    activeDealId: string | null;
    currentDealName: string | null;
    currentDealStage: string | null;
    currentAmount: number | null;
    /** HubSpot pipeline the active deal belongs to (falls back to 'default' when omitted) */
    pipelineId?: string;
}

export class ZodExtractorService {
    private readonly anthropic: Anthropic;
    private readonly MAX_REPAIR_ATTEMPTS = 2; // 1 initial call + up to 2 self-healing turns

    constructor(
        private readonly usageMeter: UsageMeterService,
        private readonly stageCache: PipelineStageCacheService,
    ) {
        this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }

    async extractTransition(
        tenantId: string,
        runId: string,
        hubspotAccessToken: string | null,
        bundle: MergedTranscriptBundle,
        crmContext: ResolvedCrmContext,
        referenceNow = new Date(),
    ): Promise<CrmTransitionPayload> {
        // 1. Load tenant's custom pipeline stages from Redis cache (~1ms)
        const tenantStages = await this.stageCache.getTenantStages(
            tenantId,
            hubspotAccessToken,
            crmContext.pipelineId ?? 'default',
        );

        // 2. Dynamically build the tenant-specific Zod schema and Anthropic JSON Schema
        const dynamicZodSchema = buildTenantCrmTransitionSchema(tenantStages);
        // Zod v4 ships native JSON Schema generation (replaces the zod-to-json-schema package)
        const dynamicJsonSchema = z.toJSONSchema(dynamicZodSchema) as Anthropic.Tool.InputSchema;

        const formattedPipelineTable = tenantStages
            .map(
                (s) =>
                    `  - ID: "${s.id}" | Label: "${s.label}" | Order: ${s.displayOrder + 1} | Win Prob: ${Math.round(s.probability * 100)}%`,
            )
            .join('\n');

        const systemPrompt = `You are Vexel, an autonomous RevOps execution engine.
Current UTC Reference Time: ${referenceNow.toISOString()} (${referenceNow.toLocaleDateString('en-US', { weekday: 'long' })}).

TENANT CUSTOM HUBSPOT PIPELINE STAGES (Output the exact "ID" value in dealStage, NEVER the Label):
${formattedPipelineTable}
  - ID: "unchanged" | Use when no clear stage progression occurred.

RULES FOR EXTRACTION:
1. BILINGUAL RESOLUTION: Output "summaryNote" and "nextTask.title" in clear English while preserving exact numbers and proper nouns.
2. RELATIVE DATES: Resolve relative dates strictly against Current UTC Reference Time in YYYY-MM-DD format.
3. STAGE DISCIPLINE: Compare the transcript against the tenant's custom stage progression above. Only advance "dealStage" if concrete evidence exists.`;

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
                        input_schema: dynamicJsonSchema,
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
            //    (also maps human-readable stage labels -> tenant's internal HubSpot stage IDs)
            const sanitizedInput = sanitizeRawToolInput(toolBlock.input, tenantStages);

            // 3. Validate against the tenant-specific strict Zod contract
            const parsed = dynamicZodSchema.safeParse(sanitizedInput);
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
