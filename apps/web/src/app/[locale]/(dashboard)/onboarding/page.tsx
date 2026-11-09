'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useOnboardingStatus, useMe } from '@/hooks/use-vexel-api';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { StepHubSpot } from '@/components/onboarding/step-hubspot';
import { StepWhatsApp } from '@/components/onboarding/step-whatsapp';
import { StepReps } from '@/components/onboarding/step-reps';
import { StepRules } from '@/components/onboarding/step-rules';
import { getActiveStepFromStatus } from '@/components/onboarding/resume-helper';
import { LoadingState } from '@/components/shared/loading-state';
import { ErrorState } from '@/components/shared/error-state';

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const { data: status, isLoading: statusLoading, error: statusError, refetch } =
    useOnboardingStatus();
  const { data: meData } = useMe();

  const [currentStep, setCurrentStep] = React.useState<1 | 2 | 3 | 4>(1);
  const [hasInitialized, setHasInitialized] = React.useState(false);

  // Resume where user left off on initial status load
  React.useEffect(() => {
    if (status && !hasInitialized) {
      const resumed = getActiveStepFromStatus(status);
      setCurrentStep(resumed);
      setHasInitialized(true);
    }
  }, [status, hasInitialized]);

  if (statusLoading) {
    return (
      <div className="py-12">
        <LoadingState message="Checking integration status..." rows={3} />
      </div>
    );
  }

  if (statusError || !status) {
    return (
      <div className="py-12">
        <ErrorState
          title="Failed to load onboarding status"
          description="Could not verify connected integrations. Please check your network and retry."
          retry={() => refetch()}
        />
      </div>
    );
  }

  // Calculate completed steps
  const completedSteps: number[] = [];
  if (status.hubspotConnected) completedSteps.push(1);
  if (status.whatsappConnected) completedSteps.push(2);
  if (status.repsLinkedCount > 0) completedSteps.push(3);
  if (status.firstRunReceived) completedSteps.push(4);

  const tenantId = meData?.activeTenant?.id || status.tenantId;

  return (
    <div className="space-y-8 max-w-4xl mx-auto py-4">
      {/* Page Title & Intro */}
      <div className="space-y-2 text-start">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          {t('resumeNotice')}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {t('subtitle')}
        </p>
      </div>

      {/* Stepper Bar */}
      <OnboardingStepper
        currentStep={currentStep}
        completedSteps={completedSteps}
        onSelectStep={(step) => setCurrentStep(step)}
      />

      {/* Active Step Content */}
      <div className="transition-opacity duration-200">
        {currentStep === 1 && (
          <StepHubSpot
            status={status}
            tenantId={tenantId}
            onNext={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 2 && (
          <StepWhatsApp
            status={status}
            onNext={() => setCurrentStep(3)}
            onBack={() => setCurrentStep(1)}
          />
        )}

        {currentStep === 3 && (
          <StepReps
            status={status}
            onNext={() => setCurrentStep(4)}
            onBack={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 4 && (
          <StepRules
            status={status}
            onBack={() => setCurrentStep(3)}
          />
        )}
      </div>
    </div>
  );
}

