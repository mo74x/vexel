'use client';

import * as React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/components/providers/theme-provider';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    if (theme === 'system') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleTheme}
      aria-label={`Theme: ${theme}`}
      title={`Theme: ${theme}`}
      className="h-9 w-9 rounded-md text-muted-foreground hover:text-foreground"
    >
      {theme === 'light' && <Sun className="h-4 w-4 text-amber-500" />}
      {theme === 'dark' && <Moon className="h-4 w-4 text-blue-400" />}
      {theme === 'system' && <Monitor className="h-4 w-4" />}
    </Button>
  );
}

