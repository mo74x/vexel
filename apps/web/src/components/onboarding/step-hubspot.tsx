'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { OnboardingStatus } from '@/lib/types';

export interface StepHubSpotProps {
  status: OnboardingStatus;
  tenantId: string;
  onNext: () => void;
}

export function StepHubSpot({ status, tenantId, onNext }: StepHubSpotProps) {
  const t = useTranslations('onboarding.hubspot');
  const [isRedirecting, setIsRedirecting] = React.useState(false);

  const handleConnectHubSpot = () => {
    setIsRedirecting(true);
    const apiBase =
      process.env.NEXT_PUBLIC_API_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    const callbackRedirect =
      typeof window !== 'undefined'
        ? `${window.location.origin}/onboarding?callback=hubspot`
        : '';

    const installUrl = `${apiBase}/v1/hubspot/install?tenantId=${encodeURIComponent(
      tenantId,
    )}${callbackRedirect ? `&redirectUri=${encodeURIComponent(callbackRedirect)}` : ''}`;

    window.location.href = installUrl;
  };

  const isConnected = Boolean(status.hubspotConnected);

  return (
    <Card className="rounded-2xl border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
              {/* HubSpot stylized sprocket icon */}
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.8 8.6a3 3 0 0 0-2.3-2.9V4.2a2 2 0 1 0-1.8 0v1.5a3 3 0 0 0-2.3 2.9c0 .4.1.8.2 1.1L8.8 12.1a3 3 0 0 0-1.2-.2 3 3 0 1 0 3 3c0-.4-.1-.8-.2-1.1l3.8-2.4a3 3 0 0 0 1.2.2 3 3 0 0 0 3.4-3zm-9.2 8.4a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8zm6.2-7a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8z" />
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

        {/* Content Box */}
        {isConnected ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-emerald-800 dark:text-emerald-300">
                    {t('ownersSynced')}
                  </span>
                </div>
                {status.hubspotPortalId && (
                  <p className="text-xs text-muted-foreground font-mono">
                    {t('portalId', { portalId: status.hubspotPortalId })}
                  </p>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleConnectHubSpot}
                disabled={isRedirecting}
                className="text-xs shrink-0"
              >
                {t('reconnectButton')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-muted/20 p-5 space-y-3">
            <p className="text-sm text-muted-foreground">
              Vexel will request read and write access to deal properties, contact associations,
              sales owner directories, and engagement timelines.
            </p>
            <div className="pt-2">
              <Button
                onClick={handleConnectHubSpot}
                disabled={isRedirecting}
                className="gap-2"
              >
                {isRedirecting ? (
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
                    {t('connecting')}
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                      />
                    </svg>
                    {t('connectButton')}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Action Footer */}
        <div className="flex justify-end pt-2 border-t border-border">
          <Button
            onClick={onNext}
            disabled={!isConnected}
            className="gap-2"
          >
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

