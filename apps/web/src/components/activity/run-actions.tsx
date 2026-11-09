import * as React from 'react';
import {
  ExternalLink,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Undo2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { RunDetail, RunStatus } from '@/lib/types';

export interface RunActionsProps {
  run: RunDetail;
  hubspotPortalId?: string | null;
  onApprove?: () => Promise<void>;
  onReject?: (reason?: string) => Promise<void>;
  onReplay?: () => Promise<void>;
  isApproving?: boolean;
  isRejecting?: boolean;
  isReplaying?: boolean;
  labels: {
    openHubSpot: string;
    approve: string;
    approving: string;
    reject: string;
    rejecting: string;
    replay: string;
    replaying: string;
    undo: string;
    undoAvailable: string;
  };
}

export function RunActions({
  run,
  hubspotPortalId,
  onApprove,
  onReject,
  onReplay,
  isApproving = false,
  isRejecting = false,
  isReplaying = false,
  labels,
}: RunActionsProps) {
  const isWaitingApproval = run.status === 'WAITING_APPROVAL';
  const isFailed = run.status === 'FAILED' || run.status === 'DEAD_LETTER';
  const hasUndo = Boolean(run.undoAvailable);

  // Construct HubSpot deal deep link if portal and deal ID are available
  const hubspotUrl = React.useMemo(() => {
    if (!run.externalDealId) return null;
    if (hubspotPortalId) {
      return `https://app.hubspot.com/contacts/${hubspotPortalId}/record/0-3/${run.externalDealId}`;
    }
    return `https://app.hubspot.com/contacts/record/0-3/${run.externalDealId}`;
  }, [run.externalDealId, hubspotPortalId]);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-sm"
      data-testid="run-actions-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Open in HubSpot */}
        {hubspotUrl && (
          <a
            href={hubspotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background ps-3 pe-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            data-testid="action-open-hubspot"
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{labels.openHubSpot}</span>
          </a>
        )}

        {/* Undo Availability Indicator / Action */}
        {hasUndo && (
          <div
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 ps-3 pe-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
            data-testid="action-undo-available"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span>{labels.undo}</span>
          </div>
        )}
      </div>

      {/* State-dependent Mutating Actions */}
      <div className="flex items-center gap-2 ms-auto">
        {/* Approve / Reject when Waiting Approval */}
        {isWaitingApproval && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReject && onReject()}
              disabled={isRejecting || isApproving}
              className="gap-1.5 text-xs text-destructive hover:bg-destructive/10 border-destructive/30"
              data-testid="action-reject-button"
            >
              {isRejecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              <span>{isRejecting ? labels.rejecting : labels.reject}</span>
            </Button>

            <Button
              size="sm"
              onClick={() => onApprove && onApprove()}
              disabled={isApproving || isRejecting}
              className="gap-1.5 text-xs"
              data-testid="action-approve-button"
            >
              {isApproving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              <span>{isApproving ? labels.approving : labels.approve}</span>
            </Button>
          </>
        )}

        {/* Replay when Failed */}
        {isFailed && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReplay && onReplay()}
            disabled={isReplaying}
            className="gap-1.5 text-xs"
            data-testid="action-replay-button"
          >
            {isReplaying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            <span>{isReplaying ? labels.replaying : labels.replay}</span>
          </Button>
        )}
      </div>
    </div>
  );
}

