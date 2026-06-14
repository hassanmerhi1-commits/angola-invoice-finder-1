import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Branch } from '@/types/erp';
import {
  ALL_BRANCHES_SCOPE_ID,
  isConsolidatedBranchScope,
  resolveBranchFromScope,
} from '@/lib/branchAccess';
import { useBranchScope } from '@/hooks/useBranchScope';

const INVENTORY_SCOPE_STORAGE_KEY = 'kwanza_inventory_scope_id';

function resolveStoredInventoryScopeId(branches: Branch[], canSwitch: boolean): string {
  if (!canSwitch || branches.length === 0) {
    return String(branches[0]?.id || '');
  }

  const saved = String(localStorage.getItem(INVENTORY_SCOPE_STORAGE_KEY) || '').trim();
  if (saved === ALL_BRANCHES_SCOPE_ID) return ALL_BRANCHES_SCOPE_ID;
  if (saved && branches.some((b) => String(b.id) === saved)) return saved;

  const globalScope = String(localStorage.getItem('kwanza_branch_scope_id') || '').trim();
  if (globalScope && globalScope !== ALL_BRANCHES_SCOPE_ID && branches.some((b) => String(b.id) === globalScope)) {
    return globalScope;
  }

  return ALL_BRANCHES_SCOPE_ID;
}

/**
 * Inventory-only branch scope (includes "All branches" totals).
 * Global top-nav scope stays a single physical branch.
 */
export function useInventoryBranchScope() {
  const global = useBranchScope();
  const {
    branches,
    allBranches,
    canSwitchBranch,
    userBranch,
    scopeId: globalScopeId,
    setOperatingScope,
  } = global;

  const [inventoryScopeId, setInventoryScopeIdState] = useState<string>(() => {
    if (!canSwitchBranch) {
      return userBranch?.id || global.apiBranchId || String(branches[0]?.id || '');
    }
    return resolveStoredInventoryScopeId(branches, canSwitchBranch);
  });

  const prevGlobalScopeRef = useRef(globalScopeId);

  useEffect(() => {
    if (!canSwitchBranch) {
      const locked =
        userBranch?.id ||
        global.currentBranch?.id ||
        global.apiBranchId ||
        '';
      if (locked) {
        setInventoryScopeIdState(locked);
        localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, locked);
      }
      return;
    }
    setInventoryScopeIdState((prev) => {
      if (prev && branches.some((b) => b.id === prev)) return prev;
      return resolveStoredInventoryScopeId(branches, true);
    });
  }, [branches, canSwitchBranch, global.currentBranch?.id, global.apiBranchId, userBranch?.id]);

  /** TopNav branch dropdown → inventory grid (only when global scope actually changes). */
  useEffect(() => {
    if (!canSwitchBranch) return;
    const g = String(globalScopeId || '').trim();
    if (!g || g === ALL_BRANCHES_SCOPE_ID) {
      prevGlobalScopeRef.current = g;
      return;
    }
    if (prevGlobalScopeRef.current === g) return;
    prevGlobalScopeRef.current = g;
    setInventoryScopeIdState((prev) => {
      if (prev === g) return prev;
      localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, g);
      return g;
    });
  }, [globalScopeId, canSwitchBranch]);

  const setInventoryScope = useCallback((scopeId: string) => {
    setInventoryScopeIdState(scopeId);
    if (canSwitchBranch) {
      localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, scopeId);
      if (scopeId !== ALL_BRANCHES_SCOPE_ID) {
        setOperatingScope(scopeId);
      }
    }
  }, [canSwitchBranch, setOperatingScope]);

  const isInventoryConsolidated = isConsolidatedBranchScope(canSwitchBranch, inventoryScopeId);

  const inventoryBranch = useMemo(
    () => resolveBranchFromScope(allBranches.length > 0 ? allBranches : branches, inventoryScopeId)
      || resolveBranchFromScope(branches, inventoryScopeId)
      || global.currentBranch,
    [allBranches, branches, inventoryScopeId, global.currentBranch],
  );

  const inventoryListBranchId = isInventoryConsolidated
    ? undefined
    : (inventoryScopeId || global.apiBranchId || userBranch?.id);

  return {
    ...global,
    branches: allBranches.length > 0 ? allBranches : branches,
    inventoryScopeId,
    setInventoryScope,
    isInventoryConsolidated,
    inventoryBranch,
    inventoryListBranchId,
  };
}
