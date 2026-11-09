'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MetricsSummary } from '@/lib/types';

export interface ImpactKpiCardsProps {
  metrics: MetricsSummary;
  locale: string;
}

export function ImpactKpiCards({ metrics, locale }: ImpactKpiCardsProps) {
  const t = useTranslations('impact.kpis');

  // Format time saved: if >= 60 mins -> X.X hrs, otherwise X mins
  const formatTimeSaved = (minutes: number) => {
    if (minutes >= 60) {
      const hours = (minutes / 60).toFixed(1);
      return `${hours} hrs`;
    }
    return `${minutes} mins`;
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
      {/* 1. Total Runs */}
      <Card
        data-testid="kpi-total-runs"
        className="p-4 rounded-xl border-border bg-card shadow-sm hover:-translate-y-0.5 transition-transform duration-200 flex flex-col justify-between"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">{t('totalRuns')}</span>
          <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
            {metrics.totalRuns.toLocaleString()}
          </span>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{t('totalRunsDesc')}</p>
        </div>
      </Card>

      {/* 2. Auto-Sync Rate */}
      <Card
        data-testid="kpi-auto-sync-rate"
        className="p-4 rounded-xl border-border bg-card shadow-sm hover:-translate-y-0.5 transition-transform duration-200 flex flex-col justify-between"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">{t('autoSyncRate')}</span>
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
            {metrics.autoSyncRate}%
          </span>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{t('autoSyncRateDesc')}</p>
        </div>
      </Card>

      {/* 3. Approval Rate */}
      <Card
        data-testid="kpi-approval-rate"
        className="p-4 rounded-xl border-border bg-card shadow-sm hover:-translate-y-0.5 transition-transform duration-200 flex flex-col justify-between"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">{t('approvalRate')}</span>
          <span className="flex h-2 w-2 rounded-full bg-blue-500" />
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold font-mono tracking-tight text-blue-600 dark:text-blue-400">
            {metrics.approvalRate}%
          </span>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{t('approvalRateDesc')}</p>
        </div>
      </Card>

      {/* 4. Edit / Override Rate */}
      <Card
        data-testid="kpi-edit-rate"
        className="p-4 rounded-xl border-border bg-card shadow-sm hover:-translate-y-0.5 transition-transform duration-200 flex flex-col justify-between"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">{t('editRate')}</span>
          <span className="flex h-2 w-2 rounded-full bg-amber-500" />
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold font-mono tracking-tight text-amber-600 dark:text-amber-400">
            {metrics.editRate}%
          </span>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{t('editRateDesc')}</p>
        </div>
      </Card>

      {/* 5. Estimated Time Saved (Clearly labeled as Estimate) */}
      <Card
        data-testid="kpi-time-saved"
        className="p-4 rounded-xl border-border bg-card shadow-sm hover:-translate-y-0.5 transition-transform duration-200 flex flex-col justify-between ring-1 ring-primary/20"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium text-foreground">{t('timeSaved')}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary font-semibold">
            {t('timeSavedBadge')}
          </Badge>
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
            {formatTimeSaved(metrics.estimatedMinutesSaved)}
          </span>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t('timeSavedDesc', { minutes: metrics.manualMinutesPerUpdate })}
          </p>
          <Link
            href={`/${locale}/settings`}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            {t('editInSettings')} &rarr;
          </Link>
        </div>
      </Card>

      {/* 6. Cost per Run */}
      <Card
        data-testid="kpi-cost-per-run"
        className="p-4 rounded-xl border-border bg-card shadow-sm hover:-translate-y-0.5 transition-transform duration-200 flex flex-col justify-between"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">{t('costPerRun')}</span>
          <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
            ${metrics.costPerRun.toFixed(4)}
          </span>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
            {t('costPerRunDesc', { total: metrics.totalCostUsd.toFixed(4) })}
          </p>
        </div>
      </Card>
    </div>
  );
}

