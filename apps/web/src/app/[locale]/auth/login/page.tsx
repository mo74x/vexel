'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Mail, CheckCircle2, ArrowRight } from 'lucide-react';
import { useRequestMagicLink } from '@/hooks/use-vexel-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';

export default function LoginPage() {
  const t = useTranslations('auth');
  const [email, setEmail] = React.useState('');
  const [submittedEmail, setSubmittedEmail] = React.useState<string | null>(null);
  const requestMutation = useRequestMagicLink();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) return;

    try {
      await requestMutation.mutateAsync({ email: email.trim().toLowerCase() });
      setSubmittedEmail(email.trim().toLowerCase());
    } catch {
      // Error is captured in mutation.error
    }
  };

  if (submittedEmail) {
    return (
      <Card className="border-border shadow-lg animate-in fade-in-50">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">{t('linkSentTitle')}</CardTitle>
          <CardDescription className="pt-2 text-sm">
            {t('linkSentDesc', { email: submittedEmail })}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-center pb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSubmittedEmail(null);
              requestMutation.reset();
            }}
          >
            {t('requestNewLink')}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border-border shadow-lg">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-xl font-bold tracking-tight">
          {t('loginTitle')}
        </CardTitle>
        <CardDescription className="text-sm">
          {t('loginSubtitle')}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4 pt-2">
          {requestMutation.isError && (
            <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
              {requestMutation.error?.message || 'Failed to send magic link'}
            </div>
          )}

          <div className="space-y-2 text-start">
            <label
              htmlFor="email"
              className="text-xs font-medium text-foreground"
            >
              {t('emailLabel')}
            </label>
            <div className="relative">
              <Input
                id="email"
                type="email"
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                disabled={requestMutation.isPending}
                className="ps-3 pe-3"
              />
            </div>
          </div>
        </CardContent>

        <CardFooter className="pt-2">
          <Button
            type="submit"
            className="w-full gap-2"
            disabled={requestMutation.isPending || !email}
          >
            {requestMutation.isPending ? (
              <span>{t('sending')}</span>
            ) : (
              <>
                <Mail className="h-4 w-4" />
                <span>{t('sendMagicLink')}</span>
              </>
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

