import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunActions } from '../run-actions';
import {
  mockWaitingRunFixture,
  mockCompletedRunFixture,
  mockFailedRunFixture,
} from '../../../__tests__/fixtures';

describe('RunActions Component', () => {
  const actionLabels = {
    openHubSpot: 'Open in HubSpot',
    approve: 'Approve Update',
    approving: 'Approving...',
    reject: 'Decline Update',
    rejecting: 'Declining...',
    replay: 'Replay Run',
    replaying: 'Replaying...',
    undo: 'Undo Sync (15m window)',
    undoAvailable: '15-minute undo snapshot is active',
  };

  it('renders Approve and Reject actions only when run status is WAITING_APPROVAL', () => {
    const html = renderToStaticMarkup(
      React.createElement(RunActions, {
        run: mockWaitingRunFixture,
        labels: actionLabels,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('data-testid="action-approve-button"');
    expect(html).toContain('Approve Update');
    expect(html).toContain('data-testid="action-reject-button"');
    expect(html).toContain('Decline Update');
    expect(html).not.toContain('data-testid="action-replay-button"');
    expect(html).not.toContain('data-testid="action-undo-available"');
  });

  it('renders Replay action only when run status is FAILED', () => {
    const html = renderToStaticMarkup(
      React.createElement(RunActions, {
        run: mockFailedRunFixture,
        labels: actionLabels,
        onReplay: vi.fn(),
      }),
    );

    expect(html).toContain('data-testid="action-replay-button"');
    expect(html).toContain('Replay Run');
    expect(html).not.toContain('data-testid="action-approve-button"');
    expect(html).not.toContain('data-testid="action-reject-button"');
    expect(html).not.toContain('data-testid="action-undo-available"');
  });

  it('renders Undo action strictly when the API reports undoAvailable as true', () => {
    const htmlWithUndo = renderToStaticMarkup(
      React.createElement(RunActions, {
        run: mockCompletedRunFixture,
        labels: actionLabels,
      }),
    );
    expect(htmlWithUndo).toContain('data-testid="action-undo-available"');
    expect(htmlWithUndo).toContain('Undo Sync (15m window)');

    const htmlWithoutUndo = renderToStaticMarkup(
      React.createElement(RunActions, {
        run: { ...mockCompletedRunFixture, undoAvailable: false },
        labels: actionLabels,
      }),
    );
    expect(htmlWithoutUndo).not.toContain('data-testid="action-undo-available"');
  });

  it('renders Open in HubSpot deep link when deal ID and portal ID are provided', () => {
    const html = renderToStaticMarkup(
      React.createElement(RunActions, {
        run: mockCompletedRunFixture,
        hubspotPortalId: '998877',
        labels: actionLabels,
      }),
    );

    expect(html).toContain('data-testid="action-open-hubspot"');
    expect(html).toContain(
      'href="https://app.hubspot.com/contacts/998877/record/0-3/987654321"',
    );
    expect(html).toContain('Open in HubSpot');
  });
});
