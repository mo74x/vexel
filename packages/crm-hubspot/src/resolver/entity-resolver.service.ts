import { HubSpotHttpClient } from '../client/hubspot-http.client';

export interface ResolvedHubSpotContext {
  contactId: string | null;
  contactName: string | null;
  contactOwnerId: string | null;
  companyId: string | null;
  companyName: string | null;
  activeDealId: string | null;
  currentDealName: string | null;
  currentDealStage: string | null;
  currentAmount: number | null;
  pipelineId: string;
}

export class HubSpotEntityResolverService {
  constructor(private readonly http: HubSpotHttpClient) {}

  async resolveBySenderPhone(
    tenantId: string,
    rawSenderPhone: string,
  ): Promise<ResolvedHubSpotContext> {
    const digitsOnly = rawSenderPhone.replace(/\D/g, '');
    // Last 9 digits uniquely identify subscriber numbers across MENA & EU regardless of trunk prefix (0 vs +20/+966/+44)
    const last9Digits = digitsOnly.slice(-9);
    const e164Phone = `+${digitsOnly}`;

    // 1. Search Contact across phone, mobilephone, and hs_whatsapp_phone_number using OR filterGroups
    const searchRes = await this.http.request<{ results: any[] }>({
      tenantId,
      path: '/crm/v3/objects/contacts/search',
      method: 'POST',
      body: {
        filterGroups: [
          {
            filters: [
              { propertyName: 'phone', operator: 'CONTAINS_TOKEN', value: `*${last9Digits}` },
            ],
          },
          {
            filters: [
              { propertyName: 'mobilephone', operator: 'CONTAINS_TOKEN', value: `*${last9Digits}` },
            ],
          },
          {
            filters: [
              { propertyName: 'hs_whatsapp_phone_number', operator: 'EQ', value: e164Phone },
            ],
          },
        ],
        properties: [
          'firstname',
          'lastname',
          'phone',
          'mobilephone',
          'hs_whatsapp_phone_number',
          'company',
          'hubspot_owner_id',
        ],
        limit: 5,
      },
    });

    // Deterministically verify suffix match in memory to eliminate partial token false positives
    const matchedContact = (searchRes.data.results ?? []).find((c) => {
      const props = c.properties ?? {};
      const candidates = [props.phone, props.mobilephone, props.hs_whatsapp_phone_number]
        .filter(Boolean)
        .map((v: string) => v.replace(/\D/g, ''));
      return candidates.some((num) => num.endsWith(last9Digits));
    });

    if (!matchedContact) {
      return {
        contactId: null,
        contactName: null,
        contactOwnerId: null,
        companyId: null,
        companyName: null,
        activeDealId: null,
        currentDealName: null,
        currentDealStage: null,
        currentAmount: null,
        pipelineId: 'default',
      };
    }

    const contactId = String(matchedContact.id);
    const contactProps = matchedContact.properties ?? {};
    const contactName =
      [contactProps.firstname, contactProps.lastname].filter(Boolean).join(' ').trim() || null;

    // 2. Fetch v4 Associations for Deals and Companies in parallel
    const [dealAssocRes, companyAssocRes] = await Promise.all([
      this.http.request<{ results: Array<{ toObjectId: number }> }>({
        tenantId,
        path: `/crm/v4/objects/contacts/${contactId}/associations/deals?limit=25`,
        method: 'GET',
      }),
      this.http.request<{ results: Array<{ toObjectId: number }> }>({
        tenantId,
        path: `/crm/v4/objects/contacts/${contactId}/associations/companies?limit=5`,
        method: 'GET',
      }),
    ]);

    const companyId = companyAssocRes.data.results?.[0]?.toObjectId
      ? String(companyAssocRes.data.results[0].toObjectId)
      : null;

    const dealIds = (dealAssocRes.data.results ?? []).map((r) => String(r.toObjectId));
    if (dealIds.length === 0) {
      return {
        contactId,
        contactName,
        contactOwnerId: contactProps.hubspot_owner_id ?? null,
        companyId,
        companyName: contactProps.company ?? null,
        activeDealId: null,
        currentDealName: null,
        currentDealStage: null,
        currentAmount: null,
        pipelineId: 'default',
      };
    }

    // 3. Batch-read associated Deals and pick the most recently modified OPEN deal
    const batchDealsRes = await this.http.request<{ results: any[] }>({
      tenantId,
      path: '/crm/v3/objects/deals/batch/read',
      method: 'POST',
      body: {
        inputs: dealIds.map((id) => ({ id })),
        properties: [
          'dealname',
          'dealstage',
          'amount',
          'pipeline',
          'hubspot_owner_id',
          'hs_is_closed',
          'hs_lastmodifieddate',
        ],
      },
    });

    const deals = batchDealsRes.data.results ?? [];
    const openDeals = deals.filter((d) => d.properties?.hs_is_closed !== 'true');
    const candidatePool = openDeals.length > 0 ? openDeals : deals;

    // Sort descending by hs_lastmodifieddate for deterministic selection
    candidatePool.sort((a, b) => {
      const timeA = new Date(a.properties?.hs_lastmodifieddate ?? 0).getTime();
      const timeB = new Date(b.properties?.hs_lastmodifieddate ?? 0).getTime();
      return timeB - timeA;
    });

    const primaryDeal = candidatePool[0];
    const dealProps = primaryDeal?.properties ?? {};

    // Prioritize the Account Executive owning the Deal; fallback to SDR owning the Contact
    const effectiveOwnerId =
      dealProps.hubspot_owner_id ?? contactProps.hubspot_owner_id ?? null;

    return {
      contactId,
      contactName,
      contactOwnerId: effectiveOwnerId ? String(effectiveOwnerId) : null,
      companyId,
      companyName: contactProps.company ?? null,
      activeDealId: primaryDeal ? String(primaryDeal.id) : null,
      currentDealName: dealProps.dealname ?? null,
      currentDealStage: dealProps.dealstage ?? null,
      currentAmount: dealProps.amount ? Number(dealProps.amount) : null,
      pipelineId: dealProps.pipeline || 'default',
    };
  }
}