import { HubSpotHttpClient } from '../client/hubspot-http.client';
import { ResolvedHubSpotContext } from '../resolver/entity-resolver.service';
import {
  StaleDealStageError,
  isHubSpotStaleStageError,
} from '../errors/stale-stage.error';
import { CrmTransitionPayload } from '@vexel/extractor';
import { HubSpotUndoSnapshot } from '../approval/whatsapp-approval.service';

// Official HubSpot v4 HUBSPOT_DEFINED Association Type IDs
const HS_ASSOC_TYPE = {
  NOTE_TO_CONTACT: 202,
  NOTE_TO_COMPANY: 190,
  NOTE_TO_DEAL: 214,
  TASK_TO_CONTACT: 204,
  TASK_TO_COMPANY: 192,
  TASK_TO_DEAL: 216,
} as const;
export interface HubSpotRollbackOutcome {
  dealAction: 'RESTORED_PREVIOUS_STATE' | 'ARCHIVED_NEW_DEAL' | 'NO_DEAL_CHANGE';
  noteDeleted: boolean;
  taskDeleted: boolean;
}

export interface HubSpotSyncOutcome {
  dealId: string;
  contactId: string;
  noteId: string | null;
  taskId: string | null;
  createdNewDeal: boolean;
}

export class HubSpotV4SyncService {
  constructor(private readonly http: HubSpotHttpClient) { }

  async syncTransitionIdempotently(params: {
    tenantId: string;
    runId: string;
    senderPhone: string;
    crmContext: ResolvedHubSpotContext;
    payload: CrmTransitionPayload;
  }): Promise<HubSpotSyncOutcome> {
    const { tenantId, runId, senderPhone, crmContext, payload } = params;

    // 1. Ensure a Contact exists (create one if this is a brand-new inbound WhatsApp lead)
    const contactId =
      crmContext.contactId ?? (await this.ensureContactForPhone(tenantId, senderPhone));

    // 2. Upsert the Deal and validate custom dealstage ID
    const { dealId, createdNewDeal } = await this.upsertDeal({
      tenantId,
      existingDealId: crmContext.activeDealId,
      pipelineId: crmContext.pipelineId,
      contactName: crmContext.contactName ?? senderPhone,
      ownerId: crmContext.contactOwnerId,
      payload,
    });

    // 3. Idempotent v4 Batch Associations (Deal -> Contact & Deal -> Company)
    await this.associateDealEntitiesV4(tenantId, dealId, contactId, crmContext.companyId);

    // 4. Idempotent Timeline Note Creation (with inline v4 associations + MEDDIC breakdown)
    const noteId = await this.ensureTimelineNoteIdempotent({
      tenantId,
      runId,
      dealId,
      contactId,
      companyId: crmContext.companyId,
      ownerId: crmContext.contactOwnerId,
      payload,
    });

    // 5. Idempotent Follow-Up Task Creation (if nextTask was extracted)
    let taskId: string | null = null;
    if (payload.nextTask) {
      taskId = await this.ensureFollowUpTaskIdempotent({
        tenantId,
        runId,
        dealId,
        contactId,
        companyId: crmContext.companyId,
        ownerId: crmContext.contactOwnerId,
        nextTask: payload.nextTask,
      });
    }

    return { dealId, contactId, noteId, taskId, createdNewDeal };
  }

  private async ensureContactForPhone(tenantId: string, senderPhone: string): Promise<string> {
    const digitsOnly = senderPhone.replace(/\D/g, '');
    const e164 = `+${digitsOnly}`;

    const createRes = await this.http.request<{ id: string }>({
      tenantId,
      path: '/crm/v3/objects/contacts',
      method: 'POST',
      body: {
        properties: {
          phone: e164,
          mobilephone: e164,
          firstname: `WhatsApp Lead (${e164})`,
          lifecyclestage: 'lead',
        },
      },
    });

    if (createRes.status === 409) {
      // Conflict: extract existing Contact ID from HubSpot 409 message if created concurrently
      const match = JSON.stringify(createRes.data).match(/Existing ID:\s*(\d+)/i);
      if (match?.[1]) return match[1];
    }

    if (createRes.status >= 400 || !createRes.data?.id) {
      throw new Error(`Failed to create HubSpot Contact (${createRes.status})`);
    }

    return String(createRes.data.id);
  }

  private async upsertDeal(params: {
    tenantId: string;
    existingDealId: string | null;
    pipelineId: string;
    contactName: string;
    ownerId: string | null;
    payload: CrmTransitionPayload;
  }): Promise<{ dealId: string; createdNewDeal: boolean }> {
    const { tenantId, existingDealId, pipelineId, contactName, ownerId, payload } = params;

    const properties: Record<string, string | number> = {};

    if (payload.dealStage && payload.dealStage !== 'unchanged') {
      properties.dealstage = payload.dealStage;
      properties.pipeline = pipelineId;
    } else if (!existingDealId) {
      // Default to first stage if creating a net-new deal and LLM returned "unchanged"
      properties.dealstage = 'appointmentscheduled';
      properties.pipeline = pipelineId;
    }

    if (payload.amount !== null) {
      properties.amount = payload.amount;
    }
    if (payload.expectedCloseDateIso) {
      properties.closedate = new Date(`${payload.expectedCloseDateIso}T00:00:00Z`).getTime();
    }
    if (ownerId && !existingDealId) {
      properties.hubspot_owner_id = ownerId;
    }
    if (!existingDealId) {
      properties.dealname = payload.dealName || `${contactName} — Vexel Deal`;
    }

    const res = await this.http.request<{ id: string }>({
      tenantId,
      path: existingDealId
        ? `/crm/v3/objects/deals/${existingDealId}`
        : '/crm/v3/objects/deals',
      method: existingDealId ? 'PATCH' : 'POST',
      body: { properties },
    });

    if (res.status >= 400) {
      if (isHubSpotStaleStageError(res.status, res.data)) {
        throw new StaleDealStageError(
          tenantId,
          pipelineId,
          String(properties.dealstage),
          (res.data as any)?.correlationId,
        );
      }
      throw new Error(`HubSpot Deal upsert failed (${res.status}): ${JSON.stringify(res.data)}`);
    }

    return {
      dealId: String(res.data.id),
      createdNewDeal: !existingDealId,
    };
  }

  /**
   * Uses HubSpot v4 Default Batch Association API (idempotent at the graph edge level)
   */
  private async associateDealEntitiesV4(
    tenantId: string,
    dealId: string,
    contactId: string,
    companyId: string | null,
  ): Promise<void> {
    await this.http.request({
      tenantId,
      path: '/crm/v4/associations/deals/contacts/batch/associate/default',
      method: 'POST',
      body: {
        inputs: [{ from: { id: dealId }, to: { id: contactId } }],
      },
    });

    if (companyId) {
      await this.http.request({
        tenantId,
        path: '/crm/v4/associations/deals/companies/batch/associate/default',
        method: 'POST',
        body: {
          inputs: [{ from: { id: dealId }, to: { id: companyId } }],
        },
      });
    }
  }

  /**
   * Searches for [vexel_run:runId] watermark before creating the Note to guarantee idempotency
   */
  private async ensureTimelineNoteIdempotent(params: {
    tenantId: string;
    runId: string;
    dealId: string;
    contactId: string;
    companyId: string | null;
    ownerId: string | null;
    payload: CrmTransitionPayload;
  }): Promise<string> {
    const { tenantId, runId, dealId, contactId, companyId, ownerId, payload } = params;
    const watermark = `[vexel_run:${runId}]`;

    // 1. Check if Note for this runId already exists on HubSpot
    const existingSearch = await this.http.request<{ results: Array<{ id: string }> }>({
      tenantId,
      path: '/crm/v3/objects/notes/search',
      method: 'POST',
      body: {
        filterGroups: [
          {
            filters: [
              { propertyName: 'hs_note_body', operator: 'CONTAINS_TOKEN', value: `*${runId}*` },
            ],
          },
        ],
        limit: 1,
      },
    });

    if (existingSearch.data.results?.[0]?.id) {
      return String(existingSearch.data.results[0].id);
    }

    // 2. Format structured HTML timeline note with MEDDIC fields
    const meddicLines = Object.entries(payload.meddic)
      .filter(([, val]) => val !== null)
      .map(([key, val]) => `<li><strong>${key.toUpperCase()}:</strong> ${val}</li>`)
      .join('');

    const htmlBody = [
      `<strong>⚡ Vexel Omnichannel Sync (Confidence: ${payload.confidenceScore}%)</strong>`,
      `<p>${payload.summaryNote}</p>`,
      meddicLines ? `<p><strong>MEDDIC Qualification:</strong></p><ul>${meddicLines}</ul>` : '',
      `<p style="color:#888;font-size:11px;">${watermark}</p>`,
    ]
      .filter(Boolean)
      .join('');

    const associations: any[] = [
      {
        to: { id: dealId },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: HS_ASSOC_TYPE.NOTE_TO_DEAL,
          },
        ],
      },
      {
        to: { id: contactId },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: HS_ASSOC_TYPE.NOTE_TO_CONTACT,
          },
        ],
      },
    ];

    if (companyId) {
      associations.push({
        to: { id: companyId },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: HS_ASSOC_TYPE.NOTE_TO_COMPANY,
          },
        ],
      });
    }

    const createNoteRes = await this.http.request<{ id: string }>({
      tenantId,
      path: '/crm/v3/objects/notes',
      method: 'POST',
      body: {
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_note_body: htmlBody,
          ...(ownerId ? { hubspot_owner_id: ownerId } : {}),
        },
        associations,
      },
    });

    if (createNoteRes.status >= 400 || !createNoteRes.data?.id) {
      throw new Error(`HubSpot Note creation failed (${createNoteRes.status})`);
    }

    return String(createNoteRes.data.id);
  }

  private async ensureFollowUpTaskIdempotent(params: {
    tenantId: string;
    runId: string;
    dealId: string;
    contactId: string;
    companyId: string | null;
    ownerId: string | null;
    nextTask: NonNullable<CrmTransitionPayload['nextTask']>;
  }): Promise<string> {
    const { tenantId, runId, dealId, contactId, companyId, ownerId, nextTask } = params;
    const watermark = `[vexel_task:${runId}]`;

    const existingSearch = await this.http.request<{ results: Array<{ id: string }> }>({
      tenantId,
      path: '/crm/v3/objects/tasks/search',
      method: 'POST',
      body: {
        filterGroups: [
          {
            filters: [
              { propertyName: 'hs_task_body', operator: 'CONTAINS_TOKEN', value: `*${runId}*` },
            ],
          },
        ],
        limit: 1,
      },
    });

    if (existingSearch.data.results?.[0]?.id) {
      return String(existingSearch.data.results[0].id);
    }

    const dueTimestamp = Date.now() + nextTask.dueInHours * 3600 * 1000;
    const associations: any[] = [
      {
        to: { id: dealId },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: HS_ASSOC_TYPE.TASK_TO_DEAL,
          },
        ],
      },
      {
        to: { id: contactId },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: HS_ASSOC_TYPE.TASK_TO_CONTACT,
          },
        ],
      },
    ];

    if (companyId) {
      associations.push({
        to: { id: companyId },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: HS_ASSOC_TYPE.TASK_TO_COMPANY,
          },
        ],
      });
    }

    const createTaskRes = await this.http.request<{ id: string }>({
      tenantId,
      path: '/crm/v3/objects/tasks',
      method: 'POST',
      body: {
        properties: {
          hs_timestamp: new Date(dueTimestamp).toISOString(),
          hs_task_subject: nextTask.title,
          hs_task_body: `Auto-scheduled by Vexel from WhatsApp/Voice thread. ${watermark}`,
          hs_task_status: 'NOT_STARTED',
          hs_task_priority: nextTask.priority,
          hs_task_type: 'TODO',
          ...(ownerId ? { hubspot_owner_id: ownerId } : {}),
        },
        associations,
      },
    });

    if (createTaskRes.status >= 400 || !createTaskRes.data?.id) {
      throw new Error(`HubSpot Task creation failed (${createTaskRes.status})`);
    }

    return String(createTaskRes.data.id);
  }
  
  /**
   * Compensating Saga Transaction: Reverts the HubSpot Deal stage/amount
   * (or archives a net-new Deal) and deletes the created Timeline Note and Task.
   */
  async rollbackSyncIdempotently(
    tenantId: string,
    snapshot: HubSpotUndoSnapshot,
  ): Promise<HubSpotRollbackOutcome> {
    let noteDeleted = false;
    let taskDeleted = false;
    let dealAction: HubSpotRollbackOutcome['dealAction'] = 'NO_DEAL_CHANGE';

    // 1. Delete the created Timeline Note (404-tolerant for idempotent retries)
    if (snapshot.noteId) {
      const noteRes = await this.http.request({
        tenantId,
        path: `/crm/v3/objects/notes/${snapshot.noteId}`,
        method: 'DELETE',
      });
      if (noteRes.status >= 400 && noteRes.status !== 404) {
        throw new Error(`Failed to delete HubSpot Note ${snapshot.noteId} (${noteRes.status})`);
      }
      noteDeleted = true;
    }

    // 2. Delete the created Follow-Up Task (404-tolerant for idempotent retries)
    if (snapshot.taskId) {
      const taskRes = await this.http.request({
        tenantId,
        path: `/crm/v3/objects/tasks/${snapshot.taskId}`,
        method: 'DELETE',
      });
      if (taskRes.status >= 400 && taskRes.status !== 404) {
        throw new Error(`Failed to delete HubSpot Task ${snapshot.taskId} (${taskRes.status})`);
      }
      taskDeleted = true;
    }

    // 3. Compensate Deal Mutation: Archive if newly created, or restore previous stage & amount
    if (snapshot.createdNewDeal) {
      const delDealRes = await this.http.request({
        tenantId,
        path: `/crm/v3/objects/deals/${snapshot.dealId}`,
        method: 'DELETE',
      });
      if (delDealRes.status >= 400 && delDealRes.status !== 404) {
        throw new Error(`Failed to archive new HubSpot Deal ${snapshot.dealId} (${delDealRes.status})`);
      }
      dealAction = 'ARCHIVED_NEW_DEAL';
    } else {
      const restoreProps: Record<string, string | number> = {};
      if (snapshot.previousDealStage) {
        restoreProps.dealstage = snapshot.previousDealStage;
      }
      if (snapshot.previousAmount !== null && snapshot.previousAmount !== undefined) {
        restoreProps.amount = snapshot.previousAmount;
      }

      if (Object.keys(restoreProps).length > 0) {
        const patchRes = await this.http.request({
          tenantId,
          path: `/crm/v3/objects/deals/${snapshot.dealId}`,
          method: 'PATCH',
          body: { properties: restoreProps },
        });
        if (patchRes.status >= 400) {
          throw new Error(
            `Failed to restore HubSpot Deal ${snapshot.dealId} (${patchRes.status}): ${JSON.stringify(patchRes.data)}`,
          );
        }
        dealAction = 'RESTORED_PREVIOUS_STATE';
      }
    }

    return { dealAction, noteDeleted, taskDeleted };
  }
}