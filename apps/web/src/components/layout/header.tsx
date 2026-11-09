'use client';

import * as React from 'react';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';
import { Badge } from '@/components/ui/badge';

export function Header({
  locale,
  brandTitle,
}: {
  locale: string;
  brandTitle: string;
}) {
  const { activeTenant, currentRole } = useAuth();

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card/60 backdrop-blur-md px-4 md:hidden">
      <Link
        href={`/${locale}/activity`}
        className="flex items-center gap-2 font-semibold text-sm text-foreground"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white font-bold text-xs">
          V
        </div>
        <span>{brandTitle}</span>
      </Link>

      <div className="flex items-center gap-2">
        {activeTenant && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3" />
            <span className="max-w-[100px] truncate">{activeTenant.name}</span>
          </div>
        )}
        <LocaleSwitcher currentLocale={locale} />
        <ThemeToggle />
      </div>
    </header>
  );
}

