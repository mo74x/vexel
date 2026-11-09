'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import type { DailyMetricBucket } from '@/lib/types';

export interface ImpactChartProps {
  dailyBuckets: DailyMetricBucket[];
  locale: string;
}

const OUTCOME_COLORS = {
  autoSynced: '#10b981', // emerald-500
  approvedAsIs: '#3b82f6', // blue-500
  approvedWithOverride: '#f59e0b', // amber-500
  rejected: '#f43f5e', // rose-500
  failed: '#ef4444', // red-500
};

export function ImpactChart({ dailyBuckets, locale }: ImpactChartProps) {
  const t = useTranslations('impact.chart');
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);

  const hasData = dailyBuckets.length > 0 && dailyBuckets.some((b) => b.total > 0);

  // Calculate maximum total across days for Y-axis scale
  const maxVal = Math.max(...dailyBuckets.map((b) => b.total), 4);
  // Round up to nice number
  const yMax = Math.ceil(maxVal * 1.15);

  const chartHeight = 220;
  const paddingBottom = 30;
  const paddingTop = 20;
  const usableHeight = chartHeight - paddingBottom - paddingTop;

  const formatDateLabel = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
        month: 'short',
        day: 'numeric',
      }).format(d);
    } catch {
      return dateStr.slice(5);
    }
  };

  const hoveredBucket = hoveredIndex !== null ? dailyBuckets[hoveredIndex] : null;

  return (
    <Card className="p-6 rounded-2xl border-border bg-card shadow-sm space-y-4">
      {/* Header & Legend */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-foreground">
            {t('title')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: OUTCOME_COLORS.autoSynced }}
            />
            <span className="text-muted-foreground">{t('legend.autoSynced')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: OUTCOME_COLORS.approvedAsIs }}
            />
            <span className="text-muted-foreground">{t('legend.approvedAsIs')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: OUTCOME_COLORS.approvedWithOverride }}
            />
            <span className="text-muted-foreground">{t('legend.approvedWithOverride')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: OUTCOME_COLORS.rejected }}
            />
            <span className="text-muted-foreground">{t('legend.rejected')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: OUTCOME_COLORS.failed }}
            />
            <span className="text-muted-foreground">{t('legend.failed')}</span>
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="flex h-52 items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 text-xs text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <div className="relative">
          {/* Tooltip Popup */}
          {hoveredBucket && (
            <div className="absolute top-0 start-1/2 -translate-x-1/2 z-10 rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs shadow-md backdrop-blur pointer-events-none transition-all">
              <div className="font-semibold text-foreground flex items-center justify-between gap-3 border-b border-border/60 pb-1 mb-1.5">
                <span>{formatDateLabel(hoveredBucket.date)}</span>
                <span className="font-mono">{t('totalTooltip', { count: hoveredBucket.total })}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    {t('legend.autoSynced')}:
                  </span>
                  <span className="font-mono">{hoveredBucket.autoSynced}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-blue-600 dark:text-blue-400 font-medium">
                    {t('legend.approvedAsIs')}:
                  </span>
                  <span className="font-mono">{hoveredBucket.approvedAsIs}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    {t('legend.approvedWithOverride')}:
                  </span>
                  <span className="font-mono">{hoveredBucket.approvedWithOverride}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-rose-600 dark:text-rose-400 font-medium">
                    {t('legend.rejected')}:
                  </span>
                  <span className="font-mono">{hoveredBucket.rejected}</span>
                </div>
                {hoveredBucket.failed > 0 && (
                  <div className="flex items-center justify-between gap-2 col-span-2">
                    <span className="text-red-500 font-medium">{t('legend.failed')}:</span>
                    <span className="font-mono">{hoveredBucket.failed}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SVG Chart */}
          <div className="w-full overflow-x-auto">
            <svg
              className="w-full min-w-[500px]"
              height={chartHeight}
              viewBox={`0 0 ${Math.max(dailyBuckets.length * 32, 500)} ${chartHeight}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={t('title')}
            >
              {/* Horizontal Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
                const y = paddingTop + usableHeight * (1 - pct);
                const labelVal = Math.round(yMax * pct);
                return (
                  <g key={idx}>
                    <line
                      x1={0}
                      x2="100%"
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      strokeOpacity={0.08}
                      strokeDasharray="3 3"
                    />
                    <text
                      x={8}
                      y={y - 3}
                      fill="currentColor"
                      fillOpacity={0.4}
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {labelVal}
                    </text>
                  </g>
                );
              })}

              {/* Stacked Bars per Day */}
              {(() => {
                const totalWidth = Math.max(dailyBuckets.length * 32, 500);
                const barWidth = Math.min(20, (totalWidth / dailyBuckets.length) * 0.65);
                const step = totalWidth / dailyBuckets.length;

                return dailyBuckets.map((bucket, i) => {
                  const x = i * step + (step - barWidth) / 2;
                  const isHovered = hoveredIndex === i;

                  // Heights of segments
                  const calcH = (val: number) => (val / yMax) * usableHeight;

                  const hAuto = calcH(bucket.autoSynced);
                  const hApprAsIs = calcH(bucket.approvedAsIs);
                  const hApprOver = calcH(bucket.approvedWithOverride);
                  const hRej = calcH(bucket.rejected);
                  const hFail = calcH(bucket.failed);

                  // Calculate starting Y from bottom
                  const baseY = paddingTop + usableHeight;
                  const yAuto = baseY - hAuto;
                  const yApprAsIs = yAuto - hApprAsIs;
                  const yApprOver = yApprAsIs - hApprOver;
                  const yRej = yApprOver - hRej;
                  const yFail = yRej - hFail;

                  // Label display step: show label every few bars if many
                  const showLabel =
                    dailyBuckets.length <= 14 ||
                    i % Math.ceil(dailyBuckets.length / 10) === 0 ||
                    i === dailyBuckets.length - 1;

                  return (
                    <g
                      key={bucket.date}
                      onMouseEnter={() => setHoveredIndex(i)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      onFocus={() => setHoveredIndex(i)}
                      onBlur={() => setHoveredIndex(null)}
                      tabIndex={0}
                      className="cursor-pointer outline-none focus:opacity-80"
                      role="graphics-symbol"
                      aria-label={`${bucket.date}: ${bucket.total} runs`}
                    >
                      {/* Background hover highlight column */}
                      <rect
                        x={i * step}
                        y={0}
                        width={step}
                        height={chartHeight - paddingBottom}
                        fill={isHovered ? 'currentColor' : 'transparent'}
                        fillOpacity={isHovered ? 0.05 : 0}
                        rx={4}
                      />

                      {/* Stacked Segments */}
                      {bucket.autoSynced > 0 && (
                        <rect
                          x={x}
                          y={yAuto}
                          width={barWidth}
                          height={hAuto}
                          fill={OUTCOME_COLORS.autoSynced}
                          rx={bucket.total === bucket.autoSynced ? 3 : 0}
                        />
                      )}
                      {bucket.approvedAsIs > 0 && (
                        <rect
                          x={x}
                          y={yApprAsIs}
                          width={barWidth}
                          height={hApprAsIs}
                          fill={OUTCOME_COLORS.approvedAsIs}
                        />
                      )}
                      {bucket.approvedWithOverride > 0 && (
                        <rect
                          x={x}
                          y={yApprOver}
                          width={barWidth}
                          height={hApprOver}
                          fill={OUTCOME_COLORS.approvedWithOverride}
                        />
                      )}
                      {bucket.rejected > 0 && (
                        <rect
                          x={x}
                          y={yRej}
                          width={barWidth}
                          height={hRej}
                          fill={OUTCOME_COLORS.rejected}
                        />
                      )}
                      {bucket.failed > 0 && (
                        <rect
                          x={x}
                          y={yFail}
                          width={barWidth}
                          height={hFail}
                          fill={OUTCOME_COLORS.failed}
                          rx={3}
                        />
                      )}

                      {/* Empty bar placeholder line if 0 runs */}
                      {bucket.total === 0 && (
                        <line
                          x1={x}
                          x2={x + barWidth}
                          y1={baseY}
                          y2={baseY}
                          stroke="currentColor"
                          strokeOpacity={0.2}
                          strokeWidth={2}
                        />
                      )}

                      {/* X-axis date label */}
                      {showLabel && (
                        <text
                          x={x + barWidth / 2}
                          y={chartHeight - 8}
                          textAnchor="middle"
                          fill="currentColor"
                          fillOpacity={isHovered ? 0.9 : 0.5}
                          fontSize="9"
                          fontFamily="sans-serif"
                        >
                          {formatDateLabel(bucket.date)}
                        </text>
                      )}
                    </g>
                  );
                });
              })()}
            </svg>
          </div>
        </div>
      )}
    </Card>
  );
}

