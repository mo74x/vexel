import * as React from 'react';
import Link from 'next/link';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';
import { ThemeToggle } from '@/components/shared/theme-toggle';

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-4 bg-muted/20">
      {/* Top Controls */}
      <div className="absolute top-4 end-4 flex items-center gap-2">
        <LocaleSwitcher currentLocale={locale} />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link
            href={`/${locale}/auth/login`}
            className="inline-flex items-center gap-2.5 font-bold text-2xl tracking-tight text-foreground focus:outline-none"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white shadow dark:bg-brand-500 dark:text-zinc-950">
              V
            </div>
            <span>Vexel</span>
          </Link>
          <p className="mt-1.5 text-xs text-muted-foreground uppercase tracking-wider font-medium">
            Multi-Tenant RevOps Engine
          </p>
        </div>

        {children}
      </div>
    </div>
  );
}

