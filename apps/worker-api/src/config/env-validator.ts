export interface EnvValidationResult {
  valid: boolean;
  processRole: 'api' | 'worker' | 'both';
  errors: string[];
}

/**
 * Validates critical encryption keys and runtime secrets at application boot.
 * In production (or when strict=true), throws immediately if any required variable is missing or malformed.
 */
export function validateRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
  strict = env.NODE_ENV === 'production',
): EnvValidationResult {
  const errors: string[] = [];
  const rawRole = (env.VEXEL_PROCESS_ROLE || 'both').toLowerCase();
  const processRole: 'api' | 'worker' | 'both' =
    rawRole === 'api' || rawRole === 'worker' ? rawRole : 'both';

  const activeKekVersion = env.VEXEL_ACTIVE_KEK_VERSION || 'v1';
  const activeKekEnvKey = `VEXEL_KEK_${activeKekVersion.toUpperCase()}`;
  const activeKekHex = env[activeKekEnvKey];

  if (!activeKekHex || !/^[0-9a-fA-F]{64}$/.test(activeKekHex)) {
    errors.push(
      `${activeKekEnvKey} must be set to a 64-character hex string (32-byte AES-256-GCM master key)`,
    );
  }

  if (!env.VEXEL_APPROVAL_HMAC_SECRET || env.VEXEL_APPROVAL_HMAC_SECRET.length < 16) {
    errors.push('VEXEL_APPROVAL_HMAC_SECRET must be at least 16 characters');
  }

  if (processRole === 'worker' || processRole === 'both') {
    if (!env.OPENAI_API_KEY) {
      errors.push('OPENAI_API_KEY is required for worker audio transcription');
    }
    if (!env.ANTHROPIC_API_KEY) {
      errors.push('ANTHROPIC_API_KEY is required for worker Zod structured extraction');
    }
  }

  if (strict && errors.length > 0) {
    throw new Error(
      `[Vexel Boot Validation Failed] Invalid environment configuration:\n- ${errors.join('\n- ')}`,
    );
  }

  return {
    valid: errors.length === 0,
    processRole,
    errors,
  };
}
