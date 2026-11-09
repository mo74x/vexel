import * as React from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  XCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { RunOutcome, RunStatus } from '@/lib/types';

export interface StatusChipProps {
  status: RunStatus;
  outcome?: RunOutcome | null;
  labels: {
    status: Record<string, string>;
    outcome: Record<string, string>;
  };
  className?: string;
}

export function StatusChip({
  status,
  outcome,
  labels,
  className,
}: StatusChipProps) {
  // If an outcome exists, it provides the most precise state
  if (outcome) {
    switch (outcome) {
      case 'AUTO_SYNCED':
        return (
          <Badge
            variant="success"
            className={`gap-1.5 font-medium text-xs ${className || ''}`}
            data-testid="status-chip-auto-synced"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{labels.outcome.AUTO_SYNCED || 'Auto-Synced'}</span>
          </Badge>
        );

      case 'APPROVED_AS_IS':
        return (
          <Badge
            variant="success"
            className={`gap-1.5 font-medium text-xs ${className || ''}`}
            data-testid="status-chip-approved-as-is"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{labels.outcome.APPROVED_AS_IS || 'Approved as Transcribed'}</span>
          </Badge>
        );

      case 'APPROVED_WITH_OVERRIDE':
        return (
          <Badge
            variant="default"
            className={`gap-1.5 font-medium text-xs ${className || ''}`}
            data-testid="status-chip-approved-override"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{labels.outcome.APPROVED_WITH_OVERRIDE || 'Approved with Edits'}</span>
          </Badge>
        );

      case 'UNDONE':
        return (
          <Badge
            variant="outline"
            className={`gap-1.5 font-medium text-xs border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10 ${className || ''}`}
            data-testid="status-chip-undone"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{labels.outcome.UNDONE || 'Reverted'}</span>
          </Badge>
        );

      case 'REJECTED':
      case 'EXPIRED':
        return (
          <Badge
            variant="secondary"
            className={`gap-1.5 font-medium text-xs text-muted-foreground ${className || ''}`}
            data-testid="status-chip-rejected"
          >
            <XCircle className="h-3.5 w-3.5" />
            <span>
              {outcome === 'EXPIRED'
                ? labels.outcome.EXPIRED || 'Expired'
                : labels.outcome.REJECTED || 'Declined'}
            </span>
          </Badge>
        );

      case 'FAILED':
        return (
          <Badge
            variant="destructive"
            className={`gap-1.5 font-medium text-xs ${className || ''}`}
            data-testid="status-chip-failed"
          >
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{labels.outcome.FAILED || 'Failed'}</span>
          </Badge>
        );
    }
  }

  // Fallback to RunStatus
  switch (status) {
    case 'WAITING_APPROVAL':
      return (
        <Badge
          variant="warning"
          className={`gap-1.5 font-medium text-xs ${className || ''}`}
          data-testid="status-chip-waiting"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <span>{labels.status.WAITING_APPROVAL || 'Waiting for Rep'}</span>
        </Badge>
      );

    case 'RUNNING':
      return (
        <Badge
          variant="secondary"
          className={`gap-1.5 font-medium text-xs ${className || ''}`}
          data-testid="status-chip-running"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />
          <span>{labels.status.RUNNING || 'Processing'}</span>
        </Badge>
      );

    case 'COMPLETED':
      return (
        <Badge
          variant="success"
          className={`gap-1.5 font-medium text-xs ${className || ''}`}
          data-testid="status-chip-completed"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>{labels.status.COMPLETED || 'Synced'}</span>
        </Badge>
      );

    case 'FAILED':
    case 'DEAD_LETTER':
      return (
        <Badge
          variant="destructive"
          className={`gap-1.5 font-medium text-xs ${className || ''}`}
          data-testid="status-chip-failed-status"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          <span>{labels.status.FAILED || 'Action Required'}</span>
        </Badge>
      );

    case 'PENDING':
    default:
      return (
        <Badge
          variant="outline"
          className={`gap-1.5 font-medium text-xs text-muted-foreground ${className || ''}`}
          data-testid="status-chip-pending"
        >
          <Clock className="h-3.5 w-3.5" />
          <span>{labels.status.PENDING || 'Queued'}</span>
        </Badge>
      );
  }
}

