import { HubSpotEntityResolverService } from '../entity-resolver.service';

describe('HubSpotEntityResolverService', () => {
  it('resolves Contact by 9-digit suffix, picks most recent OPEN Deal, and prioritizes Deal AE owner over Contact SDR owner', async () => {
    const mockHttp: any = {
      request: async ({ path }: { path: string }) => {
        if (path === '/crm/v3/objects/contacts/search') {
          return {
            status: 200,
            data: {
              results: [
                {
                  id: 'contact_99',
                  properties: {
                    firstname: 'Karim',
                    lastname: 'Mansour',
                    phone: '+20 100 555 6677',
                    company: 'Mansour Logistics',
                    hubspot_owner_id: 'sdr_owner_10',
                  },
                },
              ],
            },
          };
        }
        if (path.includes('/associations/deals')) {
          return {
            status: 200,
            data: { results: [{ toObjectId: 501 }, { toObjectId: 502 }] },
          };
        }
        if (path.includes('/associations/companies')) {
          return {
            status: 200,
            data: { results: [{ toObjectId: 901 }] },
          };
        }
        if (path === '/crm/v3/objects/deals/batch/read') {
          return {
            status: 200,
            data: {
              results: [
                {
                  id: '501',
                  properties: {
                    dealname: 'Closed Legacy Deal',
                    dealstage: 'closedwon',
                    amount: '10000',
                    pipeline: 'default',
                    hubspot_owner_id: 'old_ae_01',
                    hs_is_closed: 'true',
                    hs_lastmodifieddate: '2026-11-05T10:00:00Z',
                  },
                },
                {
                  id: '502',
                  properties: {
                    dealname: 'Active Q4 Expansion',
                    dealstage: 'contractsent',
                    amount: '48000',
                    pipeline: 'enterprise_pipeline',
                    hubspot_owner_id: 'ae_owner_77',
                    hs_is_closed: 'false',
                    hs_lastmodifieddate: '2026-11-01T10:00:00Z',
                  },
                },
              ],
            },
          };
        }
        return { status: 200, data: {} };
      },
    };

    const resolver = new HubSpotEntityResolverService(mockHttp);
    const resolved = await resolver.resolveBySenderPhone('tenant_1', '01005556677');

    expect(resolved).toEqual({
      contactId: 'contact_99',
      contactName: 'Karim Mansour',
      contactOwnerId: 'ae_owner_77', // AE on active Deal prioritized over SDR on Contact
      companyId: '901',
      companyName: 'Mansour Logistics',
      activeDealId: '502', // Open deal prioritized over newer closed deal
      currentDealName: 'Active Q4 Expansion',
      currentDealStage: 'contractsent',
      currentAmount: 48000,
      pipelineId: 'enterprise_pipeline',
    });
  });
});

