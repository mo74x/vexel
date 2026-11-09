'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Users, UserPlus, Phone, Send, CheckCircle2 } from 'lucide-react';
import { useReps, useSendRepLinkCode } from '@/hooks/use-vexel-api';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadingState } from '@/components/shared/loading-state';
import { ErrorState } from '@/components/shared/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function RepsPage() {
  const t = useTranslations('reps');
  const { data: reps, isLoading, isError, refetch } = useReps();
  const sendCodeMutation = useSendRepLinkCode();
  const [sentCodeRepId, setSentCodeRepId] = React.useState<string | null>(null);

  const handleSendCode = async (repId: string) => {
    try {
      await sendCodeMutation.mutateAsync(repId);
      setSentCodeRepId(repId);
      setTimeout(() => setSentCodeRepId(null), 4000);
    } catch {
      // Handled in mutation state
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button size="sm" className="gap-2 shrink-0">
          <UserPlus className="h-4 w-4" />
          <span>{t('addRep')}</span>
        </Button>
      </div>

      {/* Query Content */}
      {isLoading && <LoadingState message="Loading sales representatives..." rows={3} />}

      {isError && (
        <ErrorState
          title="Could not load representatives"
          description="Failed to retrieve sales rep accounts for this tenant."
          retry={() => refetch()}
        />
      )}

      {!isLoading && !isError && (!reps || reps.length === 0) && (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={t('emptyTitle')}
          description={t('emptyDesc')}
          actionLabel={t('addRep')}
          onAction={() => {}}
        />
      )}

      {!isLoading && !isError && reps && reps.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reps.map((rep) => (
            <Card key={rep.id} className="p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/15 text-brand-700 dark:text-brand-300 font-semibold text-sm">
                    {rep.fullName.charAt(0).toUpperCase()}
                  </div>
                  <Badge
                    variant={rep.isActive ? 'success' : 'outline'}
                    className="text-[10px]"
                  >
                    {rep.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-foreground">
                    {rep.fullName}
                  </h3>
                  <p className="text-xs text-muted-foreground">{rep.email}</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{rep.whatsappPhone || 'No phone linked'}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-border/60">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 text-xs"
                  onClick={() => handleSendCode(rep.id)}
                  disabled={sendCodeMutation.isPending && sendCodeMutation.variables === rep.id}
                >
                  {sentCodeRepId === rep.id ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Code Sent</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      <span>{t('sendCode')}</span>
                    </>
                  )}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

