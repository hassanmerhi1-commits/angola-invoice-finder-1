import type { Branch, User } from '@/types/erp';

/** Admin/manager scope: consolidated stock/data across every branch. */
export const ALL_BRANCHES_SCOPE_ID = '__all_branches__';

const SCOPE_STORAGE_KEY = 'kwanza_branch_scope_id';

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

export function isConsolidatedBranchScope(
  canSwitch: boolean,
  scopeId: string | null | undefined,
): boolean {
  return canSwitch && String(scopeId || '') === ALL_BRANCHES_SCOPE_ID;
}

/** Consolidated all-branch API scope (admin/manager with "All branches" selected). */
export function isHeadOfficeScope(
  canSwitch: boolean,
  scopeId: string | null | undefined,
): boolean {
  return isConsolidatedBranchScope(canSwitch, scopeId);
}

export function resolveBranchFromScope(branches: Branch[], scopeId: string): Branch | null {
  if (scopeId === ALL_BRANCHES_SCOPE_ID) {
    return branches.find((b) => normalizeIsMain(b.isMain)) || branches[0] || null;
  }
  return branches.find((b) => String(b.id) === String(scopeId)) || null;
}

/** Restore global scope (top nav / dashboard): physical branches only, default main. */
export function resolveStoredBranchScopeId(
  branches: Branch[],
  canSwitch: boolean,
): string {
  if (!canSwitch || branches.length === 0) {
    return String(branches[0]?.id || '');
  }

  const main = branches.find((b) => normalizeIsMain(b.isMain));
  const savedScope = String(localStorage.getItem(SCOPE_STORAGE_KEY) || '').trim();
  if (savedScope === ALL_BRANCHES_SCOPE_ID && main) return main.id;
  if (savedScope && branches.some((b) => String(b.id) === savedScope)) return savedScope;

  const savedBranchId = String(localStorage.getItem('kwanza_current_branch_id') || '').trim();
  if (savedBranchId && branches.some((b) => String(b.id) === savedBranchId)) {
    return savedBranchId;
  }

  return main?.id || branches[0]?.id || '';
}

export function persistBranchScope(scopeId: string, displayBranch: Branch): void {
  localStorage.setItem(SCOPE_STORAGE_KEY, scopeId);
  localStorage.setItem('kwanza_current_branch_id', String(displayBranch.id));
}

/** True when the user must always use a single-branch API filter. */
export function isSingleBranchUser(
  canSwitch: boolean,
  scopeId: string | null | undefined,
): boolean {
  return !isHeadOfficeScope(canSwitch, scopeId);
}

export function effectiveApiBranchId(
  canSwitch: boolean,
  scopeId: string | null | undefined,
  user: BranchAccessUser,
): string | undefined {
  if (isConsolidatedBranchScope(canSwitch, scopeId)) return undefined;
  const fromScope = String(scopeId || '').trim();
  if (fromScope && fromScope !== ALL_BRANCHES_SCOPE_ID) return fromScope;
  const fromUser = String(user?.branchId ?? '').trim();
  return fromUser || undefined;
}

export function resolveOperatingBranch(
  canSwitch: boolean,
  scopeId: string | null | undefined,
  branches: Branch[],
  userBranch: Branch | null,
  user: BranchAccessUser,
): Branch | null {
  if (canSwitch) {
    return resolveBranchFromScope(branches, scopeId || ALL_BRANCHES_SCOPE_ID);
  }
  if (userBranch) return userBranch;
  const rawId = String(user?.branchId ?? '').trim();
  const fromScope = resolveBranchFromScope(branches, scopeId || rawId);
  if (fromScope) return fromScope;
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
