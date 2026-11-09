'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useMetrics } from '@/hooks/use-vexel-api';
import { ImpactDatePicker } from '@/components/impact/impact-date-picker';
import { ImpactKpiCards } from '@/components/impact/impact-kpi-cards';
import { ImpactChart } from '@/components/impact/impact-chart';
import { ImpactRepsTable } from '@/components/impact/impact-reps-table';
import { ImpactSkeleton } from '@/components/impact/impact-skeleton';
import { ErrorState } from '@/components/shared/error-state';

export default function ImpactPage() {
  const t = useTranslations('impact');
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  // Date range state
  const [activePreset, setActivePreset] = React.useState<'7d' | '30d' | '90d' | 'custom'>('30d');
  const [dateRange, setDateRange] = React.useState<{ from?: string; to?: string }>(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
    };
  });

  const { data: metrics, isLoading, isError, refetch } = useMetrics(dateRange);

  const handleSelectPreset = (preset: '7d' | '30d' | '90d') => {
    setActivePreset(preset);
    const to = new Date();
    const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    setDateRange({
      from: from.toISOString(),
      to: to.toISOString(),
    });
  };

  const handleCustomRangeApply = (from: string, to: string) => {
    setActivePreset('custom');
    setDateRange({ from, to });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* Date Range Picker */}
        <ImpactDatePicker
          from={dateRange.from}
          to={dateRange.to}
          activePreset={activePreset}
          onSelectPreset={handleSelectPreset}
          onCustomRangeApply={handleCustomRangeApply}
        />
      </div>

      {isLoading && <ImpactSkeleton />}

      {isError && (
        <ErrorState
          title="Could not load impact metrics"
          description="Failed to aggregate telemetry data for the selected period."
          retry={() => refetch()}
        />
      )}

      {!isLoading && !isError && metrics && (
        <div className="space-y-6">
          {/* 1. KPI Cards */}
          <ImpactKpiCards metrics={metrics} locale={locale} />

          {/* 2. Daily Chart by Outcome */}
          <ImpactChart dailyBuckets={metrics.dailyBuckets} locale={locale} />

          {/* 3. Reps by Activity Table */}
          <ImpactRepsTable repsActivity={metrics.repsActivity} />
        </div>
      )}
    </div>
  );
}
