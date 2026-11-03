import { z } from 'zod';

export const HubSpotDealStageEnum = z.enum([
  'appointmentscheduled',
  'qualifiedtobuy',
  'presentationscheduled',
  'decisionmakerboughtin',
  'contractsent',
  'closedwon',
  'closedlost',
  'unchanged',
]);

export const MeddicExtractionSchema = z.object({
  metrics: z.string().nullable().describe('Quantifiable business impact or ROI mentioned'),
  economicBuyer: z.string().nullable().describe('Person with final budget authority'),
  decisionCriteria: z.string().nullable().describe('Technical, vendor, or pricing requirements'),
  decisionProcess: z.string().nullable().describe('Steps and timeline required for procurement sign-off'),
  identifiedPain: z.string().nullable().describe('Core operational problem driving the purchase'),
  champion: z.string().nullable().describe('Internal advocate pushing the deal forward'),
});

export const CrmTransitionSchema = z.object({
  dealName: z.string().nullable().describe('Suggested deal title if no active deal exists'),
  dealStage: HubSpotDealStageEnum.describe('Target HubSpot stage; use "unchanged" if no progression occurred'),
  amount: z.number().nonnegative().nullable().describe('Numeric contract value if explicitly stated'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'EGP', 'SAR', 'AED']).nullable(),
expectedCloseDateIso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be strictly YYYY-MM-DD format (e.g., 2026-11-15)')
    .nullable()
    .describe('ISO-8601 date (YYYY-MM-DD) if a closing target was agreed'),
meddic: MeddicExtractionSchema,
  nextTask: z
    .object({
      title: z.string().describe('Actionable follow-up task for the sales rep'),
      dueInHours: z.number().int().min(1).max(720).describe('Hours from current timestamp until task is due'),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    })
    .nullable(),
  summaryNote: z
    .string()
    .min(10)
    .describe('Clean executive summary in English for the HubSpot timeline, preserving key client quotes'),
  detectedLanguage: z.enum(['en', 'ar', 'mixed-ar-en']),
  confidenceScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('0-100 confidence score based on explicitness of buyer intent and entity clarity'),
  confidenceReasoning: z
    .string()
    .describe('1-sentence justification for the assigned confidence score'),
});

export type CrmTransitionPayload = z.infer<typeof CrmTransitionSchema>;