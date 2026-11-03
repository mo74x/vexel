/**
 * Deterministically repairs common LLM JSON/type drift before Zod parsing
 * so trivial formatting quirks never burn an extra LLM repair turn.
 */
export function sanitizeRawToolInput(raw: unknown): Record<string, any> {
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

  // 2. Coerce stringified numbers with commas/currency symbols (e.g., "$15,000" -> 15000)
  if (typeof clone.amount === 'string') {
    const numeric = Number(clone.amount.replace(/[^0-9.-]+/g, ''));
    clone.amount = Number.isFinite(numeric) ? numeric : null;
  }

  // 3. Slice full ISO datetime strings (2026-11-15T00:00:00.000Z) to YYYY-MM-DD
  if (typeof clone.expectedCloseDateIso === 'string' && clone.expectedCloseDateIso.includes('T')) {
    clone.expectedCloseDateIso = clone.expectedCloseDateIso.split('T')[0];
  }

  // 4. Normalize dealStage casing & strip spaces (e.g., "Contract Sent" -> "contractsent")
  if (typeof clone.dealStage === 'string') {
    clone.dealStage = clone.dealStage.toLowerCase().replace(/[\s_-]+/g, '');
  }

  // 5. Coerce confidenceScore if returned as string or float
  if (clone.confidenceScore !== undefined && clone.confidenceScore !== null) {
    const parsedScore = Math.round(Number(clone.confidenceScore));
    if (Number.isFinite(parsedScore)) {
      clone.confidenceScore = Math.max(0, Math.min(100, parsedScore));
    }
  }

  return clone;
}