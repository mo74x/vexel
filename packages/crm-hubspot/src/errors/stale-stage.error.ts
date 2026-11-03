export class StaleDealStageError extends Error {
  public readonly isStaleDealStage = true;

  constructor(
    public readonly tenantId: string,
    public readonly pipelineId: string,
    public readonly rejectedStageId: string,
    public readonly hubspotCorrelationId?: string,
  ) {
    super(
      `HubSpot rejected stale dealstage ID "${rejectedStageId}" on pipeline "${pipelineId}" for tenant "${tenantId}"`,
    );
    this.name = 'StaleDealStageError';
  }
}

/**
 * Inspects HubSpot HTTP 400 error payloads to determine if the rejection
 * was caused specifically by a deleted or mutated dealstage / pipeline ID.
 */
export function isHubSpotStaleStageError(status: number, errorBody: any): boolean {
  if (status !== 400 || !errorBody) {
    return false;
  }

  if (errorBody.category !== 'VALIDATION_ERROR') {
    return false;
  }

  const rawMessage = typeof errorBody.message === 'string' ? errorBody.message : '';
  const structuredErrors = Array.isArray(errorBody.errors) ? errorBody.errors : [];

  // Check 1: Inspect HubSpot's stringified array inside errorBody.message
  const mentionsDealStage =
    rawMessage.includes('"name":"dealstage"') ||
    rawMessage.includes('"name":"pipeline"') ||
    rawMessage.toLowerCase().includes('dealstage');

  const mentionsInvalidOption =
    rawMessage.includes('INVALID_OPTION') ||
    rawMessage.includes('PROPERTY_DOESNT_EXIST') ||
    rawMessage.includes('was not one of the allowed options');

  if (mentionsDealStage && mentionsInvalidOption) {
    return true;
  }

  // Check 2: Inspect structured v3/v4 errors array if present
  return structuredErrors.some((err: any) => {
    const propName = err?.context?.propertyName?.[0] ?? err?.in;
    return (
      (propName === 'dealstage' || propName === 'pipeline') &&
      (err?.code === 'INVALID_OPTION' || err?.subCategory === 'PropertyValidationError.INVALID_OPTION')
    );
  });
}