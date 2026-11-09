'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Inbox, Loader2 } from 'lucide-react';
import { useRuns, useReps } from '@/hooks/use-vexel-api';
import { RunFilters, type FilterState } from '@/components/activity/run-filters';
import { RunListItem } from '@/components/activity/run-list-item';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadingState } from '@/components/shared/loading-state';
import { ErrorState } from '@/components/shared/error-state';
import { Button } from '@/components/ui/button';
import type { RunListItem as RunListItemType } from '@/lib/types';

export default function ActivityPage() {
  const t = useTranslations('activity');
  const params = useParams();
  const locale = (params.locale as string) || 'en';

  const [filters, setFilters] = React.useState<FilterState>({
    search: '',
    status: '',
    outcome: '',
    repId: '',
    dateRange: '',
  });

  // Calculate ISO date string for date ranges
  const dateParams = React.useMemo(() => {
    if (!filters.dateRange || filters.dateRange === 'all') return {};
    const now = new Date();
    const from = new Date();

    if (filters.dateRange === 'today') {
      from.setHours(0, 0, 0, 0);
    } else if (filters.dateRange === '7d') {
      from.setDate(now.getDate() - 7);
    } else if (filters.dateRange === '30d') {
      from.setDate(now.getDate() - 30);
    }

    return { from: from.toISOString(), to: now.toISOString() };
  }, [filters.dateRange]);

  // Fetch sales representatives for filter dropdown
  const { data: reps } = useReps();

  // Polling query: fetches latest runs every 15 seconds
  const {
    data: runData,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useRuns(
    {
      status: filters.status || undefined,
      repId: filters.repId || undefined,
      from: dateParams.from,
      to: dateParams.to,
      limit: 25,
    },
    {
      refetchInterval: 15_000, // Polling every 15 seconds for fresh runs
    },
  );

  // Accumulated items state for cursor pagination
  const [accumulatedRuns, setAccumulatedRuns] = React.useState<RunListItemType[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  // Sync first page items
  React.useEffect(() => {
    if (runData?.items) {
      setAccumulatedRuns(runData.items);
      setCursor(runData.nextCursor ?? null);
    }
  }, [runData]);

  // Load more runs with cursor pagination
  const handleLoadMore = async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);

    try {
      const res = await (await import('@/lib/api-client')).vexelApi.runs.list({
        status: filters.status || undefined,
        repId: filters.repId || undefined,
        from: dateParams.from,
        to: dateParams.to,
        cursor,
        limit: 25,
      });

      setAccumulatedRuns((prev) => [...prev, ...res.items]);
      setCursor(res.nextCursor ?? null);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Client-side text search on deal or summary
  const visibleRuns = React.useMemo(() => {
    if (!filters.search) return accumulatedRuns;
    const query = filters.search.toLowerCase();
    return accumulatedRuns.filter(
      (run) =>
        run.externalDealId?.toLowerCase().includes(query) ||
        run.oneLineSummary.toLowerCase().includes(query) ||
        run.decidedByRep?.fullName.toLowerCase().includes(query) ||
        run.senderPhone?.toLowerCase().includes(query),
    );
  }, [accumulatedRuns, filters.search]);

  const handleFilterChange = (updated: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...updated }));
  };

  const handleResetFilters = () => {
    setFilters({
      search: '',
      status: '',
      outcome: '',
      repId: '',
      dateRange: '',
    });
  };

  const filterLabels = {
    search: t('search'),
    status: t('filters.status'),
    allStatuses: t('filters.allStatuses'),
    outcome: t('filters.outcome'),
    allOutcomes: t('filters.allOutcomes'),
    rep: t('filters.rep'),
    allReps: t('filters.allReps'),
    dateRange: t('filters.dateRange'),
    allDates: t('filters.allDates'),
    today: t('filters.today'),
    last7Days: t('filters.last7Days'),
    last30Days: t('filters.last30Days'),
    reset: t('filters.reset'),
    statusChips: {
      PENDING: t('statusChips.PENDING'),
      RUNNING: t('statusChips.RUNNING'),
      WAITING_APPROVAL: t('statusChips.WAITING_APPROVAL'),
      COMPLETED: t('statusChips.COMPLETED'),
      FAILED: t('statusChips.FAILED'),
      DEAD_LETTER: t('statusChips.DEAD_LETTER'),
    },
    outcomeChips: {
      AUTO_SYNCED: t('outcomeChips.AUTO_SYNCED'),
      APPROVED_AS_IS: t('outcomeChips.APPROVED_AS_IS'),
      APPROVED_WITH_OVERRIDE: t('outcomeChips.APPROVED_WITH_OVERRIDE'),
      REJECTED: t('outcomeChips.REJECTED'),
      EXPIRED: t('outcomeChips.EXPIRED'),
      UNDONE: t('outcomeChips.UNDONE'),
      FAILED: t('outcomeChips.FAILED'),
    },
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* Live Polling Indicator */}
        <div className="flex items-center gap-2 rounded-full border border-border bg-card ps-3 pe-3 py-1 text-xs text-muted-foreground shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span>{t('pagination.liveBadge')}</span>
          {isFetching && !isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ms-1" />
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <RunFilters
        filters={filters}
        onChange={handleFilterChange}
        onReset={handleResetFilters}
        reps={reps || []}
        labels={filterLabels}
      />

      {/* Loading State */}
      {isLoading && <LoadingState message="Fetching live workflow queue..." rows={4} />}

      {/* Error State */}
      {isError && (
        <ErrorState
          title="Could not load activity runs"
          description="Failed to fetch workflow queue from the backend."
          retry={() => refetch()}
        />
      )}

      {/* Empty State */}
      {!isLoading && !isError && visibleRuns.length === 0 && (
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      )}

      {/* List of Runs */}
      {!isLoading && !isError && visibleRuns.length > 0 && (
        <div className="space-y-3" data-testid="run-list-items">
          {visibleRuns.map((run) => (
            <RunListItem
              key={run.id}
              run={run}
              locale={locale}
              labels={{
                statusChips: filterLabels.statusChips,
                outcomeChips: filterLabels.outcomeChips,
              }}
            />
          ))}

          {/* Cursor Pagination Button */}
          {cursor && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="gap-2 min-w-[160px]"
                data-testid="load-more-runs-button"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>{t('pagination.loadingMore')}</span>
                  </>
                ) : (
                  <span>{t('pagination.loadMore')}</span>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
