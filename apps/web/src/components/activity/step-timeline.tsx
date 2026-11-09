import * as React from 'react';
import { CheckCircle2, Clock, AlertCircle, ArrowDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { WorkflowStepItem } from '@/lib/types';

export interface StepTimelineProps {
  steps?: WorkflowStepItem[];
  locale?: string;
  labels: {
    title: string;
    subtitle: string;
    step: string;
    duration: string;
    status: string;
    empty: string;
  };
}

export function StepTimeline({
  steps = [],
  locale = 'en',
  labels,
}: StepTimelineProps) {
  // Translate internal step keys into clean plain English / Arabic terminology
  const formatStepName = (key: string): string => {
    const keyLower = key.toLowerCase();
    if (keyLower.includes('transcript') || keyLower.includes('audio') || keyLower.includes('1')) {
      return locale === 'ar' ? 'استلام الملاحظة الصوتية ومعالجتها' : 'Voice Note Received & Transcribed';
    }
    if (keyLower.includes('extract') || keyLower.includes('llm') || keyLower.includes('2')) {
      return locale === 'ar' ? 'استخراج حقول الصفقة بالذكاء الاصطناعي' : 'AI Extraction & Entity Resolution';
    }
    if (keyLower.includes('approval') || keyLower.includes('whatsapp') || keyLower.includes('3')) {
      return locale === 'ar' ? 'فحص عتبة الاعتماد ومطابقة المندوب' : 'Confidence Check & Rep Validation';
    }
    if (keyLower.includes('sync') || keyLower.includes('hubspot') || keyLower.includes('4')) {
      return locale === 'ar' ? 'مزامنة الصفقة مع منصة هاب سبوت' : 'HubSpot CRM Synchronization';
    }
    if (keyLower.includes('snapshot') || keyLower.includes('undo') || keyLower.includes('5')) {
      return locale === 'ar' ? 'حفظ لقطة التراجع السريع (١٥ دقيقة)' : 'Rollback Snapshot Initialized';
    }
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (!steps || steps.length === 0) {
    return (
      <Card data-testid="step-timeline-empty">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand-600 dark:text-brand-400" />
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
    <Card data-testid="step-timeline">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          <span>{labels.title}</span>
        </CardTitle>
        <CardDescription className="text-xs">{labels.subtitle}</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="relative ps-6 space-y-6 before:absolute before:start-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
          {steps.map((step, idx) => {
            const isCompleted = step.status === 'COMPLETED' || step.status === 'SUCCESS';
            const isFailed = step.status === 'FAILED';

            return (
              <div key={step.id || idx} className="relative group">
                {/* Node indicator */}
                <div
                  className={`absolute -start-6 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background ${
                    isCompleted
                      ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                      : isFailed
                      ? 'border-destructive text-destructive'
                      : 'border-muted-foreground text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : isFailed ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : (
                    <div className="h-1.5 w-1.5 rounded-full bg-current" />
                  )}
                </div>

                {/* Step content */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">
                      {formatStepName(step.stepKey)}
                    </h4>
                    {step.errorLog && (
                      <p className="text-[11px] text-destructive mt-0.5 font-mono">
                        {step.errorLog}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono shrink-0">
                    {step.durationMs !== undefined && step.durationMs !== null && (
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        {step.durationMs}ms
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

