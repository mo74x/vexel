import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusChip } from '../status-chip';
import { mockLabelsFixture } from '../../../__tests__/fixtures';

describe('StatusChip Component', () => {
  const labels = {
    status: mockLabelsFixture.statusChips,
    outcome: mockLabelsFixture.outcomeChips,
  };

  it('renders AUTO_SYNCED outcome with success badge and plain label', () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusChip, {
        status: 'COMPLETED',
        outcome: 'AUTO_SYNCED',
        labels,
      }),
    );
    expect(html).toContain('data-testid="status-chip-auto-synced"');
    expect(html).toContain('Auto-Synced');
  });

  it('renders APPROVED_WITH_OVERRIDE with custom edit badge', () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusChip, {
        status: 'COMPLETED',
        outcome: 'APPROVED_WITH_OVERRIDE',
        labels,
      }),
    );
    expect(html).toContain('data-testid="status-chip-approved-override"');
    expect(html).toContain('Approved with Edits');
  });

  it('renders UNDONE outcome with warning and reverted label', () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusChip, {
        status: 'COMPLETED',
        outcome: 'UNDONE',
        labels,
      }),
    );
    expect(html).toContain('data-testid="status-chip-undone"');
    expect(html).toContain('Reverted');
  });

  it('renders WAITING_APPROVAL status when outcome is null', () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusChip, {
        status: 'WAITING_APPROVAL',
        outcome: null,
        labels,
      }),
    );
    expect(html).toContain('data-testid="status-chip-waiting"');
    expect(html).toContain('Waiting for Rep');
  });

  it('renders FAILED outcome with destructive badge', () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusChip, {
        status: 'FAILED',
        outcome: 'FAILED',
        labels,
      }),
    );
    expect(html).toContain('data-testid="status-chip-failed"');
    expect(html).toContain('Failed');
  });
});
