export function formatRelativeTime(
  dateString: string | null | undefined,
  locale = 'en',
): string {
  if (!dateString) return '—';

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';

  const now = Date.now();
  const diffInSeconds = Math.round((date.getTime() - now) / 1000);

  // If less than 45 seconds ago
  if (Math.abs(diffInSeconds) < 45) {
    return locale === 'ar' ? 'الآن' : 'just now';
  }

  const rtf = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    numeric: 'auto',
  });

  const cutoffs = [
    { limit: 60, unit: 'second' as const, divisor: 1 },
    { limit: 3600, unit: 'minute' as const, divisor: 60 },
    { limit: 86400, unit: 'hour' as const, divisor: 3600 },
    { limit: 604800, unit: 'day' as const, divisor: 86400 },
    { limit: 2592000, unit: 'week' as const, divisor: 604800 },
    { limit: 31536000, unit: 'month' as const, divisor: 2592000 },
  ];

  const absDiff = Math.abs(diffInSeconds);
  for (const cutoff of cutoffs) {
    if (absDiff < cutoff.limit) {
      const val = Math.round(diffInSeconds / cutoff.divisor);
      return rtf.format(val, cutoff.unit);
    }
  }

  const val = Math.round(diffInSeconds / 31536000);
  return rtf.format(val, 'year');
}

export function formatDateTime(
  dateString: string | null | undefined,
  locale = 'en',
): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

