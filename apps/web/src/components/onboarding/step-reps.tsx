'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/shared/loading-state';
import { EmptyState } from '@/components/shared/empty-state';
import { useReps, useUpdateRep, useSendRepLinkCode } from '@/hooks/use-vexel-api';
import { isValidE164, normalizePhoneInput } from '@/lib/phone';
import type { OnboardingStatus, TenantRepRecord } from '@/lib/types';

export interface StepRepsProps {
  status: OnboardingStatus;
  onNext: () => void;
  onBack: () => void;
}

export function StepReps({ status, onNext, onBack }: StepRepsProps) {
  const t = useTranslations('onboarding.reps');
  const { data: reps = [], isLoading, error, refetch } = useReps();

  const updateRepMutation = useUpdateRep();
  const sendCodeMutation = useSendRepLinkCode();

  // Local state for phone inputs per rep: repId -> phone string
  const [phoneInputs, setPhoneInputs] = React.useState<Record<string, string>>({});
  // Local state for validation errors: repId -> error message
  const [phoneErrors, setPhoneErrors] = React.useState<Record<string, string>>({});
  // Reps that have link code sent: repId -> boolean
  const [codeSentMap, setCodeSentMap] = React.useState<Record<string, boolean>>({});

  // Initialize phone inputs from reps query
  React.useEffect(() => {
    if (reps && reps.length > 0) {
      setPhoneInputs((prev) => {
        const next = { ...prev };
        for (const rep of reps) {
          if (next[rep.id] === undefined && rep.whatsappPhone) {
            next[rep.id] = rep.whatsappPhone;
          }
        }
        return next;
      });
    }
  }, [reps]);

  const handlePhoneChange = (repId: string, value: string) => {
    const normalized = normalizePhoneInput(value);
    setPhoneInputs((prev) => ({ ...prev, [repId]: normalized }));

    if (normalized && !isValidE164(normalized)) {
      setPhoneErrors((prev) => ({
        ...prev,
        [repId]: t('invalidPhone'),
      }));
    } else {
      setPhoneErrors((prev) => {
        const next = { ...prev };
        delete next[repId];
        return next;
      });
    }
  };

  const handleSavePhone = async (repId: string) => {
    const phone = phoneInputs[repId]?.trim() || '';
    if (phone && !isValidE164(phone)) {
      setPhoneErrors((prev) => ({ ...prev, [repId]: t('invalidPhone') }));
      return;
    }

    try {
      await updateRepMutation.mutateAsync({
        id: repId,
        data: {
          whatsappPhone: phone || undefined,
        },
      });
      setPhoneErrors((prev) => {
        const next = { ...prev };
        delete next[repId];
        return next;
      });
    } catch (err: any) {
      setPhoneErrors((prev) => ({
        ...prev,
        [repId]: err?.message || 'Failed to save phone number.',
      }));
    }
  };

  const handleSendLinkCode = async (repId: string) => {
    try {
      await sendCodeMutation.mutateAsync(repId);
      setCodeSentMap((prev) => ({ ...prev, [repId]: true }));
      setTimeout(() => {
        setCodeSentMap((prev) => {
          const next = { ...prev };
          delete next[repId];
          return next;
        });
      }, 4000);
    } catch (err: any) {
      setPhoneErrors((prev) => ({
        ...prev,
        [repId]: err?.message || 'Failed to send OTP code.',
      }));
    }
  };

  const linkedCount = reps.filter((r) => Boolean(r.whatsappPhone)).length;
  const canProceed = linkedCount >= 1 || status.repsLinkedCount >= 1;

  return (
    <Card className="rounded-2xl border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              {/* Users icon */}
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                {t('cardTitle')}
              </h3>
              <p className="text-sm text-muted-foreground">{t('cardDesc')}</p>
            </div>
          </div>

          <div>
            <Badge
              variant={canProceed ? 'success' : 'outline'}
              className="py-1 px-3 text-xs"
            >
              {t('linkedCount', { linked: linkedCount, total: reps.length })}
            </Badge>
          </div>
        </div>

        {/* Content Table */}
        {isLoading ? (
          <div className="py-8">
            <LoadingState message="Loading sales representatives..." rows={3} />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
            <p className="text-sm text-destructive">Failed to load sales reps.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2 text-xs">
              Retry
            </Button>
          </div>
        ) : reps.length === 0 ? (
          <EmptyState
            title={t('emptyReps')}
            description="Sync HubSpot owners to see your team members here."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-start text-sm">
              <thead className="bg-muted/40 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start">{t('table.name')}</th>
                  <th className="py-3 px-4 text-start">{t('table.email')}</th>
                  <th className="py-3 px-4 text-start">{t('table.phone')}</th>
                  <th className="py-3 px-4 text-start">{t('table.status')}</th>
                  <th className="py-3 px-4 text-end">{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reps.map((rep) => {
                  const currentPhoneValue = phoneInputs[rep.id] ?? (rep.whatsappPhone || '');
                  const isLinked = Boolean(rep.whatsappPhone);
                  const hasUnsavedChanges = currentPhoneValue !== (rep.whatsappPhone || '');
                  const repError = phoneErrors[rep.id];
                  const codeSent = codeSentMap[rep.id];
                  const isUpdating = updateRepMutation.isPending;
                  const isSendingCode = sendCodeMutation.isPending;

                  return (
                    <tr key={rep.id} className="hover:bg-muted/20 transition-colors">
                      {/* Name */}
                      <td className="py-3.5 px-4 font-medium text-foreground whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                            {rep.fullName.slice(0, 2).toUpperCase()}
                          </div>
                          <span>{rep.fullName}</span>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="py-3.5 px-4 text-muted-foreground text-xs whitespace-nowrap">
                        {rep.email}
                      </td>

                      {/* Phone Input */}
                      <td className="py-3.5 px-4 min-w-[200px]">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Input
                              type="tel"
                              value={currentPhoneValue}
                              onChange={(e) => handlePhoneChange(rep.id, e.target.value)}
                              placeholder={t('phonePlaceholder')}
                              className="h-8 text-xs font-mono"
                              dir="ltr"
                            />
                            {hasUnsavedChanges && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleSavePhone(rep.id)}
                                disabled={isUpdating || Boolean(repError)}
                                className="h-8 px-2.5 text-xs shrink-0"
                              >
                                {isUpdating ? t('saving') : t('savePhone')}
                              </Button>
                            )}
                          </div>
                          {repError && (
                            <p className="text-[11px] text-destructive leading-tight">
                              {repError}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Pairing Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {isLinked ? (
                          <Badge variant="success" className="text-xs">
                            {t('statusLinked')}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {t('statusUnlinked')}
                          </Badge>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-end whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSendLinkCode(rep.id)}
                          disabled={!isLinked || isSendingCode}
                          className="h-8 px-2 text-xs"
                        >
                          {codeSent ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                              {t('codeSent')}
                            </span>
                          ) : (
                            t('sendCode')
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Notice if no reps linked */}
        {!canProceed && reps.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('minRepsNotice')}
          </p>
        )}

        {/* Footer Navigation */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext} disabled={!canProceed} className="gap-2">
            {t('nextStep')}
            <svg
              className="h-4 w-4 rtl:rotate-180"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Button>
        </div>
      </div>
    </Card>
  );
}

