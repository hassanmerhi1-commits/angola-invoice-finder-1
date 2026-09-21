import type { UserRole, PermissionOverrides } from '@/lib/permissions';
import { userHasPermission } from '@/lib/permissions';

/** Business calendar for lists and POS — same zone as GET /sales dateFrom/dateTo. */
export const BUSINESS_TIME_ZONE = 'Africa/Luanda';

function calendarDayInZone(d: Date, timeZone = BUSINESS_TIME_ZONE): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    /* Intl timezone data missing */
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Angola business day as YYYY-MM-DD (not the browser clock, not UTC). */
export function localISODate(d: Date = new Date()): string {
  return calendarDayInZone(d);
}

/**
 * Business calendar day of a sale/document timestamp.
 * ISO `Z` must not be sliced as UTC (`2026-09-18T23:30:00.000Z` in Angola is the 19th).
 * Naive `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm:ss` keep the stored day.
 */
export function timestampLocalDate(createdAt: unknown): string {
  if (createdAt instanceof Date) {
    return Number.isFinite(createdAt.getTime()) ? localISODate(createdAt) : '';
  }
  const raw = String(createdAt ?? '').trim();
  if (!raw) return '';
  const ymd = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (ymd && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw.slice(10))) return ymd[1];
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return ymd?.[1] || '';
  return localISODate(d);
}

/** Normalize to YYYY-MM-DD for comparisons. */
export function toISODateOnly(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return localISODate(value);
  return String(value).slice(0, 10);
}

export function isBeforeToday(isoDate: string | Date | null | undefined): boolean {
  const day = toISODateOnly(isoDate);
  if (!day) return false;
  return day < localISODate();
}

export function isAfterToday(isoDate: string | Date | null | undefined): boolean {
  const day = toISODateOnly(isoDate);
  if (!day) return false;
  return day > localISODate();
}

/** Create/save with a posting date — past dates need backdate_post. */
export function canUsePostingDate(
  role: UserRole | string | null | undefined,
  overrides: Partial<PermissionOverrides> | null | undefined,
  isoDate: string | Date | null | undefined,
): boolean {
  if (!isBeforeToday(isoDate)) return true;
  return userHasPermission((role || 'viewer') as UserRole, overrides, 'backdate_post');
}

/** Edit an existing record dated before today — needs edit_historical. */
export function canEditRecordDated(
  role: UserRole | string | null | undefined,
  overrides: Partial<PermissionOverrides> | null | undefined,
  isoDate: string | Date | null | undefined,
): boolean {
  if (!isBeforeToday(isoDate)) return true;
  return userHasPermission((role || 'viewer') as UserRole, overrides, 'edit_historical');
}
