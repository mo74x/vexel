'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  Building2,
  Calendar,
  Clock,
  Phone,
  User,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  useRun,
  useApproveRun,
  useRejectRun,
  useReplayRun,
  useOnboardingStatus,
} from '@/hooks/use-vexel-api';
import { StatusChip } from '@/components/activity/status-chip';
import { ConfidenceBadge } from '@/components/activity/confidence-badge';
import { TranscriptViewer } from '@/components/activity/transcript-viewer';
import { ChangesDiff } from '@/components/activity/changes-diff';
import { StepTimeline } from '@/components/activity/step-timeline';
import { RunActions } from '@/components/activity/run-actions';
import { LoadingState } from '@/components/shared/loading-state';
import { ErrorState } from '@/components/shared/error-state';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatDateTime } from '@/lib/date-utils';

export default function RunDetailPage() {
  const t = useTranslations('runDetail');
  const tActivity = useTranslations('activity');
  const params = useParams();
  const router = useRouter();
  const locale = (params.locale as string) || 'en';
  const runId = params.id as string;

  const { data: run, isLoading, isError, refetch } = useRun(runId);
  const { data: onboarding } = useOnboardingStatus();

  const approveMutation = useApproveRun();
  const rejectMutation = useRejectRun();
  const replayMutation = useReplayRun();

  const [feedbackMessage, setFeedbackMessage] = React.useState<string | null>(null);

  const handleApprove = async () => {
    if (!run) return;
    await approveMutation.mutateAsync(run.id);
    setFeedbackMessage(t('actions.successApproved'));
    refetch();
  };

  const handleReject = async (reason?: string) => {
    if (!run) return;
    await rejectMutation.mutateAsync({ id: run.id, reason });
    setFeedbackMessage(t('actions.successRejected'));
    refetch();
  };

  const handleReplay = async () => {
    if (!run) return;
    await replayMutation.mutateAsync(run.id);
    setFeedbackMessage(t('actions.successReplayed'));
    refetch();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <LoadingState message="Loading workflow run telemetry..." rows={4} />
      </div>
    );
  }

  if (isError || !run) {
    return (
      <div className="space-y-6">
        <Link
          href={`/${locale}/activity`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
          <span>{t('back')}</span>
        </Link>
        <ErrorState
          title="Could not find workflow run"
          description="The requested run ID does not exist or you do not have permission to access it."
          retry={() => refetch()}
        />
      </div>
    );
  }

  const repName = run.decidedByRep?.fullName || run.senderPhone || t('unassigned');

  return (
    <div className="space-y-6" data-testid="run-detail-page">
      {/* Top Navigation & Feedback */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Link
          href={`/${locale}/activity`}
          className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group"
        >
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180 group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5 transition-transform" />
          <span>{t('back')}</span>
        </Link>

        {feedbackMessage && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 ps-3 pe-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{feedbackMessage}</span>
          </div>
        )}
      </div>

      {/* Run Header Overview Card */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                {run.workflowName}
              </h1>
              {run.externalDealId && (
                <span className="font-mono text-sm font-semibold text-muted-foreground">
                  #{run.externalDealId}
                </span>
              )}
              <StatusChip
                status={run.status}
                outcome={run.outcome}
                labels={{
                  status: {
                    PENDING: tActivity('statusChips.PENDING'),
                    RUNNING: tActivity('statusChips.RUNNING'),
                    WAITING_APPROVAL: tActivity('statusChips.WAITING_APPROVAL'),
                    COMPLETED: tActivity('statusChips.COMPLETED'),
                    FAILED: tActivity('statusChips.FAILED'),
                    DEAD_LETTER: tActivity('statusChips.DEAD_LETTER'),
                  },
                  outcome: {
                    AUTO_SYNCED: tActivity('outcomeChips.AUTO_SYNCED'),
                    APPROVED_AS_IS: tActivity('outcomeChips.APPROVED_AS_IS'),
                    APPROVED_WITH_OVERRIDE: tActivity('outcomeChips.APPROVED_WITH_OVERRIDE'),
                    REJECTED: tActivity('outcomeChips.REJECTED'),
                    EXPIRED: tActivity('outcomeChips.EXPIRED'),
                    UNDONE: tActivity('outcomeChips.UNDONE'),
                    FAILED: tActivity('outcomeChips.FAILED'),
                  },
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{run.oneLineSummary}</p>
          </div>

          {/* Metadata quick stats */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs text-muted-foreground border-t md:border-0 pt-3 md:pt-0">
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium text-foreground">{repName}</span>
            </div>
            {run.senderPhone && (
              <div className="flex items-center gap-1.5 font-mono">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{run.senderPhone}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{formatDateTime(run.createdAt, locale)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Actions Bar: Open in HubSpot, Approve/Reject, Replay, Undo snapshot */}
      <RunActions
        run={run}
        hubspotPortalId={onboarding?.hubspotPortalId}
        onApprove={handleApprove}
        onReject={handleReject}
        onReplay={handleReplay}
        isApproving={approveMutation.isPending}
        isRejecting={rejectMutation.isPending}
        isReplaying={replayMutation.isPending}
        labels={{
          openHubSpot: t('actions.openHubSpot'),
          approve: t('actions.approve'),
          approving: t('actions.approving'),
          reject: t('actions.reject'),
          rejecting: t('actions.rejecting'),
          replay: t('actions.replay'),
          replaying: t('actions.replaying'),
          undo: t('actions.undo'),
          undoAvailable: t('actions.undoAvailable'),
        }}
      />

      {/* Two Column Layout (Stacked on mobile, 2 columns on desktop) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Voice Note Transcript with Highlighted Phrases */}
        <div className="lg:col-span-5 space-y-6">
          <TranscriptViewer
            transcript={run.transcript}
            extractedData={run.extractedData}
            labels={{
              title: t('transcript.title'),
              subtitle: t('transcript.subtitle'),
              empty: t('transcript.empty'),
              highlightHint: t('transcript.highlightHint'),
            }}
          />
        </div>

        {/* Right Column: "What Vexel Changed", Confidence Score, and Step Timeline */}
        <div className="lg:col-span-7 space-y-6">
          {/* Confidence Score Pill / Card */}
          <Card className="p-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('confidence.title')}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {run.confidenceScore && run.confidenceScore >= 85
                  ? t('confidence.high')
                  : run.confidenceScore && run.confidenceScore >= 70
                  ? t('confidence.medium')
                  : t('confidence.low')}
              </p>
            </div>
            <ConfidenceBadge score={run.confidenceScore} showLabel />
          </Card>

          {/* What Vexel Changed (Before / After Comparison) */}
          <ChangesDiff
            extractedData={run.extractedData}
            overriddenFields={run.overriddenFields}
            labels={{
              title: t('changes.title'),
              subtitle: t('changes.subtitle'),
              empty: t('changes.empty'),
              property: t('changes.property'),
              before: t('changes.before'),
              after: t('changes.after'),
              overrideBadge: t('changes.overrideBadge'),
            }}
          />

          {/* Step Timeline */}
          <StepTimeline
            steps={run.steps}
            locale={locale}
            labels={{
              title: t('timeline.title'),
              subtitle: t('timeline.subtitle'),
              step: t('timeline.step'),
              duration: t('timeline.duration'),
              status: t('timeline.status'),
              empty: t('timeline.empty'),
            }}
          />
        </div>
      </div>
    </div>
  );
}

