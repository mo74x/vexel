'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ImpactDatePickerProps {
  from?: string;
  to?: string;
  activePreset: '7d' | '30d' | '90d' | 'custom';
  onSelectPreset: (preset: '7d' | '30d' | '90d') => void;
  onCustomRangeApply: (from: string, to: string) => void;
}

export function ImpactDatePicker({
  from,
  to,
  activePreset,
  onSelectPreset,
  onCustomRangeApply,
}: ImpactDatePickerProps) {
  const t = useTranslations('impact.dateRange');
  const [isCustomOpen, setIsCustomOpen] = React.useState(activePreset === 'custom');
  const [customFrom, setCustomFrom] = React.useState(from?.slice(0, 10) || '');
  const [customTo, setCustomTo] = React.useState(to?.slice(0, 10) || '');

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customFrom && customTo) {
      onCustomRangeApply(
        new Date(`${customFrom}T00:00:00Z`).toISOString(),
        new Date(`${customTo}T23:59:59Z`).toISOString(),
      );
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border bg-card/60 p-2.5 backdrop-blur">
      {/* Preset Buttons */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          type="button"
          size="sm"
          variant={activePreset === '7d' ? 'default' : 'ghost'}
          onClick={() => {
            setIsCustomOpen(false);
            onSelectPreset('7d');
          }}
          className="text-xs h-8 px-3"
        >
          {t('preset7d')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activePreset === '30d' ? 'default' : 'ghost'}
          onClick={() => {
            setIsCustomOpen(false);
            onSelectPreset('30d');
          }}
          className="text-xs h-8 px-3"
        >
          {t('preset30d')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activePreset === '90d' ? 'default' : 'ghost'}
          onClick={() => {
            setIsCustomOpen(false);
            onSelectPreset('90d');
          }}
          className="text-xs h-8 px-3"
        >
          {t('preset90d')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activePreset === 'custom' || isCustomOpen ? 'outline' : 'ghost'}
          onClick={() => setIsCustomOpen(!isCustomOpen)}
          className="text-xs h-8 px-3"
        >
          {t('custom')}
        </Button>
      </div>

      {/* Custom Date Range Inline Form */}
      {isCustomOpen && (
        <form
          onSubmit={handleApplyCustom}
          className="flex items-center gap-2 flex-wrap pt-2 sm:pt-0 border-t sm:border-t-0 border-border"
        >
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{t('from')}:</span>
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 text-xs w-36 px-2"
              required
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{t('to')}:</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 text-xs w-36 px-2"
              required
            />
          </div>
          <Button type="submit" size="sm" className="h-8 text-xs px-3">
            {t('apply')}
          </Button>
        </form>
      )}
    </div>
  );
}

