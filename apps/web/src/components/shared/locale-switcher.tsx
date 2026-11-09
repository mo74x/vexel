'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LocaleSwitcher({ currentLocale }: { currentLocale: string }) {
  const router = useRouter();
  const pathname = usePathname();

  const toggleLocale = () => {
    const nextLocale = currentLocale === 'ar' ? 'en' : 'ar';
    // Replace leading /[locale] with nextLocale
    const segments = pathname.split('/');
    if (segments[1] === 'en' || segments[1] === 'ar') {
      segments[1] = nextLocale;
      router.push(segments.join('/'));
    } else {
      router.push(`/${nextLocale}${pathname}`);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleLocale}
      className="h-9 gap-1.5 ps-2.5 pe-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      aria-label="Toggle language"
    >
      <Languages className="h-3.5 w-3.5" />
      <span>{currentLocale === 'ar' ? 'English' : 'العربية'}</span>
    </Button>
  );
}

