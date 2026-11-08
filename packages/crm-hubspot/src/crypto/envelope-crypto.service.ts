import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export type TokenPurpose =
  | 'hubspot_access_token'
  | 'hubspot_refresh_token'
  | 'whatsapp_access_token';

interface KeyRing {
  activeVersion: string;
  keys: Record<string, Buffer>; // Map of version -> 32-byte (256-bit) KEK
}

export class EnvelopeCryptoService {
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly IV_LENGTH = 12;  // 96-bit IV recommended by NIST for AES-GCM
  private readonly TAG_LENGTH = 16; // 128-bit authentication tag
  private readonly DEK_LENGTH = 32; // 256-bit random Data Encryption Key
  private readonly PREFIX = 'vexel:enc';

  private readonly keyRing: KeyRing;

  constructor(customKeyRing?: KeyRing) {
    this.keyRing = customKeyRing ?? this.loadKeyRingFromEnv();
  }

  /**
   * Encrypts a plaintext token using a fresh random 256-bit DEK, wraps the DEK
   * with the active Master KEK, and binds both to tenantId + purpose via GCM AAD.
   *
   * Output format: vexel:enc:<kekVersion>:<wrappedDekBundleB64>:<cipherBundleB64>
   */
  encrypt(plaintext: string, tenantId: string, purpose: TokenPurpose): string {
    const kekVersion = this.keyRing.activeVersion;
    const kek = this.keyRing.keys[kekVersion];
    if (!kek) {
      throw new Error(`Active KEK version "${kekVersion}" not found in keyring`);
    }

    const aad = Buffer.from(`${tenantId}:${purpose}`, 'utf8');

    // 1. Generate a fresh one-time 256-bit DEK for this specific token write
    const dek = randomBytes(this.DEK_LENGTH);

    // 2. Encrypt plaintext token with the DEK
    const dataIv = randomBytes(this.IV_LENGTH);
    const dataCipher = createCipheriv(this.ALGORITHM, dek, dataIv, {
      authTagLength: this.TAG_LENGTH,
    });
    dataCipher.setAAD(aad);
    const encryptedData = Buffer.concat([
      dataCipher.update(plaintext, 'utf8'),
      dataCipher.final(),
    ]);
    const dataTag = dataCipher.getAuthTag();

    // Pack [dataIv (12B) | dataTag (16B) | encryptedData]
    const cipherBundleB64 = Buffer.concat([dataIv, dataTag, encryptedData]).toString(
      'base64url',
    );

    // 3. Wrap (encrypt) the DEK using the Master KEK
    const kekIv = randomBytes(this.IV_LENGTH);
    const kekCipher = createCipheriv(this.ALGORITHM, kek, kekIv, {
      authTagLength: this.TAG_LENGTH,
    });
    kekCipher.setAAD(aad);
    const wrappedDek = Buffer.concat([kekCipher.update(dek), kekCipher.final()]);
    const kekTag = kekCipher.getAuthTag();

    // Zero out the raw DEK buffer in memory immediately after wrapping
    dek.fill(0);

    // Pack [kekIv (12B) | kekTag (16B) | wrappedDek (32B)]
    const wrappedDekBundleB64 = Buffer.concat([kekIv, kekTag, wrappedDek]).toString(
      'base64url',
    );

    return `${this.PREFIX}:${kekVersion}:${wrappedDekBundleB64}:${cipherBundleB64}`;
  }

  /**
   * Unwraps the DEK using the envelope's KEK version and decrypts the token.
   * Throws immediately if the ciphertext was tampered with or moved across tenants.
   */
  decrypt(
    envelope: string,
    tenantId: string,
    purpose: TokenPurpose,
  ): { plaintext: string; needsKeyRotation: boolean } {
    const parts = envelope.split(':');
    if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== this.PREFIX) {
      throw new Error('Malformed or unencrypted Vexel token envelope');
    }

    const [, , kekVersion, wrappedDekBundleB64, cipherBundleB64] = parts;
    const kek = this.keyRing.keys[kekVersion];
    if (!kek) {
      throw new Error(`Unknown or retired KEK version "${kekVersion}"`);
    }

    const aad = Buffer.from(`${tenantId}:${purpose}`, 'utf8');

    // 1. Unpack & unwrap the DEK using Master KEK
    const wrappedDekBuf = Buffer.from(wrappedDekBundleB64, 'base64url');
    const kekIv = wrappedDekBuf.subarray(0, this.IV_LENGTH);
    const kekTag = wrappedDekBuf.subarray(
      this.IV_LENGTH,
      this.IV_LENGTH + this.TAG_LENGTH,
    );
    const wrappedDek = wrappedDekBuf.subarray(this.IV_LENGTH + this.TAG_LENGTH);

    const kekDecipher = createDecipheriv(this.ALGORITHM, kek, kekIv, {
      authTagLength: this.TAG_LENGTH,
    });
    kekDecipher.setAAD(aad);
    kekDecipher.setAuthTag(kekTag);

    const dek = Buffer.concat([
      kekDecipher.update(wrappedDek),
      kekDecipher.final(),
    ]);

    try {
      // 2. Unpack & decrypt the token payload using the recovered DEK
      const cipherBuf = Buffer.from(cipherBundleB64, 'base64url');
      const dataIv = cipherBuf.subarray(0, this.IV_LENGTH);
      const dataTag = cipherBuf.subarray(
        this.IV_LENGTH,
        this.IV_LENGTH + this.TAG_LENGTH,
      );
      const encryptedData = cipherBuf.subarray(this.IV_LENGTH + this.TAG_LENGTH);

      const dataDecipher = createDecipheriv(this.ALGORITHM, dek, dataIv, {
        authTagLength: this.TAG_LENGTH,
      });
      dataDecipher.setAAD(aad);
      dataDecipher.setAuthTag(dataTag);

      const plaintext = Buffer.concat([
        dataDecipher.update(encryptedData),
        dataDecipher.final(),
      ]).toString('utf8');

      return {
        plaintext,
        needsKeyRotation: kekVersion !== this.keyRing.activeVersion,
      };
    } finally {
      // Always zero out the unwrapped DEK from V8 heap memory
      dek.fill(0);
    }
  }

  /**
   * Loads 64-character hex (32-byte) master keys from environment variables:
   * VEXEL_ACTIVE_KEK_VERSION="v1"
   * VEXEL_KEK_V1="<64-hex-chars>"
   * VEXEL_KEK_V2="<64-hex-chars>" (optional for rotation)
   */
  private loadKeyRingFromEnv(): KeyRing {
    const activeVersion = process.env.VEXEL_ACTIVE_KEK_VERSION || 'v1';
    const keys: Record<string, Buffer> = {};

    for (const [envKey, envVal] of Object.entries(process.env)) {
      if (envKey.startsWith('VEXEL_KEK_V') && envVal) {
        const version = envKey.replace('VEXEL_KEK_', '').toLowerCase(); // "v1", "v2"
        const keyBuf = Buffer.from(envVal, 'hex');
        if (keyBuf.length !== 32) {
          throw new Error(
            `Invalid length for ${envKey}: expected 32 bytes (64 hex chars), got ${keyBuf.length}`,
          );
        }
        keys[version] = keyBuf;
      }
    }

    if (!keys[activeVersion]) {
      throw new Error(
        `Missing master key environment variable for active version "${activeVersion}"`,
      );
    }

    return { activeVersion, keys };
  }
}