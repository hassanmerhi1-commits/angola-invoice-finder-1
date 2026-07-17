import type { Branch, User } from '@/types/erp';

/** Admin/manager scope: consolidated stock/data across every branch. */
export const ALL_BRANCHES_SCOPE_ID = '__all_branches__';

const SCOPE_STORAGE_KEY = 'kwanza_branch_scope_id';

type BranchAccessUser = Pick<User, 'branchId' | 'role'> | null | undefined;

function isHeadOfficeRole(role: unknown): boolean {
  const r = String(role || '').toLowerCase();
  return r === 'admin' || r === 'manager';
}

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

export function normalizeBranchIdKey(id: string | null | undefined): string {
  return String(id ?? '').trim().toLowerCase().replace(/-/g, '');
}

export function branchIdsEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.toLowerCase() === right.toLowerCase()) return true;
  const lk = normalizeBranchIdKey(left);
  const rk = normalizeBranchIdKey(right);
  return lk.length >= 8 && lk === rk;
}

export function resolveUserBranch(branches: Branch[], branchId?: string | null): Branch | null {
  const id = String(branchId ?? '').trim();
  if (!id || branches.length === 0) return null;

  const byId = branches.find((b) => branchIdsEquivalent(b.id, id));
  if (byId) return byId;

  const lower = id.toLowerCase();
  return (
    branches.find((b) => String(b.code || '').trim().toLowerCase() === lower) ??
    branches.find((b) => String(b.name || '').trim().toLowerCase() === lower) ??
    branches.find((b) => normalizeBranchIdKey(b.id) === normalizeBranchIdKey(id)) ??
    null
  );
}

/** When several branches are flagged HQ (bad seed data), prefer code MAIN / "Main Branch". */
export function resolveHeadOfficeBranch(branches: Branch[]): Branch | null {
  const mains = branches.filter((b) => normalizeIsMain(b.isMain));
  if (mains.length === 0) return branches[0] || null;
  if (mains.length === 1) return mains[0];
  const byMainCode = mains.find((b) => String(b.code || '').trim().toUpperCase() === 'MAIN');
  if (byMainCode) return byMainCode;
  const byName = mains.find((b) => /main\s*branch/i.test(String(b.name || '')));
  if (byName) return byName;
  return mains[0];
}

/** Assigned branch; admin/manager without a valid assignment inherit head office. */
export function resolveEffectiveUserBranch(
  branches: Branch[],
  user: BranchAccessUser,
): Branch | null {
  const direct = resolveUserBranch(branches, user?.branchId);
  if (direct) return direct;
  if (isHeadOfficeRole(user?.role)) {
    return resolveHeadOfficeBranch(branches);
  }
  return null;
}

/** True for the HQ / Sede branch (is_main, code SEDE*, or name containing "sede"). */
export function looksLikeHeadOfficeBranch(branch: Branch | null | undefined): boolean {
  if (!branch) return false;
  if (normalizeIsMain(branch.isMain)) return true;
  const code = String(branch.code || '').trim().toUpperCase();
  const name = String(branch.name || '').trim().toLowerCase();
  return code === 'MAIN' || code.startsWith('SEDE') || name.includes('sede');
}

/**
 * Admin may always switch branches / use all-filial treasury (Sede or any shop login).
 * Manager only when assigned to head office (is_main or name/code SEDE).
 */
export function canUserSwitchBranch(user: BranchAccessUser, userBranch: Branch | null): boolean {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin') return true;
  if (role !== 'manager') return false;
  if (!userBranch) return true;
  return looksLikeHeadOfficeBranch(userBranch);
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

/**
 * Consolidated read scope: explicit "All branches", or the HQ/Sede branch itself.
 * Selecting Sede Soyo (Head Office badge) must show totals across all filials —
 * not only stock/docs owned by the sede row.
 */
export function isConsolidatedBranchScope(
  canSwitch: boolean,
  scopeId: string | null | undefined,
  branches: Branch[] = [],
): boolean {
  if (!canSwitch) return false;
  const id = String(scopeId || '').trim();
  if (!id) return false;
  if (id === ALL_BRANCHES_SCOPE_ID) return true;
  if (branches.length === 0) return false;
  return looksLikeHeadOfficeBranch(resolveUserBranch(branches, id));
}

/** Consolidated all-branch API scope (All branches or HQ/Sede selected). */
export function isHeadOfficeScope(
  canSwitch: boolean,
  scopeId: string | null | undefined,
  branches: Branch[] = [],
): boolean {
  return isConsolidatedBranchScope(canSwitch, scopeId, branches);
}

export function resolveBranchFromScope(branches: Branch[], scopeId: string): Branch | null {
  if (scopeId === ALL_BRANCHES_SCOPE_ID) {
    return branches.find((b) => normalizeIsMain(b.isMain)) || branches[0] || null;
  }
  return resolveUserBranch(branches, scopeId);
}

/** Restore global scope (top nav / dashboard): physical branches only, default main. */
export function resolveStoredBranchScopeId(
  branches: Branch[],
  canSwitch: boolean,
): string {
  if (!canSwitch || branches.length === 0) {
    return String(branches[0]?.id || '');
  }

  const savedScope = String(localStorage.getItem(SCOPE_STORAGE_KEY) || '').trim();
  if (savedScope === ALL_BRANCHES_SCOPE_ID) return ALL_BRANCHES_SCOPE_ID;
  if (savedScope) {
    const matched = resolveUserBranch(branches, savedScope);
    if (matched) return matched.id;
  }

  const savedBranchId = String(localStorage.getItem('kwanza_current_branch_id') || '').trim();
  if (savedBranchId) {
    const matched = resolveUserBranch(branches, savedBranchId);
    if (matched) return matched.id;
  }

  return ALL_BRANCHES_SCOPE_ID;
}

export function persistBranchScope(scopeId: string, displayBranch: Branch): void {
  localStorage.setItem(SCOPE_STORAGE_KEY, scopeId);
  localStorage.setItem('kwanza_current_branch_id', String(displayBranch.id));
}

/** True when the user must always use a single-branch API filter. */
export function isSingleBranchUser(
  canSwitch: boolean,
  scopeId: string | null | undefined,
  branches: Branch[] = [],
): boolean {
  return !isHeadOfficeScope(canSwitch, scopeId, branches);
}

export function effectiveApiBranchId(
  canSwitch: boolean,
  scopeId: string | null | undefined,
  user: BranchAccessUser,
  branches: Branch[] = [],
): string | undefined {
  if (isConsolidatedBranchScope(canSwitch, scopeId, branches)) return undefined;
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

export function branchIdsEqual(a?: string | null, b?: string | null): boolean {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  return left.length > 0 && left === right;
}

/** Approve (ship) from source branch — HQ admins with all-branches scope may approve any pending transfer. */
export function canApproveStockTransfer(
  transfer: { fromBranchId?: string; status?: string },
  opts: {
    scopeId?: string | null;
    canSwitchBranch?: boolean;
    userBranchId?: string | null;
    branches?: Branch[];
  },
): boolean {
  if (String(transfer.status || '').toLowerCase() !== 'pending') return false;
  const fromId = transfer.fromBranchId;
  if (branchIdsEqual(fromId, opts.scopeId)) return true;
  if (branchIdsEqual(fromId, opts.userBranchId)) return true;
  if (
    opts.canSwitchBranch
    && isConsolidatedBranchScope(true, opts.scopeId, opts.branches || [])
  ) {
    return true;
  }
  return false;
}

/** Receive at destination branch — HQ admins with all-branches scope may confirm any in-transit transfer. */
export function canReceiveStockTransfer(
  transfer: { toBranchId?: string; status?: string },
  opts: {
    scopeId?: string | null;
    canSwitchBranch?: boolean;
    userBranchId?: string | null;
    branches?: Branch[];
  },
): boolean {
  if (String(transfer.status || '').toLowerCase() !== 'in_transit') return false;
  const toId = transfer.toBranchId;
  if (branchIdsEqual(toId, opts.scopeId)) return true;
  if (branchIdsEqual(toId, opts.userBranchId)) return true;
  if (
    opts.canSwitchBranch
    && isConsolidatedBranchScope(true, opts.scopeId, opts.branches || [])
  ) {
    return true;
  }
  return false;
}

/** After login, pin filial users to their branch in localStorage. */
export function applyUserBranchLockOnLogin(user: BranchAccessUser): void {
  try {
    const raw = localStorage.getItem('kwanzaerp_branches');
    const branches: Branch[] = raw ? JSON.parse(raw) : [];
    const assigned = resolveEffectiveUserBranch(branches, user);
    if (assigned && !canUserSwitchBranch(user, assigned)) {
      localStorage.setItem('kwanza_current_branch_id', String(assigned.id));
      localStorage.setItem('kwanzaerp_current_branch', JSON.stringify(assigned));
      window.dispatchEvent(new CustomEvent('nexor:branch-lock-changed'));
    }
  } catch {
    /* ignore */
  }
}
