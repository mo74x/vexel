'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { RepActivitySummary } from '@/lib/types';

export interface ImpactRepsTableProps {
  repsActivity: RepActivitySummary[];
}

export function ImpactRepsTable({ repsActivity }: ImpactRepsTableProps) {
  const t = useTranslations('impact.repsTable');

  return (
    <Card className="rounded-2xl border-border bg-card shadow-sm p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {t('title')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
      </div>

      {repsActivity.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 text-xs text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-start text-sm">
            <thead className="bg-muted/40 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
              <tr>
                <th className="py-3 px-4 text-start">{t('rep')}</th>
                <th className="py-3 px-4 text-center">{t('total')}</th>
                <th className="py-3 px-4 text-center">{t('autoSynced')}</th>
                <th className="py-3 px-4 text-center">{t('approved')}</th>
                <th className="py-3 px-4 text-center">{t('rejected')}</th>
                <th className="py-3 px-4 text-end">{t('avgConfidence')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {repsActivity.map((rep) => {
                const initials = rep.fullName
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();

                const conf = rep.averageConfidence;
                const confColor =
                  typeof conf !== 'number'
                    ? 'outline'
                    : conf >= 85
                    ? 'success'
                    : conf >= 70
                    ? 'default'
                    : 'warning';

                return (
                  <tr key={rep.repId} className="hover:bg-muted/20 transition-colors">
                    {/* Rep Name & Email */}
                    <td className="py-3 px-4 font-medium text-foreground whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                          {initials}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{rep.fullName}</div>
                          <div className="text-xs text-muted-foreground">{rep.email}</div>
                        </div>
                      </div>
                    </td>

                    {/* Total Runs */}
                    <td className="py-3 px-4 text-center font-mono font-medium whitespace-nowrap">
                      {rep.totalRuns}
                    </td>

                    {/* Auto-Synced */}
                    <td className="py-3 px-4 text-center font-mono text-emerald-600 dark:text-emerald-400 font-medium whitespace-nowrap">
                      {rep.autoSyncedCount}
                    </td>

                    {/* Approved (with override count) */}
                    <td className="py-3 px-4 text-center font-mono whitespace-nowrap">
                      <span>{rep.approvedCount}</span>
                      {rep.overrideCount > 0 && (
                        <span className="ms-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                          +{rep.overrideCount} edited
                        </span>
                      )}
                    </td>

                    {/* Declined */}
                    <td className="py-3 px-4 text-center font-mono text-rose-600 dark:text-rose-400 font-medium whitespace-nowrap">
                      {rep.rejectedCount}
                    </td>

                    {/* Average Confidence */}
                    <td className="py-3 px-4 text-end whitespace-nowrap">
                      {typeof conf === 'number' ? (
                        <Badge variant={confColor as any} className="font-mono text-xs">
                          {conf}%
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground font-mono">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
