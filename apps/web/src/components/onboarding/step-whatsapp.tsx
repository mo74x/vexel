'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useUpdateSettings, useOnboardingStatus } from '@/hooks/use-vexel-api';
import type { OnboardingStatus } from '@/lib/types';

export interface StepWhatsAppProps {
  status: OnboardingStatus;
  onNext: () => void;
  onBack: () => void;
}

export function StepWhatsApp({ status, onNext, onBack }: StepWhatsAppProps) {
  const t = useTranslations('onboarding.whatsapp');
  const updateSettingsMutation = useUpdateSettings();
  const { refetch: refetchStatus } = useOnboardingStatus();

  const [phoneId, setPhoneId] = React.useState(status.whatsappPhoneId || '');
  const [token, setToken] = React.useState('');
  const [isVerifying, setIsVerifying] = React.useState(false);
  const [verificationError, setVerificationError] = React.useState<string | null>(null);

  // Polling ref for live check
  const pollingRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const startLiveCheck = React.useCallback(() => {
    setIsVerifying(true);
    setVerificationError(null);

    let attempts = 0;
    const maxAttempts = 15; // 30 seconds

    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      attempts++;
      try {
        const result = await refetchStatus();
        if (result.data?.whatsappConnected) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setIsVerifying(false);
          setToken(''); // Reset input immediately
          return;
        }
      } catch (err) {
        // Polling error
      }

      if (attempts >= maxAttempts) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        setIsVerifying(false);
        setVerificationError(t('errorDesc'));
      }
    }, 2000);
  }, [refetchStatus, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneId.trim()) return;

    setVerificationError(null);

    try {
      await updateSettingsMutation.mutateAsync({
        whatsappPhoneId: phoneId.trim(),
        ...(token.trim() ? { rawWhatsAppToken: token.trim() } : {}),
      });

      // Start live polling check
      startLiveCheck();
    } catch (err: any) {
      setVerificationError(
        err?.message || t('errorDesc') || 'Failed to update WhatsApp settings. Please try again.',
      );
    }
  };

  const isConnected = Boolean(status.whatsappConnected);

  return (
    <Card className="rounded-2xl border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              {/* WhatsApp chat bubble icon */}
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm5.79 14c-.24.67-1.4 1.24-1.92 1.32-.49.07-1.12.1-3.26-.79-2.73-1.13-4.49-3.9-4.63-4.08-.13-.18-1.11-1.48-1.11-2.82 0-1.34.7-2 1-2.28.24-.24.53-.3.71-.3.18 0 .35.01.5.02.16.01.38-.06.59.45.22.53.76 1.85.83 1.99.07.14.12.3.02.48-.09.18-.14.3-.28.45-.14.16-.3.35-.42.47-.14.14-.29.29-.12.58.16.29.73 1.21 1.57 1.96 1.08.96 1.99 1.26 2.27 1.4.29.14.45.12.62-.07.17-.19.73-.85.92-1.14.19-.29.38-.24.64-.15.26.09 1.65.78 1.93.92.29.14.47.22.54.34.07.12.07.72-.17 1.39z" />
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
            {isConnected ? (
              <Badge variant="success" className="gap-1.5 py-1 px-3 text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {t('connectedStatus')}
              </Badge>
            ) : (
              <Badge variant="outline" className="py-1 px-3 text-xs text-muted-foreground">
                Not Connected
              </Badge>
            )}
          </div>
        </div>

        {/* Connected state notification */}
        {isConnected && !isVerifying && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{t('connectedStatus')}</span>
              {status.whatsappPhoneId && (
                <span className="font-mono text-xs opacity-80">
                  ({t('phoneIdBadge', { phoneId: status.whatsappPhoneId })})
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              You can update your credentials below at any time.
            </p>
          </div>
        )}

        {/* Verification Error Alert */}
        {verificationError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-start">
            <div className="flex items-start gap-3">
              <svg
                className="h-5 w-5 text-destructive shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-destructive">{t('errorTitle')}</p>
                <p className="text-xs text-muted-foreground">{verificationError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startLiveCheck}
                  className="mt-2 text-xs"
                >
                  {t('retry')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5 text-start">
            <label htmlFor="whatsappPhoneId" className="text-xs font-medium text-foreground">
              {t('phoneIdLabel')}
            </label>
            <Input
              id="whatsappPhoneId"
              type="text"
              required
              value={phoneId}
              onChange={(e) => setPhoneId(e.target.value)}
              placeholder={t('phoneIdPlaceholder')}
              className="font-mono text-sm"
              disabled={isVerifying || updateSettingsMutation.isPending}
            />
            <p className="text-[11px] text-muted-foreground">{t('phoneIdHelp')}</p>
          </div>

          <div className="space-y-1.5 text-start">
            <label htmlFor="rawWhatsAppToken" className="text-xs font-medium text-foreground">
              {t('tokenLabel')}
            </label>
            <Input
              id="rawWhatsAppToken"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('tokenPlaceholder')}
              className="font-mono text-sm"
              disabled={isVerifying || updateSettingsMutation.isPending}
            />
            <p className="text-[11px] text-muted-foreground">{t('tokenHelp')}</p>
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              disabled={
                !phoneId.trim() ||
                isVerifying ||
                updateSettingsMutation.isPending
              }
              className="gap-2"
            >
              {isVerifying ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  {t('verifying')}
                </>
              ) : (
                t('saveAndVerify')
              )}
            </Button>
          </div>
        </form>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext} disabled={!isConnected || isVerifying} className="gap-2">
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

