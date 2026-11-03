import Redis from 'ioredis';

export interface TenantDealStage {
  id: string;           // Internal HubSpot ID required for mutations (e.g. "14928374" or "contractsent")
  label: string;        // Human-readable name displayed in UI (e.g. "Legal & Security Review")
  displayOrder: number; // 0-indexed progression order
  probability: number;  // 0.0 (Closed Lost) to 1.0 (Closed Won)
  pipelineId: string;
  pipelineLabel: string;
}

const DEFAULT_FALLBACK_STAGES: TenantDealStage[] = [
  { id: 'appointmentscheduled', label: 'Appointment Scheduled', displayOrder: 0, probability: 0.2, pipelineId: 'default', pipelineLabel: 'Sales Pipeline' },
  { id: 'qualifiedtobuy', label: 'Qualified to Buy', displayOrder: 1, probability: 0.4, pipelineId: 'default', pipelineLabel: 'Sales Pipeline' },
  { id: 'presentationscheduled', label: 'Presentation Scheduled', displayOrder: 2, probability: 0.6, pipelineId: 'default', pipelineLabel: 'Sales Pipeline' },
  { id: 'decisionmakerboughtin', label: 'Decision Maker Bought-In', displayOrder: 3, probability: 0.8, pipelineId: 'default', pipelineLabel: 'Sales Pipeline' },
  { id: 'contractsent', label: 'Contract Sent', displayOrder: 4, probability: 0.9, pipelineId: 'default', pipelineLabel: 'Sales Pipeline' },
  { id: 'closedwon', label: 'Closed Won', displayOrder: 5, probability: 1.0, pipelineId: 'default', pipelineLabel: 'Sales Pipeline' },
  { id: 'closedlost', label: 'Closed Lost', displayOrder: 6, probability: 0.0, pipelineId: 'default', pipelineLabel: 'Sales Pipeline' },
];

export class PipelineStageCacheService {
  private readonly CACHE_TTL_SECONDS = 6 * 3600; // 6 hours

  constructor(private readonly redis: Redis) {}

  private getCacheKey(tenantId: string, pipelineId = 'default'): string {
    return `vexel:pipelines:${tenantId}:${pipelineId}`;
  }

  /**
   * Read-through lookup: returns cached custom stages in ~1ms or fetches from HubSpot Pipelines API
   */
  async getTenantStages(
    tenantId: string,
    hubspotAccessToken: string | null,
    pipelineId = 'default',
  ): Promise<TenantDealStage[]> {
    const cacheKey = this.getCacheKey(tenantId, pipelineId);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached) as TenantDealStage[];
    }

    if (!hubspotAccessToken) {
      return DEFAULT_FALLBACK_STAGES;
    }

    const stages = await this.fetchStagesFromHubSpot(hubspotAccessToken, pipelineId);
    await this.redis.set(cacheKey, JSON.stringify(stages), 'EX', this.CACHE_TTL_SECONDS);
    return stages;
  }

  /**
   * Call on OAuth webhook or if HubSpot v4 returns HTTP 400 PROPERTY_DOESNT_EXIST / invalid stage
   */
  async invalidateTenantStages(tenantId: string, pipelineId = 'default'): Promise<void> {
    await this.redis.del(this.getCacheKey(tenantId, pipelineId));
  }

  private async fetchStagesFromHubSpot(
    accessToken: string,
    targetPipelineId: string,
  ): Promise<TenantDealStage[]> {
    const response = await fetch('https://api.hubapi.com/crm/v3/pipelines/deals', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HubSpot Pipelines API failed with status ${response.status}`);
    }

    const data = (await response.json()) as { results: any[] };
    const pipeline =
      data.results.find((p) => p.id === targetPipelineId) ?? data.results[0];

    if (!pipeline || !Array.isArray(pipeline.stages) || pipeline.stages.length === 0) {
      return DEFAULT_FALLBACK_STAGES;
    }

    return pipeline.stages
      .sort((a: any, b: any) => a.displayOrder - b.displayOrder)
      .map((stage: any) => ({
        id: String(stage.id),
        label: String(stage.label),
        displayOrder: Number(stage.displayOrder ?? 0),
        probability: Number(stage.metadata?.probability ?? 0),
        pipelineId: String(pipeline.id),
        pipelineLabel: String(pipeline.label),
      }));
  }
}