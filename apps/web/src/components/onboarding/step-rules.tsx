'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useUpdateSettings, useOnboardingStatus } from '@/hooks/use-vexel-api';
import { isValidE164, normalizePhoneInput } from '@/lib/phone';
import { formatRelativeTime } from '@/lib/date-utils';
import type { OnboardingStatus } from '@/lib/types';

export interface StepRulesProps {
  status: OnboardingStatus;
  onBack: () => void;
}

export function StepRules({ status, onBack }: StepRulesProps) {
  const t = useTranslations('onboarding.rules');
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  const updateSettingsMutation = useUpdateSettings();
  const { refetch: refetchStatus } = useOnboardingStatus();

  const [threshold, setThreshold] = React.useState<number>(
    status.autoSyncThreshold || 85,
  );
  const [fallbackPhone, setFallbackPhone] = React.useState<string>('');
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [isSaved, setIsSaved] = React.useState(false);
  const [hasFirstRun, setHasFirstRun] = React.useState(Boolean(status.firstRunReceived));

  // Live polling for first voice note
  React.useEffect(() => {
    if (hasFirstRun) return;

    const interval = setInterval(async () => {
      try {
        const res = await refetchStatus();
        if (res.data?.firstRunReceived) {
          setHasFirstRun(true);
          clearInterval(interval);
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [hasFirstRun, refetchStatus]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizePhoneInput(e.target.value);
    setFallbackPhone(normalized);

    if (normalized && !isValidE164(normalized)) {
      setPhoneError(t('invalidFallbackPhone'));
    } else {
      setPhoneError(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fallbackPhone && !isValidE164(fallbackPhone)) {
      setPhoneError(t('invalidFallbackPhone'));
      return;
    }

    try {
      await updateSettingsMutation.mutateAsync({
        autoSyncThreshold: threshold,
        fallbackApprovalPhone: fallbackPhone || undefined,
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err: any) {
      setPhoneError(err?.message || 'Failed to save rules');
    }
  };

  // Plain-language dynamic explanation
  const getExplanation = () => {
    if (threshold >= 90) return t('conservativeExplanation');
    if (threshold >= 80) return t('balancedExplanation');
    return t('autonomousExplanation');
  };

  return (
    <Card className="rounded-2xl border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
            {/* Sliders / adjustment icon */}
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
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

        {/* Celebration State if first run received */}
        {hasFirstRun ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 sm:p-8 text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="space-y-1">
              <h4 className="text-xl font-bold tracking-tight text-emerald-950 dark:text-emerald-100">
                {t('celebrationTitle')}
              </h4>
              <p className="text-sm text-emerald-800 dark:text-emerald-300 max-w-lg mx-auto">
                {t('celebrationDesc')}
              </p>
            </div>
            {status.firstRunAt && (
              <p className="text-xs text-muted-foreground">
                {t('firstRunAt', { time: formatRelativeTime(status.firstRunAt, locale) })}
              </p>
            )}
            <div className="pt-2">
              <Button
                size="lg"
                onClick={() => router.push(`/${locale}/activity`)}
                className="gap-2 px-6"
              >
                {t('goToActivity')}
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
        ) : null}

        {/* Rules Form */}
        <form onSubmit={handleSaveSettings} className="space-y-6">
          {/* Threshold Slider */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-5">
            <div className="flex items-center justify-between">
              <label htmlFor="thresholdSlider" className="text-sm font-semibold text-foreground">
                {t('sliderLabel', { value: threshold })}
              </label>
              <Badge variant="outline" className="font-mono text-xs">
                {threshold}%
              </Badge>
            </div>

            <input
              id="thresholdSlider"
              type="range"
              min={70}
              max={95}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full accent-primary h-2 bg-muted rounded-lg cursor-pointer"
            />

            <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
              <span>70% (Autonomous)</span>
              <span>85% (Balanced)</span>
              <span>95% (Conservative)</span>
            </div>

            {/* Dynamic plain language explanation */}
            <div className="rounded-lg bg-card p-3 border border-border/60">
              <p className="text-xs text-foreground/90 leading-relaxed font-sans">
                {getExplanation()}
              </p>
            </div>
          </div>

          {/* Fallback Approval Phone */}
          <div className="space-y-1.5 text-start">
            <label htmlFor="fallbackPhone" className="text-xs font-medium text-foreground">
              {t('fallbackPhoneLabel')}
            </label>
            <Input
              id="fallbackPhone"
              type="tel"
              value={fallbackPhone}
              onChange={handlePhoneChange}
              placeholder={t('fallbackPhonePlaceholder')}
              className="font-mono text-sm max-w-md"
              dir="ltr"
            />
            {phoneError ? (
              <p className="text-xs text-destructive">{phoneError}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">{t('fallbackPhoneHelp')}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={updateSettingsMutation.isPending || Boolean(phoneError)}
            >
              {updateSettingsMutation.isPending ? t('savingSettings') : t('saveSettings')}
            </Button>
            {isSaved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                {t('settingsSaved')}
              </span>
            )}
          </div>
        </form>

        {/* Live Test Prompt (if first run not yet received) */}
        {!hasFirstRun && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4">
            <div className="space-y-1 text-start">
              <h4 className="text-sm font-semibold text-primary">{t('testPromptTitle')}</h4>
              <p className="text-xs text-muted-foreground">{t('testPromptDesc')}</p>
            </div>

            <blockquote className="rounded-lg border-s-4 border-primary bg-background/80 p-3 text-xs italic text-foreground">
              {t('sampleQuote')}
            </blockquote>

            <div className="flex items-center gap-3 pt-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
              </span>
              <p className="text-xs font-medium text-primary">{t('listeningBadge')}</p>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('listeningHelp')}</p>
          </div>
        )}

        {/* Footer Navigation */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          {hasFirstRun && (
            <Button onClick={() => router.push(`/${locale}/activity`)} className="gap-2">
              {t('goToActivity')}
              <svg
                className="h-4 w-4 rtl:rotate-180"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

