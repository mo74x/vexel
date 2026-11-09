import * as React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

export function ImpactSkeleton() {
  return (
    <div className="space-y-6" data-testid="impact-skeleton">
      {/* Date picker skeleton */}
      <Skeleton className="h-12 w-full max-w-md rounded-xl" />

      {/* KPI Cards Skeleton (6 cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-4 rounded-xl border-border bg-card space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-3 rounded-full" />
            </div>
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-2.5 w-24" />
          </Card>
        ))}
      </div>

      {/* Chart Skeleton */}
      <Card className="p-6 rounded-2xl border-border bg-card space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-60" />
          </div>
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-56 w-full rounded-xl" />
      </Card>

      {/* Reps Table Skeleton */}
      <Card className="p-6 rounded-2xl border-border bg-card space-y-4">
        <Skeleton className="h-4 w-36" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-2.5 w-36" />
                </div>
              </div>
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

