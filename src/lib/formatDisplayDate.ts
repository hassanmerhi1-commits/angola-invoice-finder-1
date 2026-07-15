const EMPTY_DATE = '—';

/** Format a date for UI; null/empty/invalid values show — (never 01/01/1970). */
export function formatDisplayDate(
  value: string | Date | null | undefined,
  locale = 'pt-AO',
): string {
  if (value == null || value === '') return EMPTY_DATE;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return EMPTY_DATE;
  return parsed.toLocaleDateString(locale);
}
