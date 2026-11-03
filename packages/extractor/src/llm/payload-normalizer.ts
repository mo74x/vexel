import { TenantDealStage } from '../cache/pipeline-stage-cache.service';

export function sanitizeRawToolInput(
  raw: unknown,
  tenantStages: TenantDealStage[] = [],
): Record<string, any> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const clone: Record<string, any> = structuredClone(raw);

  // 1. Recursively convert stringified "null", "undefined", or empty strings to null
  const cleanNullStrings = (obj: Record<string, any>) => {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'n/a') {
          obj[key] = null;
        } else {
          obj[key] = trimmed;
        }
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        cleanNullStrings(val);
      }
    }
  };
  cleanNullStrings(clone);

  // 2. Coerce stringified numbers with commas/currency symbols
  if (typeof clone.amount === 'string') {
    const numeric = Number(clone.amount.replace(/[^0-9.-]+/g, ''));
    clone.amount = Number.isFinite(numeric) ? numeric : null;
  }

  // 3. Slice full ISO datetime strings to YYYY-MM-DD
  if (typeof clone.expectedCloseDateIso === 'string' && clone.expectedCloseDateIso.includes('T')) {
    clone.expectedCloseDateIso = clone.expectedCloseDateIso.split('T')[0];
  }

  // 4. Dynamic Stage Label -> Internal HubSpot ID Resolution
  if (typeof clone.dealStage === 'string') {
    const rawStage = clone.dealStage.trim();
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

    if (norm(rawStage) === 'unchanged') {
      clone.dealStage = 'unchanged';
    } else {
      // Match against exact ID, normalized ID, or normalized human-readable label
      const matchedStage = tenantStages.find(
        (s) =>
          s.id === rawStage ||
          norm(s.id) === norm(rawStage) ||
          norm(s.label) === norm(rawStage),
      );

      if (matchedStage) {
        clone.dealStage = matchedStage.id; // Always output exact internal HubSpot ID
      }
    }
  }

  // 5. Clamp confidenceScore to 0-100 integer
  if (clone.confidenceScore !== undefined && clone.confidenceScore !== null) {
    const parsedScore = Math.round(Number(clone.confidenceScore));
    if (Number.isFinite(parsedScore)) {
      clone.confidenceScore = Math.max(0, Math.min(100, parsedScore));
    }
  }

  return clone;
}