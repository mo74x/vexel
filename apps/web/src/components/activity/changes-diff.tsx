import * as React from 'react';
import { ArrowRight, Check, Edit3, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export interface ChangesDiffProps {
  extractedData?: Record<string, unknown> | null;
  overriddenFields?: Record<string, { from: unknown; to: unknown }> | null;
  labels: {
    title: string;
    subtitle: string;
    empty: string;
    property: string;
    before: string;
    after: string;
    overrideBadge: string;
  };
}

export function ChangesDiff({
  extractedData,
  overriddenFields,
  labels,
}: ChangesDiffProps) {
  // Combine extracted fields and overridden fields into a clean list of changes
  const changesList = React.useMemo(() => {
    const list: Array<{
      key: string;
      displayName: string;
      before: string;
      after: string;
      isOverridden: boolean;
    }> = [];

    const formatVal = (v: unknown): string => {
      if (v === null || v === undefined) return '—';
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    };

    // Format human-friendly property names
    const formatName = (k: string): string => {
      return k
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (char) => char.toUpperCase());
    };

    const keys = new Set<string>();
    if (extractedData) Object.keys(extractedData).forEach((k) => keys.add(k));
    if (overriddenFields) Object.keys(overriddenFields).forEach((k) => keys.add(k));

    keys.forEach((key) => {
      // Skip internal metadata fields
      if (key === 'confidence' || key === 'confidence_score' || key === 'metadata') {
        return;
      }

      const override = overriddenFields?.[key];
      const extractedVal = extractedData?.[key];

      if (override) {
        list.push({
          key,
          displayName: formatName(key),
          before: formatVal(override.from),
          after: formatVal(override.to),
          isOverridden: true,
        });
      } else if (extractedVal !== undefined) {
        list.push({
          key,
          displayName: formatName(key),
          before: '—',
          after: formatVal(extractedVal),
          isOverridden: false,
        });
      }
    });

    return list;
  }, [extractedData, overriddenFields]);

  if (changesList.length === 0) {
    return (
      <Card data-testid="changes-diff-empty">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            <span>{labels.title}</span>
          </CardTitle>
          <CardDescription className="text-xs">{labels.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground italic">{labels.empty}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="changes-diff">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          <span>{labels.title}</span>
        </CardTitle>
        <CardDescription className="text-xs">{labels.subtitle}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="divide-y divide-border/60 rounded-md border border-border/80 bg-card overflow-hidden">
          {changesList.map((item) => (
            <div key={item.key} className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-muted/15 transition-colors">
              <div className="space-y-1 min-w-[140px]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground text-sm">
                    {item.displayName}
                  </span>
                  {item.isOverridden && (
                    <Badge
                      variant="warning"
                      className="gap-1 text-[10px] py-0 px-1.5"
                      title={labels.overrideBadge}
                    >
                      <Edit3 className="h-2.5 w-2.5" />
                      <span>{labels.overrideBadge}</span>
                    </Badge>
                  )}
                </div>
                <span className="font-mono text-[10px] text-muted-foreground block">
                  {item.key}
                </span>
              </div>

              {/* Before -> After Diff Row */}
              <div className="flex items-center gap-2 font-mono sm:text-end">
                {item.before !== '—' && (
                  <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground line-through">
                    {item.before}
                  </span>
                )}
                {item.before !== '—' && (
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 rtl:rotate-180" />
                )}
                <span
                  className={`rounded px-2 py-0.5 font-bold ${
                    item.isOverridden
                      ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  {item.after}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

