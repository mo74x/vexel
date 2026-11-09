'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  CheckCircle2,
  XCircle,
  Sliders,
  Shield,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useSettings, useUpdateSettings, useOnboardingStatus } from '@/hooks/use-vexel-api';
import { useAuth } from '@/components/providers/auth-provider';
import { LoadingState } from '@/components/shared/loading-state';
import { ErrorState } from '@/components/shared/error-state';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function SettingsPage() {
  const t = useTranslations('settings');
  const common = useTranslations('common');
  const { activeTenant, currentRole } = useAuth();

  const { data: settings, isLoading, isError, refetch } = useSettings();
  const { data: onboarding } = useOnboardingStatus();
  const updateSettingsMutation = useUpdateSettings();

  const [manualMinutes, setManualMinutes] = React.useState<number>(5);
  const [threshold, setThreshold] = React.useState<number>(85);
  const [minutesError, setMinutesError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState(false);

  // Sync state once settings load
  React.useEffect(() => {
    if (settings) {
      setManualMinutes(settings.manualMinutesPerUpdate ?? 5);
      setThreshold(settings.autoSyncThreshold ?? 85);
    }
  }, [settings]);

  const handleMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val)) {
      setManualMinutes(0);
      setMinutesError(t('invalidMinutes'));
      return;
    }
    setManualMinutes(val);
    if (val < 1 || val > 120) {
      setMinutesError(t('invalidMinutes'));
    } else {
      setMinutesError(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (manualMinutes < 1 || manualMinutes > 120) {
      setMinutesError(t('invalidMinutes'));
      return;
    }

    try {
      await updateSettingsMutation.mutateAsync({
        manualMinutesPerUpdate: manualMinutes,
        autoSyncThreshold: threshold,
      });
      setSuccessMessage(true);
      setTimeout(() => setSuccessMessage(false), 4000);
    } catch (err: any) {
      setMinutesError(err?.message || 'Failed to save settings.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {isLoading && <LoadingState message="Loading workspace configuration..." rows={3} />}

      {isError && (
        <ErrorState
          title="Could not load settings"
          description="Failed to load workspace integrations and parameters."
          retry={() => refetch()}
        />
      )}

      {!isLoading && !isError && settings && (
        <div className="space-y-6">
          {/* Success Banner */}
          {successMessage && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3 text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span className="text-sm font-medium">{t('saved')}</span>
            </div>
          )}

          {/* Form: RevOps Impact Parameters */}
          <form onSubmit={handleSave}>
            <Card className="rounded-2xl border-border bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span>RevOps Telemetry &amp; Impact Settings</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Configure calculation baselines for time saved and automated HubSpot deal updates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Manual Minutes per Update */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="manualMinutesInput"
                      className="text-xs font-semibold text-foreground"
                    >
                      {t('manualMinutesLabel')}
                    </label>
                    <span className="font-mono text-xs text-muted-foreground">
                      {manualMinutes} min
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Input
                      id="manualMinutesInput"
                      type="number"
                      min={1}
                      max={120}
                      value={manualMinutes || ''}
                      onChange={handleMinutesChange}
                      placeholder={t('manualMinutesPlaceholder')}
                      className="w-32 font-mono text-sm"
                      required
                    />
                    <span className="text-xs text-muted-foreground">minutes / deal</span>
                  </div>
                  {minutesError ? (
                    <p className="text-xs text-destructive">{minutesError}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {t('manualMinutesHelp')}
                    </p>
                  )}
                </div>

                {/* Auto-Sync Confidence Threshold */}
                <div className="space-y-2 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="settingsThreshold"
                      className="text-xs font-semibold text-foreground"
                    >
                      {t('thresholdLabel')}
                    </label>
                    <Badge variant="outline" className="font-mono text-xs">
                      {threshold}%
                    </Badge>
                  </div>
                  <input
                    id="settingsThreshold"
                    type="range"
                    min={70}
                    max={95}
                    step={1}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full accent-primary h-2 bg-muted rounded-lg cursor-pointer"
                  />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {t('thresholdHelp')}
                  </p>
                </div>

                {/* Action button */}
                <div className="pt-2">
                  <Button
                    type="submit"
                    disabled={updateSettingsMutation.isPending || Boolean(minutesError)}
                    className="gap-2"
                  >
                    {updateSettingsMutation.isPending ? t('saving') : t('saveSettings')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>

          {/* Workspace Details */}
          <Card className="rounded-2xl border-border bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sliders className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                <span>{settings.name || activeTenant?.name || 'Workspace Configuration'}</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Tenant parameters configured in PostgreSQL.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-border/60">
                <span className="text-muted-foreground">Tenant Slug</span>
                <span className="font-mono font-medium">{settings.slug || activeTenant?.slug || '—'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border/60">
                <span className="text-muted-foreground">Your Role</span>
                <Badge variant="default" className="text-[10px]">
                  {currentRole || 'ADMIN'}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border/60">
                <span className="text-muted-foreground">Workspace Timezone</span>
                <span className="font-mono font-medium">{settings.timezone || 'Africa/Cairo'}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Workspace Locale</span>
                <span className="font-mono font-medium">{settings.locale || 'en'}</span>
              </div>
            </CardContent>
          </Card>

          {/* Integrations Health */}
          <Card className="rounded-2xl border-border bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-500" />
                <span>External Integrations</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Status of connected CRM and WhatsApp providers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border">
                <div className="flex items-center gap-2.5">
                  {settings.hubspotConnected ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <span className="font-medium block">{t('hubspotStatus')}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {settings.hubspotPortalId
                        ? `Portal ID: ${settings.hubspotPortalId}`
                        : 'No HubSpot portal linked'}
                    </span>
                  </div>
                </div>
                <Badge
                  variant={settings.hubspotConnected ? 'success' : 'outline'}
                  className="text-[10px]"
                >
                  {settings.hubspotConnected ? t('connected') : t('disconnected')}
                </Badge>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border">
                <div className="flex items-center gap-2.5">
                  {settings.whatsappConnected ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <span className="font-medium block">{t('whatsappStatus')}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {settings.whatsappPhoneId
                        ? `Phone ID: ${settings.whatsappPhoneId}`
                        : 'No WhatsApp Cloud webhook linked'}
                    </span>
                  </div>
                </div>
                <Badge
                  variant={settings.whatsappConnected ? 'success' : 'outline'}
                  className="text-[10px]"
                >
                  {settings.whatsappConnected ? t('connected') : t('disconnected')}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
