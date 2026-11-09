'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/components/providers/auth-provider';
import { LoadingState } from '@/components/shared/loading-state';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations('navigation');
  const params = useParams();
  const router = useRouter();
  const locale = (params.locale as string) || 'en';
  const { user, isLoading, isAuthenticated } = useAuth();

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push(`/${locale}/auth/login`);
    }
  }, [isLoading, isAuthenticated, router, locale]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <LoadingState message="Authenticating session..." rows={2} />
      </div>
    );
  }

  // If unauthenticated, redirecting
  if (!user) {
    return null;
  }

  const translations = {
    activity: t('activity'),
    reps: t('reps'),
    impact: t('impact'),
    settings: t('settings'),
    logout: t('logout'),
    brandTitle: t('brandTitle'),
    brandTagline: t('brandTagline'),
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop Sidebar */}
      <Sidebar locale={locale} translations={translations} />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header locale={locale} brandTitle={translations.brandTitle} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 pb-20 md:pb-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav
        locale={locale}
        translations={{
          activity: translations.activity,
          reps: translations.reps,
          impact: translations.impact,
          settings: translations.settings,
        }}
      />
    </div>
  );
}

