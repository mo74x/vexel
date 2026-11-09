import * as React from 'react';
import { Search, RotateCcw, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { TenantRepRecord } from '@/lib/types';

export interface FilterState {
  search: string;
  status: string;
  outcome: string;
  repId: string;
  dateRange: string;
}

export interface RunFiltersProps {
  filters: FilterState;
  onChange: (updated: Partial<FilterState>) => void;
  onReset: () => void;
  reps?: TenantRepRecord[];
  labels: {
    search: string;
    status: string;
    allStatuses: string;
    outcome: string;
    allOutcomes: string;
    rep: string;
    allReps: string;
    dateRange: string;
    allDates: string;
    today: string;
    last7Days: string;
    last30Days: string;
    reset: string;
    statusChips: Record<string, string>;
    outcomeChips: Record<string, string>;
  };
}

export function RunFilters({
  filters,
  onChange,
  onReset,
  reps = [],
  labels,
}: RunFiltersProps) {
  const isFiltered =
    Boolean(filters.search) ||
    Boolean(filters.status) ||
    Boolean(filters.outcome) ||
    Boolean(filters.repId) ||
    Boolean(filters.dateRange);

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm md:p-4"
      data-testid="run-filters-container"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder={labels.search}
            className="ps-9 pe-3 text-sm"
            data-testid="filter-search-input"
          />
        </div>

        {/* Filter Controls Row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <select
            value={filters.status}
            onChange={(e) => onChange({ status: e.target.value })}
            aria-label={labels.status}
            className="h-10 rounded-md border border-input bg-background ps-3 pe-8 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground"
            data-testid="filter-status-select"
          >
            <option value="">{labels.allStatuses}</option>
            <option value="WAITING_APPROVAL">
              {labels.statusChips.WAITING_APPROVAL || 'Waiting for Rep'}
            </option>
            <option value="COMPLETED">
              {labels.statusChips.COMPLETED || 'Synced'}
            </option>
            <option value="RUNNING">
              {labels.statusChips.RUNNING || 'Processing'}
            </option>
            <option value="PENDING">
              {labels.statusChips.PENDING || 'Queued'}
            </option>
            <option value="FAILED">
              {labels.statusChips.FAILED || 'Action Required'}
            </option>
          </select>

          {/* Outcome Filter */}
          <select
            value={filters.outcome}
            onChange={(e) => onChange({ outcome: e.target.value })}
            aria-label={labels.outcome}
            className="h-10 rounded-md border border-input bg-background ps-3 pe-8 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground"
            data-testid="filter-outcome-select"
          >
            <option value="">{labels.allOutcomes}</option>
            <option value="AUTO_SYNCED">
              {labels.outcomeChips.AUTO_SYNCED || 'Auto-Synced'}
            </option>
            <option value="APPROVED_AS_IS">
              {labels.outcomeChips.APPROVED_AS_IS || 'Approved as Transcribed'}
            </option>
            <option value="APPROVED_WITH_OVERRIDE">
              {labels.outcomeChips.APPROVED_WITH_OVERRIDE || 'Approved with Edits'}
            </option>
            <option value="UNDONE">
              {labels.outcomeChips.UNDONE || 'Reverted'}
            </option>
            <option value="REJECTED">
              {labels.outcomeChips.REJECTED || 'Declined'}
            </option>
            <option value="FAILED">
              {labels.outcomeChips.FAILED || 'Failed'}
            </option>
          </select>

          {/* Rep Filter */}
          <select
            value={filters.repId}
            onChange={(e) => onChange({ repId: e.target.value })}
            aria-label={labels.rep}
            className="h-10 rounded-md border border-input bg-background ps-3 pe-8 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground"
            data-testid="filter-rep-select"
          >
            <option value="">{labels.allReps}</option>
            {reps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.fullName}
              </option>
            ))}
          </select>

          {/* Date Range Filter */}
          <select
            value={filters.dateRange}
            onChange={(e) => onChange({ dateRange: e.target.value })}
            aria-label={labels.dateRange}
            className="h-10 rounded-md border border-input bg-background ps-3 pe-8 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground"
            data-testid="filter-date-select"
          >
            <option value="">{labels.allDates}</option>
            <option value="today">{labels.today}</option>
            <option value="7d">{labels.last7Days}</option>
            <option value="30d">{labels.last30Days}</option>
          </select>

          {/* Reset Action */}
          {isFiltered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="h-10 gap-1.5 ps-2.5 pe-2.5 text-xs text-muted-foreground hover:text-foreground"
              data-testid="filter-reset-button"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{labels.reset}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

