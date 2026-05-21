import type { Branch, User } from '@/types/erp';

/** SQLite/API may return 1, 0, '1', true, etc. */
export function normalizeIsMain(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

export function mapBranchRow(b: Record<string, unknown>): Branch {
  const code = String(b.code || b.branch_code || '').trim();
  const rawName = String(b.name || '').trim();
  return {
    id: String(b.id),
    name: rawName || code,
    code,
    address: String(b.address || ''),
    phone: String(b.phone || ''),
    isMain: normalizeIsMain(b.isMain ?? b.is_main),
    priceLevel: Number(b.priceLevel ?? b.price_level ?? 1),
    createdAt: String(b.createdAt || b.created_at || ''),
  };
}

export function resolveUserBranch(branches: Branch[], branchId?: string | null): Branch | null {
  const id = String(branchId ?? '').trim();
  if (!id || branches.length === 0) return null;

  const byId = branches.find((b) => String(b.id) === id);
  if (byId) return byId;

  const lower = id.toLowerCase();
  return (
    branches.find((b) => String(b.code || '').trim().toLowerCase() === lower) ??
    branches.find((b) => String(b.name || '').trim().toLowerCase() === lower) ??
    null
  );
}

type BranchAccessUser = Pick<User, 'branchId' | 'role'> | null | undefined;

function isHeadOfficeRole(role: unknown): boolean {
  const r = String(role || '').toLowerCase();
  return r === 'admin' || r === 'manager';
}

/** Only admin/manager at the head-office (main) branch may switch branches and see all filials. */
export function canUserSwitchBranch(user: BranchAccessUser, userBranch: Branch | null): boolean {
  if (!userBranch || !normalizeIsMain(userBranch.isMain)) return false;
  return isHeadOfficeRole(user?.role);
}

export function branchesVisibleToUser(
  branches: Branch[],
  canSwitch: boolean,
  userBranch: Branch | null,
  currentBranch: Branch | null,
): Branch[] {
  if (canSwitch) return branches;
  if (userBranch) return [userBranch];
  if (currentBranch) return [currentBranch];
  return [];
}

/** Consolidated all-branch API scope (admin/manager at sede only). */
export function isHeadOfficeScope(
  canSwitch: boolean,
  operatingBranch: Branch | null,
): boolean {
  return canSwitch && normalizeIsMain(operatingBranch?.isMain);
}

/** True when the user must always use a single-branch API filter. */
export function isSingleBranchUser(
  canSwitch: boolean,
  operatingBranch: Branch | null,
): boolean {
  return !isHeadOfficeScope(canSwitch, operatingBranch);
}

export function effectiveApiBranchId(
  canSwitch: boolean,
  operatingBranch: Branch | null,
  user: BranchAccessUser,
): string | undefined {
  if (isHeadOfficeScope(canSwitch, operatingBranch)) return undefined;
  const fromBranch = String(operatingBranch?.id ?? '').trim();
  if (fromBranch) return fromBranch;
  const fromUser = String(user?.branchId ?? '').trim();
  return fromUser || undefined;
}

export function resolveOperatingBranch(
  canSwitch: boolean,
  currentBranch: Branch | null,
  userBranch: Branch | null,
  user: BranchAccessUser,
): Branch | null {
  if (canSwitch) return currentBranch;
  if (userBranch) return userBranch;
  const rawId = String(user?.branchId ?? '').trim();
  if (rawId && currentBranch && String(currentBranch.id) === rawId) return currentBranch;
  if (rawId && currentBranch && !normalizeIsMain(currentBranch.isMain)) return currentBranch;
  return null;
}

/** After login, pin filial users to their branch in localStorage. */
export function applyUserBranchLockOnLogin(user: BranchAccessUser): void {
  try {
    const raw = localStorage.getItem('kwanzaerp_branches');
    const branches: Branch[] = raw ? JSON.parse(raw) : [];
    const assigned = resolveUserBranch(branches, user?.branchId);
    if (assigned && !canUserSwitchBranch(user, assigned)) {
      localStorage.setItem('kwanza_current_branch_id', String(assigned.id));
      localStorage.setItem('kwanzaerp_current_branch', JSON.stringify(assigned));
      window.dispatchEvent(new CustomEvent('nexor:branch-lock-changed'));
    }
  } catch {
    /* ignore */
  }
}
