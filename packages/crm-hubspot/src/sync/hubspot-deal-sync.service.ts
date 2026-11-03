import {
  StaleDealStageError,
  isHubSpotStaleStageError,
} from '../errors/stale-stage.error';
import { CrmTransitionPayload } from '@vexel/extractor';

export class HubSpotDealSyncService {
  async upsertDealProperties(params: {
    tenantId: string;
    accessToken: string;
    dealId: string | null;
    pipelineId: string;
    payload: CrmTransitionPayload;
  }): Promise<{ dealId: string }> {
    const { tenantId, accessToken, dealId, pipelineId, payload } = params;

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

    const endpoint = dealId
      ? `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`
      : 'https://api.hubapi.com/crm/v3/objects/deals';

    const response = await fetch(endpoint, {
      method: dealId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        correlationId?: string;
        category?: string;
        message?: string;
        errors?: unknown[];
      };

      // Detect if HubSpot rejected the dealstage ID due to stale Redis cache
      if (isHubSpotStaleStageError(response.status, errorBody)) {
        throw new StaleDealStageError(
          tenantId,
          pipelineId,
          payload.dealStage,
          errorBody.correlationId,
        );
      }

      throw new Error(
        `HubSpot Deals API failed (${response.status}): ${JSON.stringify(errorBody)}`,
      );
    }

    const result = (await response.json()) as { id: string };
    return { dealId: result.id };
  }
}