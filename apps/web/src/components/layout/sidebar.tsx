'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Users,
  TrendingUp,
  Settings,
  LogOut,
  Building2,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers/auth-provider';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  locale: string;
  translations: {
    activity: string;
    reps: string;
    impact: string;
    settings: string;
    logout: string;
    brandTitle: string;
    brandTagline: string;
  };
}

export function Sidebar({ locale, translations }: SidebarProps) {
  const pathname = usePathname();
  const { user, activeTenant, currentRole, logout } = useAuth();

  const navItems = [
    {
      href: `/${locale}/activity`,
      label: translations.activity,
      icon: Activity,
      exact: false,
    },
    {
      href: `/${locale}/reps`,
      label: translations.reps,
      icon: Users,
      exact: false,
    },
    {
      href: `/${locale}/impact`,
      label: translations.impact,
      icon: TrendingUp,
      exact: false,
    },
    {
      href: `/${locale}/settings`,
      label: translations.settings,
      icon: Settings,
      exact: false,
    },
  ];

  return (
    <aside className="hidden md:flex h-screen w-64 flex-col border-e border-border bg-card/60 backdrop-blur-md">
      {/* Brand & Workspace Header */}
      <div className="flex h-16 items-center justify-between border-b border-border ps-5 pe-4">
        <Link
          href={`/${locale}/activity`}
          className="flex items-center gap-2.5 focus:outline-none"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white shadow-sm dark:bg-brand-500 dark:text-zinc-950 font-bold text-base">
            V
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              {translations.brandTitle}
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              {translations.brandTagline}
            </span>
          </div>
        </Link>
        <ThemeToggle />
      </div>

      {/* Active Workspace Pill */}
      {activeTenant && (
        <div className="mx-3 my-3 flex items-center justify-between rounded-md border border-border/60 bg-muted/30 ps-3 pe-3 py-2 text-xs">
          <div className="flex items-center gap-2 overflow-hidden">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium text-foreground">
              {activeTenant.name}
            </span>
          </div>
          {currentRole && (
            <Badge
              variant={currentRole === 'ADMIN' ? 'default' : 'secondary'}
              className="text-[10px] py-0 px-1.5 shrink-0 font-medium"
            >
              {currentRole}
            </Badge>
          )}
        </div>
      )}

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-md ps-3 pe-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-500/15 text-brand-700 dark:text-brand-400 font-semibold'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0 transition-colors',
                  isActive
                    ? 'text-brand-600 dark:text-brand-400'
                    : 'text-muted-foreground group-hover:text-foreground',
                )}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer / User Profile & Controls */}
      <div className="border-t border-border p-3 space-y-2">
        <div className="flex items-center justify-between ps-2 pe-1">
          <LocaleSwitcher currentLocale={locale} />
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            title={translations.logout}
            aria-label={translations.logout}
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>

        {user && (
          <div className="flex items-center gap-2.5 rounded-md bg-muted/40 p-2 text-xs">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-brand-700 dark:text-brand-300 font-semibold text-xs">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">{user.name}</p>
              <p className="truncate text-[10px] text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

