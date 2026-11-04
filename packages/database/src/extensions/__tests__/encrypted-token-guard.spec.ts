import {
  assertTenantPayloadSealed,
  UnencryptedTokenWriteError,
} from '../encrypted-token-guard.extension';
import { EnvelopeCryptoService } from '@vexel/crm-hubspot';

describe('encryptedTokenGuardExtension', () => {
  const testKeyRing = {
    activeVersion: 'v1',
    keys: { v1: Buffer.alloc(32, 7) },
  };
  const crypto = new EnvelopeCryptoService(testKeyRing);

  it('blocks plaintext hubspotAccessToken on direct update and { set } wrapper', () => {
    expect(() =>
      assertTenantPayloadSealed(
        { hubspotAccessToken: 'pat-na1-raw-token-123' },
        'Tenant',
        'update',
      ),
    ).toThrow(UnencryptedTokenWriteError);

    expect(() =>
      assertTenantPayloadSealed(
        { hubspotRefreshToken: { set: 'raw-refresh-token' } },
        'Tenant',
        'update',
      ),
    ).toThrow(/does not start with required "vexel:enc:" prefix/);
  });

  it('blocks spoofed prefix strings that lack valid 5-part GCM envelope segments', () => {
    expect(() =>
      assertTenantPayloadSealed(
        { hubspotAccessToken: 'vexel:enc:v1:short:stub' },
        'Tenant',
        'create',
      ),
    ).toThrow(/missing valid <kekVersion>:<wrappedDek>:<cipherBundle> segments/);
  });

  it('allows null values (OAuth disconnect) and valid AES-256-GCM envelopes', () => {
    const validEnvelope = crypto.encrypt(
      'pat-na1-real-hubspot-token',
      'tenant_october_01',
      'hubspot_access_token',
    );

    expect(() =>
      assertTenantPayloadSealed(
        { hubspotAccessToken: validEnvelope, hubspotRefreshToken: null },
        'Tenant',
        'update',
      ),
    ).not.toThrow();
  });
});