import { describe, it, expect } from 'vitest';
import { getDemoSeedDataset } from '../seed-demo';
import { RunOutcome, RunStatus } from '@prisma/client';

describe('Demo Tenant Seed Dataset', () => {
  const dataset = getDemoSeedDataset();

  it('provisions demo tenant with valid settings and sealed tokens', () => {
    expect(dataset.tenant.id).toBe('tenant_demo_mena');
    expect(dataset.tenant.name).toBe('Acme MENA Corp');
    expect(dataset.tenant.slug).toBe('acme-mena-corp');
    expect(dataset.tenant.hubspotAccessToken).toContain('vexel:enc:');
    expect(dataset.tenant.whatsappAccessToken).toContain('vexel:enc:');
    expect(dataset.tenant.autoSyncThreshold).toBe(85);
    expect(dataset.tenant.manualMinutesPerUpdate).toBe(6);
    expect(dataset.tenant.locale).toBe('ar');
  });

  it('provisions demo users across Admin, Manager, and Support roles', () => {
    expect(dataset.users.length).toBe(3);
    const roles = dataset.users.map((u) => u.role);
    expect(roles).toContain('ADMIN');
    expect(roles).toContain('MANAGER');
    expect(roles).toContain('SUPPORT');
  });

  it('provisions sales representatives with valid E.164 phone numbers', () => {
    expect(dataset.reps.length).toBe(4);
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    for (const rep of dataset.reps) {
      expect(e164Regex.test(rep.whatsappPhone)).toBe(true);
      expect(rep.email).toContain('@');
      expect(rep.hubspotOwnerId).toBeDefined();
    }
  });

  it('includes realistic Arabic and English runs across diverse outcomes', () => {
    const runs = dataset.runsToCreate;
    expect(runs.length).toBeGreaterThanOrEqual(10);

    // Verify Arabic voice transcripts (Egyptian & Gulf)
    const arabicRuns = runs.filter((r) => /[\u0600-\u06FF]/.test(r.transcript));
    expect(arabicRuns.length).toBeGreaterThanOrEqual(5);

    // Verify English runs
    const englishRuns = runs.filter((r) => /^[A-Za-z0-9\s.,'?!$-]+$/.test(r.transcript));
    expect(englishRuns.length).toBeGreaterThanOrEqual(3);

    // Verify outcome diversity
    const outcomes = runs.map((r) => r.outcome);
    expect(outcomes).toContain(RunOutcome.AUTO_SYNCED);
    expect(outcomes).toContain(RunOutcome.APPROVED_AS_IS);
    expect(outcomes).toContain(RunOutcome.APPROVED_WITH_OVERRIDE);
    expect(outcomes).toContain(RunOutcome.UNDONE);
    expect(outcomes).toContain(RunOutcome.FAILED);

    // Verify WAITING_APPROVAL status
    const waitingRun = runs.find((r) => r.status === RunStatus.WAITING_APPROVAL);
    expect(waitingRun).toBeDefined();
    expect(waitingRun?.outcome).toBeNull();
  });
});

