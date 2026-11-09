import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getActiveStepFromStatus } from '../resume-helper';
import { isValidE164, normalizePhoneInput } from '../../../lib/phone';
import { OnboardingStepper } from '../onboarding-stepper';
import type { OnboardingStatus } from '../../../lib/types';

// Mock next-intl translations
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: any) => {
    const translations: Record<string, string> = {
      'hubspot.title': 'Connect HubSpot',
      'hubspot.desc': 'Authorize Vexel to read and update deal pipelines and owners',
      'whatsapp.title': 'Connect WhatsApp',
      'whatsapp.desc': 'Link your WhatsApp Business phone number and Cloud API credentials',
      'reps.title': 'Pair Sales Reps',
      'reps.desc': 'Map sales team members with their WhatsApp phones',
      'rules.title': 'Rules & Activation',
      'rules.desc': 'Configure confidence thresholds and send a test voice note',
    };
    return translations[key] || key;
  },
}));

describe('Onboarding Resume Behavior', () => {
  const baseStatus: OnboardingStatus = {
    tenantId: 'tenant_123',
    tenantName: 'Acme RevOps',
    tenantSlug: 'acme-revops',
    hubspotConnected: false,
    hubspotPortalId: null,
    whatsappConnected: false,
    whatsappPhoneId: null,
    repsLinkedCount: 0,
    totalRepsCount: 3,
    firstRunReceived: false,
    firstRunAt: null,
    autoSyncThreshold: 85,
    manualMinutesPerUpdate: 5,
  };

  it('resumes at Step 1 (Connect HubSpot) when HubSpot is not connected', () => {
    const step = getActiveStepFromStatus({
      ...baseStatus,
      hubspotConnected: false,
    });
    expect(step).toBe(1);
  });

  it('resumes at Step 2 (Connect WhatsApp) when HubSpot is connected but WhatsApp is not', () => {
    const step = getActiveStepFromStatus({
      ...baseStatus,
      hubspotConnected: true,
      hubspotPortalId: '9876543',
      whatsappConnected: false,
    });
    expect(step).toBe(2);
  });

  it('resumes at Step 3 (Pair Sales Reps) when WhatsApp is connected but 0 reps are linked', () => {
    const step = getActiveStepFromStatus({
      ...baseStatus,
      hubspotConnected: true,
      whatsappConnected: true,
      whatsappPhoneId: 'wa_phone_123',
      repsLinkedCount: 0,
    });
    expect(step).toBe(3);
  });

  it('resumes at Step 4 (Rules & Activation) when at least 1 rep has a linked WhatsApp phone', () => {
    const step = getActiveStepFromStatus({
      ...baseStatus,
      hubspotConnected: true,
      whatsappConnected: true,
      whatsappPhoneId: 'wa_phone_123',
      repsLinkedCount: 2,
    });
    expect(step).toBe(4);
  });

  it('maintains Step 4 when firstRunReceived is true', () => {
    const step = getActiveStepFromStatus({
      ...baseStatus,
      hubspotConnected: true,
      whatsappConnected: true,
      repsLinkedCount: 2,
      firstRunReceived: true,
      firstRunAt: '2026-11-09T03:00:00Z',
    });
    expect(step).toBe(4);
  });
});

describe('E.164 Phone Number Validation', () => {
  it('accepts valid E.164 international numbers across countries', () => {
    expect(isValidE164('+201012345678')).toBe(true); // Egypt
    expect(isValidE164('+14155552671')).toBe(true);  // US
    expect(isValidE164('+447911123456')).toBe(true);  // UK
    expect(isValidE164('+971501112233')).toBe(true);  // UAE
    expect(isValidE164('+966501234567')).toBe(true);  // Saudi Arabia
  });

  it('rejects invalid or malformed phone numbers', () => {
    expect(isValidE164('01012345678')).toBe(false);       // missing leading +
    expect(isValidE164('+')).toBe(false);                 // just +
    expect(isValidE164('+012345678')).toBe(false);        // country code starts with 0
    expect(isValidE164('not-a-number')).toBe(false);      // letters
    expect(isValidE164('')).toBe(false);                  // empty
    expect(isValidE164('+1234567890123456')).toBe(false); // > 15 digits
  });

  it('normalizes formatted phone inputs by removing spaces and dashes', () => {
    expect(normalizePhoneInput('+20 101 234 5678')).toBe('+201012345678');
    expect(normalizePhoneInput('+1 (415) 555-2671')).toBe('+14155552671');
    expect(normalizePhoneInput('010 1234 5678')).toBe('+01012345678');
  });
});

describe('OnboardingStepper Component', () => {
  it('renders all 4 steps and marks completed steps with checkmark', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingStepper, {
        currentStep: 3,
        completedSteps: [1, 2],
        onSelectStep: vi.fn(),
      }),
    );

    expect(html).toContain('Connect HubSpot');
    expect(html).toContain('Connect WhatsApp');
    expect(html).toContain('Pair Sales Reps');
    expect(html).toContain('Rules &amp; Activation');
  });

  it('highlights current active step and disables future steps', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingStepper, {
        currentStep: 2,
        completedSteps: [1],
        onSelectStep: vi.fn(),
      }),
    );

    // Current step has primary highlight ring
    expect(html).toContain('ring-primary');
    // Step 4 is disabled (opacity-50 cursor-not-allowed)
    expect(html).toContain('cursor-not-allowed');
  });
});

