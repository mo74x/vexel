'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

export interface OnboardingStepperProps {
  currentStep: 1 | 2 | 3 | 4;
  completedSteps: number[];
  onSelectStep: (step: 1 | 2 | 3 | 4) => void;
}

export function OnboardingStepper({
  currentStep,
  completedSteps,
  onSelectStep,
}: OnboardingStepperProps) {
  const t = useTranslations('onboarding.steps');

  const steps: Array<{
    id: 1 | 2 | 3 | 4;
    key: 'hubspot' | 'whatsapp' | 'reps' | 'rules';
  }> = [
    { id: 1, key: 'hubspot' },
    { id: 2, key: 'whatsapp' },
    { id: 3, key: 'reps' },
    { id: 4, key: 'rules' },
  ];

  return (
    <nav
      aria-label="Onboarding Progress"
      className="w-full rounded-2xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur"
    >
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => {
          const isCurrent = currentStep === step.id;
          const isCompleted = completedSteps.includes(step.id);
          const isClickable = isCompleted || step.id <= currentStep;

          return (
            <li key={step.id} className="relative">
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onSelectStep(step.id)}
                className={`group flex w-full items-start gap-3 rounded-xl p-3 text-start transition-all ${
                  isCurrent
                    ? 'bg-primary/10 ring-1 ring-primary/40'
                    : isClickable
                    ? 'hover:bg-muted/50 cursor-pointer'
                    : 'opacity-50 cursor-not-allowed'
                }`}
              >
                {/* Step indicator circle */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground'
                      : isCurrent
                      ? 'border-2 border-primary bg-background text-primary'
                      : 'border border-border bg-muted/30 text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    step.id
                  )}
                </div>

                {/* Step Text */}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-xs font-medium uppercase tracking-wider ${
                      isCurrent
                        ? 'text-primary'
                        : isCompleted
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {t(`${step.key}.title`)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t(`${step.key}.desc`)}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

