import { MembershipRole } from '@prisma/client';

/**
 * Masks a phone number so only the last 3 digits are visible, preserving country code format prefix.
 * e.g., "+201012345678" -> "+201*****678"
 * If role is ADMIN, returns the unmasked phone number.
 */
export function formatPhoneNumberForRole(
  phone: string | null | undefined,
  role: MembershipRole | null | undefined,
): string | null {
  if (!phone) {
    return null;
  }

  const trimmed = phone.trim();
  if (!trimmed) {
    return null;
  }

  // Admins see full unmasked phone numbers
  if (role === MembershipRole.ADMIN) {
    return trimmed;
  }

  if (trimmed.length <= 3) {
    return trimmed;
  }

  const visibleSuffix = trimmed.slice(-3);
  const prefixAndMiddle = trimmed.slice(0, -3);

  // Mask alphanumeric characters while preserving symbols like '+'
  const maskedPrefix = prefixAndMiddle.replace(/[0-9a-zA-Z]/g, '*');

  return `${maskedPrefix}${visibleSuffix}`;
}

