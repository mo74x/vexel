import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImpactKpiCards } from '../impact-kpi-cards';
import { ImpactDatePicker } from '../impact-date-picker';
import { ImpactChart } from '../impact-chart';
import { ImpactRepsTable } from '../impact-reps-table';
import { ImpactSkeleton } from '../impact-skeleton';
import type { MetricsSummary } from '../../../lib/types';

// Mock next-intl translations
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: any) => {
    const translations: Record<string, string> = {
      'totalRuns': 'Total Runs',
      'totalRunsDesc': 'Voice notes processed in window',
      'autoSyncRate': 'Auto-Sync Rate',
      'autoSyncRateDesc': 'Synced straight through to HubSpot',
      'approvalRate': 'Approval Rate',
      'approvalRateDesc': 'Of notes forwarded for rep review',
      'editRate': 'Override Rate',
      'editRateDesc': 'Of approved notes edited by rep',
      'timeSaved': 'Estimated Time Saved',
      'timeSavedBadge': 'Est.',
      'timeSavedDesc': `At ${values?.minutes}m baseline per manual update`,
      'editInSettings': 'Edit baseline in Settings',
      'costPerRun': 'Cost per Run',
      'costPerRunDesc': `Total meter spend: $${values?.total}`,
      'preset7d': 'Last 7 Days',
      'preset30d': 'Last 30 Days',
      'preset90d': 'Last 90 Days',
      'custom': 'Custom Range',
      'from': 'From Date',
      'to': 'To Date',
      'apply': 'Apply Filter',
      'title': 'Daily Run Volume by Outcome',
      'subtitle': 'Daily distribution of voice notes synchronized, reviewed, and declined',
      'empty': 'No activity recorded in the selected date range.',
      'legend.autoSynced': 'Auto-Synced',
      'legend.approvedAsIs': 'Approved as Transcribed',
      'legend.approvedWithOverride': 'Approved with Edits',
      'legend.rejected': 'Declined by Rep',
      'legend.failed': 'Failed',
      'rep': 'Representative',
      'total': 'Runs',
      'autoSynced': 'Auto-Synced',
      'approved': 'Approved',
      'rejected': 'Declined',
      'avgConfidence': 'Avg Confidence',
    };
    return translations[key] || key;
  },
}));

describe('Impact Page Components', () => {
  const mockMetrics: MetricsSummary = {
    window: { from: '2026-10-10T00:00:00Z', to: '2026-11-09T00:00:00Z' },
    totalRuns: 120,
    runsByOutcome: {
      AUTO_SYNCED: 85,
      APPROVED_AS_IS: 20,
      APPROVED_WITH_OVERRIDE: 8,
      REJECTED: 5,
      EXPIRED: 0,
      UNDONE: 1,
      FAILED: 1,
    },
    runsByStatus: {
      PENDING: 0,
      RUNNING: 0,
      WAITING_APPROVAL: 0,
      COMPLETED: 114,
      FAILED: 1,
      DEAD_LETTER: 0,
    },
    autoSyncRate: 70.8,
    approvalRate: 84.8,
    editRate: 28.6,
    averageConfidence: 89.4,
    estimatedMinutesSaved: 678, // 11.3 hrs
    manualMinutesPerUpdate: 6,
    totalCostUsd: 1.8425,
    costPerRun: 0.0154,
    dailyBuckets: [
      {
        date: '2026-11-01',
        total: 5,
        autoSynced: 3,
        approvedAsIs: 1,
        approvedWithOverride: 1,
        rejected: 0,
        failed: 0,
      },
      {
        date: '2026-11-02',
        total: 8,
        autoSynced: 6,
        approvedAsIs: 1,
        approvedWithOverride: 0,
        rejected: 1,
        failed: 0,
      },
    ],
    repsActivity: [
      {
        repId: 'rep_tamer',
        fullName: 'Tamer Zaki',
        email: 'tamer@vexel-demo.com',
        totalRuns: 45,
        autoSyncedCount: 32,
        approvedCount: 10,
        overrideCount: 3,
        rejectedCount: 2,
        averageConfidence: 91.2,
      },
      {
        repId: 'rep_layla',
        fullName: 'Layla Al-Khatib',
        email: 'layla@vexel-demo.com',
        totalRuns: 38,
        autoSyncedCount: 28,
        approvedCount: 7,
        overrideCount: 2,
        rejectedCount: 1,
        averageConfidence: 89.0,
      },
    ],
  };

  describe('ImpactKpiCards', () => {
    it('renders all 6 KPI cards with correct data and clear estimate label', () => {
      const html = renderToStaticMarkup(
        React.createElement(ImpactKpiCards, {
          metrics: mockMetrics,
          locale: 'en',
        }),
      );

      // Total Runs
      expect(html).toContain('data-testid="kpi-total-runs"');
      expect(html).toContain('120');

      // Auto-Sync Rate
      expect(html).toContain('data-testid="kpi-auto-sync-rate"');
      expect(html).toContain('70.8%');

      // Approval Rate
      expect(html).toContain('data-testid="kpi-approval-rate"');
      expect(html).toContain('84.8%');

      // Override / Edit Rate
      expect(html).toContain('data-testid="kpi-edit-rate"');
      expect(html).toContain('28.6%');

      // Time Saved with Est. Badge
      expect(html).toContain('data-testid="kpi-time-saved"');
      expect(html).toContain('11.3 hrs');
      expect(html).toContain('Est.');
      expect(html).toContain('At 6m baseline per manual update');
      expect(html).toContain('/en/settings');

      // Cost per run
      expect(html).toContain('data-testid="kpi-cost-per-run"');
      expect(html).toContain('$0.0154');
      expect(html).toContain('$1.8425');
    });
  });

  describe('ImpactDatePicker', () => {
    it('renders presets with active preset selected', () => {
      const html = renderToStaticMarkup(
        React.createElement(ImpactDatePicker, {
          activePreset: '30d',
          onSelectPreset: vi.fn(),
          onCustomRangeApply: vi.fn(),
        }),
      );

      expect(html).toContain('Last 7 Days');
      expect(html).toContain('Last 30 Days');
      expect(html).toContain('Last 90 Days');
      expect(html).toContain('Custom Range');
    });
  });

  describe('ImpactChart', () => {
    it('renders SVG chart with daily buckets and outcome legend', () => {
      const html = renderToStaticMarkup(
        React.createElement(ImpactChart, {
          dailyBuckets: mockMetrics.dailyBuckets,
          locale: 'en',
        }),
      );

      expect(html).toContain('<svg');
      expect(html).toContain('role="img"');
      expect(html).toContain('Auto-Synced');
      expect(html).toContain('Approved as Transcribed');
      expect(html).toContain('Approved with Edits');
      expect(html).toContain('Declined by Rep');
    });

    it('renders empty message when no daily data exists', () => {
      const html = renderToStaticMarkup(
        React.createElement(ImpactChart, {
          dailyBuckets: [],
          locale: 'en',
        }),
      );

      expect(html).toContain('No activity recorded in the selected date range.');
    });
  });

  describe('ImpactRepsTable', () => {
    it('renders sales team activity rows with avatar initials and counts', () => {
      const html = renderToStaticMarkup(
        React.createElement(ImpactRepsTable, {
          repsActivity: mockMetrics.repsActivity,
        }),
      );

      expect(html).toContain('Tamer Zaki');
      expect(html).toContain('tamer@vexel-demo.com');
      expect(html).toContain('TZ');
      expect(html).toContain('Layla Al-Khatib');
      expect(html).toContain('91.2%');
    });
  });

  describe('ImpactSkeleton', () => {
    it('renders loading skeleton placeholder cards', () => {
      const html = renderToStaticMarkup(React.createElement(ImpactSkeleton));
      expect(html).toContain('data-testid="impact-skeleton"');
      expect(html).toContain('animate-pulse');
    });
  });
});

