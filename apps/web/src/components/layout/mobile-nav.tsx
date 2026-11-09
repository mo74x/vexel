'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Users, TrendingUp, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  locale: string;
  translations: {
    activity: string;
    reps: string;
    impact: string;
    settings: string;
  };
}

export function MobileNav({ locale, translations }: MobileNavProps) {
  const pathname = usePathname();

  const navItems = [
    {
      href: `/${locale}/activity`,
      label: translations.activity,
      icon: Activity,
    },
    {
      href: `/${locale}/reps`,
      label: translations.reps,
      icon: Users,
    },
    {
      href: `/${locale}/impact`,
      label: translations.impact,
      icon: TrendingUp,
    },
    {
      href: `/${locale}/settings`,
      label: translations.settings,
      icon: Settings,
    },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 flex h-16 items-center justify-around border-t border-border bg-card/95 backdrop-blur-md px-2 md:hidden">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition-colors min-h-[44px]',
              isActive
                ? 'text-brand-600 dark:text-brand-400 font-semibold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5 mb-0.5',
                isActive
                  ? 'text-brand-600 dark:text-brand-400'
                  : 'text-muted-foreground',
              )}
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

