export type RateLimitKind = 'BURST_10S' | 'DAILY_QUOTA' | 'SECONDLY' | 'PROACTIVE_LOW_REMAINING';

export interface HubSpotRateLimitTelemetry {
  remainingBurst: number | null;
  maxBurst: number | null;
  intervalMs: number;
  dailyRemaining: number | null;
  retryAfterMs: number;
  kind: RateLimitKind;
}

export class HubSpotRateLimitError extends Error {
  public readonly isRateLimitError = true;

  constructor(
    public readonly tenantId: string,
    public readonly retryAfterMs: number,
    public readonly telemetry: HubSpotRateLimitTelemetry,
  ) {
    super(
      `HubSpot rate limit [${telemetry.kind}] for tenant "${tenantId}". Backoff required: ${retryAfterMs}ms (Burst remaining: ${telemetry.remainingBurst ?? 'N/A'})`,
    );
    this.name = 'HubSpotRateLimitError';
  }
}

/**
 * Extracts HubSpot's rate-limit headers from any 2xx or 429 HTTP Response
 */
export function parseHubSpotRateLimitHeaders(headers: Headers): HubSpotRateLimitTelemetry {
  const getInt = (name: string): number | null => {
    const val = headers.get(name);
    if (val === null) return null;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const remainingBurst = getInt('x-hubspot-ratelimit-remaining');
  const maxBurst = getInt('x-hubspot-ratelimit-max');
  const intervalMs = getInt('x-hubspot-ratelimit-interval-milliseconds') ?? 10_000;
  const dailyRemaining = getInt('x-hubspot-ratelimit-daily-remaining');
  const secondlyRemaining = getInt('x-hubspot-ratelimit-secondly-remaining');
  const retryAfterRaw = headers.get('retry-after');

  // Add 250ms - 750ms jitter so concurrent delayed jobs don't collide on wake-up
  const jitterMs = Math.floor(250 + Math.random() * 500);

  // 1. Check if daily quota is completely exhausted
  if (dailyRemaining !== null && dailyRemaining <= 0) {
    return {
      remainingBurst,
      maxBurst,
      intervalMs,
      dailyRemaining,
      retryAfterMs: 60 * 60 * 1000 + jitterMs, // Delay 1 hour on daily quota exhaustion
      kind: 'DAILY_QUOTA',
    };
  }

  // 2. Honor explicit Retry-After header if returned (HubSpot sends seconds, e.g., "10")
  if (retryAfterRaw !== null) {
    const parsedRetry = Number(retryAfterRaw);
    const baseMs = Number.isFinite(parsedRetry)
      ? parsedRetry > 1000
        ? parsedRetry // Already in milliseconds
        : parsedRetry * 1000 // Convert seconds to milliseconds
      : intervalMs;

    return {
      remainingBurst,
      maxBurst,
      intervalMs,
      dailyRemaining,
      retryAfterMs: baseMs + jitterMs,
      kind: secondlyRemaining === 0 ? 'SECONDLY' : 'BURST_10S',
    };
  }

  // 3. Fallback to HubSpot's rolling window interval (default 10,000ms) + jitter
  return {
    remainingBurst,
    maxBurst,
    intervalMs,
    dailyRemaining,
    retryAfterMs: intervalMs + jitterMs,
    kind: remainingBurst !== null && remainingBurst > 0 ? 'PROACTIVE_LOW_REMAINING' : 'BURST_10S',
  };
}