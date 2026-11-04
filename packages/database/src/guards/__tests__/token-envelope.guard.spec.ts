import {
  assertEncryptedTokenPayloads,
  UnencryptedTokenWriteError,
} from '../token-envelope.guard';
import { EnvelopeCryptoService } from '@vexel/crm-hubspot';

describe('vexelEncryptedTokenGuard', () => {
  const testKek = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const crypto = new EnvelopeCryptoService({
    activeVersion: 'v1',
    keys: { v1: Buffer.from(testKek, 'hex') },
  });

  it('blocks direct plaintext hubspotAccessToken writes', () => {
    expect(() =>
      assertEncryptedTokenPayloads(
        { name: 'Acme', hubspotAccessToken: 'pat-na1-raw-plaintext-token' },
        'Tenant',
        'update',
      ),
    ).toThrow(UnencryptedTokenWriteError);
  });

  it('blocks Prisma { set: "..." } wrapper with fake prefix', () => {
    expect(() =>
      assertEncryptedTokenPayloads(
        { hubspotRefreshToken: { set: 'vexel:enc:fake-short-string' } },
        'Tenant',
        'update',
      ),
    ).toThrow(UnencryptedTokenWriteError);
  });

  it('allows null token writes (OAuth disconnect) and valid sealed envelopes', () => {
    const validEnvelope = crypto.encrypt(
      'raw-hubspot-oauth-token',
      'tenant_123',
      'hubspot_access_token',
    );

    expect(() =>
      assertEncryptedTokenPayloads(
        {
          hubspotAccessToken: { set: validEnvelope },
          hubspotRefreshToken: null,
        },
        'Tenant',
        'upsert.update',
      ),
    ).not.toThrow();
  });
});