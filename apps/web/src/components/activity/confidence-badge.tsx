import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ConfidenceBadgeProps {
  score?: number | null;
  className?: string;
  showLabel?: boolean;
}

export function ConfidenceBadge({
  score,
  className,
  showLabel = false,
}: ConfidenceBadgeProps) {
  if (score === undefined || score === null) {
    return (
      <span className="text-xs text-muted-foreground font-mono">—</span>
    );
  }

  let colorClasses =
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
  let tierLabel = 'High';

  if (score < 70) {
    colorClasses =
      'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30';
    tierLabel = 'Low';
  } else if (score < 85) {
    colorClasses =
      'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30';
    tierLabel = 'Medium';
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border ps-2 pe-2 py-0.5 text-xs font-semibold font-mono',
        colorClasses,
        className,
      )}
      title={`${score}% extraction confidence`}
      data-testid="confidence-badge"
    >
      <span>{score}%</span>
      {showLabel && (
        <span className="font-sans text-[10px] uppercase font-bold tracking-wider opacity-80">
          {tierLabel}
        </span>
      )}
    </div>
  );
}

