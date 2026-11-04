import {
  StaleDealStageError,
  isHubSpotStaleStageError,
} from '../errors/stale-stage.error';
import { HubSpotHttpClient } from '../client/hubspot-http.client';
import { CrmTransitionPayload } from '@vexel/extractor';

export class HubSpotDealSyncService {
  constructor(private readonly httpClient: HubSpotHttpClient) {}

  async upsertDealProperties(params: {
    tenantId: string;
    dealId: string | null;
    pipelineId: string;
    payload: CrmTransitionPayload;
  }): Promise<{ dealId: string }> {
    const { tenantId, dealId, pipelineId, payload } = params;

    const properties: Record<string, string | number> = {};

    if (payload.dealStage && payload.dealStage !== 'unchanged') {
      properties.dealstage = payload.dealStage;
      properties.pipeline = pipelineId;
    }
    if (payload.amount !== null) {
      properties.amount = payload.amount;
    }
    if (payload.expectedCloseDateIso) {
      // HubSpot expects midnight UTC Unix timestamp in ms or YYYY-MM-DD
      properties.closedate = new Date(`${payload.expectedCloseDateIso}T00:00:00Z`).getTime();
    }
    if (payload.dealName && !dealId) {
      properties.dealname = payload.dealName;
    }

    const path = dealId
      ? `/crm/v3/objects/deals/${dealId}`
      : '/crm/v3/objects/deals';

    const { status, ok, data } = await this.httpClient.request<{
      id?: string;
      correlationId?: string;
      category?: string;
      message?: string;
      errors?: unknown[];
    }>({
      tenantId,
      path,
      method: dealId ? 'PATCH' : 'POST',
      body: { properties },
    });

    if (!ok) {
      // Detect if HubSpot rejected the dealstage ID due to stale Redis cache
      if (isHubSpotStaleStageError(status, data)) {
        throw new StaleDealStageError(
          tenantId,
          pipelineId,
          payload.dealStage,
          data.correlationId,
        );
      }

      throw new Error(
        `HubSpot Deals API failed (${status}): ${JSON.stringify(data)}`,
      );
    }

    return { dealId: String(data.id) };
  }
}
