import * as React from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export interface LoadingStateProps {
  message?: string;
  rows?: number;
  className?: string;
}

export function LoadingState({
  message = 'Loading data...',
  rows = 3,
  className,
}: LoadingStateProps) {
  return (
    <div className={cn('space-y-4 p-6', className)}>
      <div className="flex items-center gap-3">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        <span className="text-sm text-muted-foreground font-medium">{message}</span>
      </div>
      <div className="space-y-3 pt-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 rounded-md border border-border/50 p-4 bg-card/50"
          >
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

