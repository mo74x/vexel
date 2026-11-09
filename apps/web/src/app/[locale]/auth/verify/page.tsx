'use client';

import * as React from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { useVerifyMagicLink } from '@/hooks/use-vexel-api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';

function VerifyContent() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const locale = (params.locale as string) || 'en';

  const token = searchParams.get('token');
  const verifyMutation = useVerifyMagicLink();
  const hasTriggered = React.useRef(false);

  React.useEffect(() => {
    if (token && !hasTriggered.current) {
      hasTriggered.current = true;
      verifyMutation
        .mutateAsync({ token })
        .then(() => {
          setTimeout(() => {
            router.push(`/${locale}/activity`);
          }, 1000);
        })
        .catch(() => {
          // Handled in mutation state
        });
    }
  }, [token, verifyMutation, router, locale]);

  if (!token) {
    return (
      <Card className="border-border text-center shadow-lg">
        <CardHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>
          <CardTitle>{t('verifyErrorTitle')}</CardTitle>
          <CardDescription className="pt-2 text-sm">
            {t('verifyErrorDesc')}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-center pb-6">
          <Button
            onClick={() => router.push(`/${locale}/auth/login`)}
            size="sm"
          >
            {t('requestNewLink')}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (verifyMutation.isSuccess) {
    return (
      <Card className="border-border text-center shadow-lg animate-in fade-in-50">
        <CardHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">{t('verifySuccessTitle')}</CardTitle>
          <CardDescription className="pt-2 text-sm">
            {t('verifySuccessDesc')}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (verifyMutation.isError) {
    return (
      <Card className="border-border text-center shadow-lg">
        <CardHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">{t('verifyErrorTitle')}</CardTitle>
          <CardDescription className="pt-2 text-sm">
            {verifyMutation.error?.message || t('verifyErrorDesc')}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-center pb-6">
          <Button
            onClick={() => router.push(`/${locale}/auth/login`)}
            size="sm"
          >
            {t('requestNewLink')}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border-border text-center shadow-lg">
      <CardHeader>
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <RefreshCw className="h-6 w-6 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
        <CardTitle className="text-xl">{t('verifyingTitle')}</CardTitle>
        <CardDescription className="pt-2 text-sm">
          {t('verifyingDesc')}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

export default function VerifyPage() {
  return (
    <React.Suspense
      fallback={
        <Card className="border-border text-center shadow-lg">
          <CardHeader>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <RefreshCw className="h-6 w-6 animate-spin text-brand-600 dark:text-brand-400" />
            </div>
            <CardTitle className="text-xl">Verifying session...</CardTitle>
          </CardHeader>
        </Card>
      }
    >
      <VerifyContent />
    </React.Suspense>
  );
}
