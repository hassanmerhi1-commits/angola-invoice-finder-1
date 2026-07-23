import type { UserRole, PermissionOverrides } from '@/lib/permissions';
import { userHasPermission } from '@/lib/permissions';

/** Local calendar day as YYYY-MM-DD (not UTC). */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
