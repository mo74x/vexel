import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunFilters } from '../run-filters';
import { mockLabelsFixture, mockRepsFixture } from '../../../__tests__/fixtures';

describe('RunFilters Component', () => {
  const defaultLabels = {
    search: 'Search by deal ID or change summary...',
    status: 'Status',
    allStatuses: 'All Statuses',
    outcome: 'Outcome',
    allOutcomes: 'All Outcomes',
    rep: 'Representative',
    allReps: 'All Representatives',
    dateRange: 'Time Range',
    allDates: 'All Time',
    today: 'Today',
    last7Days: 'Last 7 Days',
    last30Days: 'Last 30 Days',
    reset: 'Reset Filters',
    statusChips: mockLabelsFixture.statusChips,
    outcomeChips: mockLabelsFixture.outcomeChips,
  };

  it('renders search input, status options, and representatives list', () => {
    const html = renderToStaticMarkup(
      React.createElement(RunFilters, {
        filters: {
          search: '',
          status: '',
          outcome: '',
          repId: '',
          dateRange: '',
        },
        onChange: vi.fn(),
        onReset: vi.fn(),
        reps: mockRepsFixture,
        labels: defaultLabels,
      }),
    );

    expect(html).toContain('data-testid="filter-search-input"');
    expect(html).toContain('placeholder="Search by deal ID or change summary..."');
    expect(html).toContain('data-testid="filter-status-select"');
    expect(html).toContain('data-testid="filter-rep-select"');
    expect(html).toContain('Kareem Tarek');
    expect(html).toContain('Sarah Nabil');
    // Reset button is not rendered when no filters are set
    expect(html).not.toContain('data-testid="filter-reset-button"');
  });

  it('renders reset button when active filters are present', () => {
    const html = renderToStaticMarkup(
      React.createElement(RunFilters, {
        filters: {
          search: '45000',
          status: 'COMPLETED',
          outcome: '',
          repId: 'rep_1',
          dateRange: '7d',
        },
        onChange: vi.fn(),
        onReset: vi.fn(),
        reps: mockRepsFixture,
        labels: defaultLabels,
      }),
    );

    expect(html).toContain('data-testid="filter-reset-button"');
    expect(html).toContain('Reset Filters');
  });
});
