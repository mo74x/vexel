import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, User, Clock, ArrowRight } from 'lucide-react';
import { StatusChip } from './status-chip';
import { ConfidenceBadge } from './confidence-badge';
import { formatRelativeTime } from '@/lib/date-utils';
import type { RunListItem as RunListItemType } from '@/lib/types';

export interface RunListItemProps {
  run: RunListItemType;
  locale: string;
  labels: {
    statusChips: Record<string, string>;
    outcomeChips: Record<string, string>;
  };
}

export function RunListItem({ run, locale, labels }: RunListItemProps) {
  const relativeTime = formatRelativeTime(run.createdAt, locale);
  const repName = run.decidedByRep?.fullName || run.senderPhone || 'Sales Rep';

  return (
    <Link
      href={`/${locale}/activity/${run.id}`}
      className="group block rounded-lg border border-border bg-card p-4 transition-all hover:border-brand-500/50 hover:bg-muted/15 shadow-sm"
      data-testid={`run-row-${run.id}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left Section: Rep + Deal + Summary */}
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Rep Avatar & Name */}
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500/20 text-brand-700 dark:text-brand-300 font-bold text-[10px]">
                {repName.charAt(0).toUpperCase()}
              </div>
              <span className="truncate max-w-[140px]">{repName}</span>
            </div>

            <span className="text-muted-foreground/40">•</span>

            {/* Deal ID */}
            {run.externalDealId ? (
              <span className="font-mono text-xs text-muted-foreground font-semibold">
                #{run.externalDealId}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground italic">
                {run.workflowName}
              </span>
            )}

            {/* Status & Outcome Chip */}
            <StatusChip
              status={run.status}
              outcome={run.outcome}
              labels={{
                status: labels.statusChips,
                outcome: labels.outcomeChips,
              }}
            />
          </div>

          {/* One-Line Change Summary */}
          <p className="text-sm text-foreground font-normal line-clamp-1 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">
            {run.oneLineSummary || 'Updated deal properties in HubSpot.'}
          </p>
        </div>

        {/* Right Section: Confidence + Time + Nav Arrow */}
        <div className="flex items-center gap-3 shrink-0 pt-1 sm:pt-0 border-t border-border/40 sm:border-0 justify-between sm:justify-end">
          <ConfidenceBadge score={run.confidenceScore} />

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="whitespace-nowrap">{relativeTime}</span>
          </div>

          <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 transition-all hidden sm:block" />
        </div>
      </div>
    </Link>
  );
}

