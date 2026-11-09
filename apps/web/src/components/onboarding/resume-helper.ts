import type { OnboardingStatus } from '@/lib/types';

/**
 * Resolves which step the onboarding wizard should resume at based on the
 * tenant's integration status from GET /v1/app/onboarding/status.
 *
 * Step 1 (Connect HubSpot): if HubSpot is not connected
 * Step 2 (Connect WhatsApp): if HubSpot is connected but WhatsApp is not
 * Step 3 (Pair Sales Reps): if WhatsApp is connected but 0 reps have linked phones
 * Step 4 (Rules & Activation): if at least 1 rep is linked
 */
export function getActiveStepFromStatus(
  status?: Partial<OnboardingStatus> | null,
): 1 | 2 | 3 | 4 {
  if (!status) return 1;
  if (!status.hubspotConnected) return 1;
  if (!status.whatsappConnected) return 2;
  if ((status.repsLinkedCount ?? 0) === 0) return 3;
  return 4;
}

