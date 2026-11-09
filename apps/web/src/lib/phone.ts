export const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * Validates whether a phone number strictly matches standard E.164 format.
 * Examples of valid: +201012345678, +14155552671, +971501112233
 * Examples of invalid: 01012345678, +012345678, not-a-number, +1
 */
export function isValidE164(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;
  return E164_REGEX.test(phone.trim());
}

/**
 * Normalizes input text into a potential E.164 representation by stripping
 * spaces, hyphens, and brackets. Preserves leading '+' if present.
 */
export function normalizePhoneInput(phone: string): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digitsOnly}` : digitsOnly ? `+${digitsOnly}` : '';
}

