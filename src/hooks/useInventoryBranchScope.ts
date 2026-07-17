import { useCallback, useEffect, useMemo, useState } from 'react';
import { Branch } from '@/types/erp';
import {
  ALL_BRANCHES_SCOPE_ID,
  isConsolidatedBranchScope,
  resolveBranchFromScope,
} from '@/lib/branchAccess';
import { useBranchScope } from '@/hooks/useBranchScope';

const INVENTORY_SCOPE_STORAGE_KEY = 'kwanza_inventory_scope_id';

function resolveStoredInventoryScopeId(
  branches: Branch[],
  canSwitch: boolean,
  globalScopeId: string,
): string {
  if (!canSwitch || branches.length === 0) {
    return String(branches[0]?.id || '');
  }

  const global = String(globalScopeId || '').trim();
  if (global && global !== ALL_BRANCHES_SCOPE_ID && branches.some((b) => String(b.id) === global)) {
    return global;
  }

  const saved = String(localStorage.getItem(INVENTORY_SCOPE_STORAGE_KEY) || '').trim();
  if (saved === ALL_BRANCHES_SCOPE_ID) return ALL_BRANCHES_SCOPE_ID;
  if (saved && branches.some((b) => String(b.id) === saved)) return saved;

  return ALL_BRANCHES_SCOPE_ID;
}

/**
 * Inventory branch scope — follows global top-nav branch by default.
 * Inventory page may still pick "All branches" locally; top-nav change overrides that.
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
    return resolveStoredInventoryScopeId(branches, canSwitchBranch, globalScopeId);
  });

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

    const global = String(globalScopeId || '').trim();
    if (global && global !== ALL_BRANCHES_SCOPE_ID) {
      setInventoryScopeIdState((prev) => {
        if (prev === global) return prev;
        localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, global);
        return global;
      });
      return;
    }

    setInventoryScopeIdState((prev) => {
      if (prev && branches.some((b) => b.id === prev)) return prev;
      const next = resolveStoredInventoryScopeId(branches, true, globalScopeId);
      localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, next);
      return next;
    });
  }, [branches, canSwitchBranch, globalScopeId, global.currentBranch?.id, global.apiBranchId, userBranch?.id]);

  const setInventoryScope = useCallback((scopeId: string) => {
    setInventoryScopeIdState(scopeId);
    if (canSwitchBranch) {
      localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, scopeId);
      if (scopeId !== ALL_BRANCHES_SCOPE_ID) {
        setOperatingScope(scopeId);
      }
    }
  }, [canSwitchBranch, setOperatingScope]);

  const scopeBranches = allBranches.length > 0 ? allBranches : branches;
  const isInventoryConsolidated = isConsolidatedBranchScope(
    canSwitchBranch,
    inventoryScopeId,
    scopeBranches,
  );

  const inventoryBranch = useMemo(
    () => resolveBranchFromScope(scopeBranches, inventoryScopeId)
      || resolveBranchFromScope(branches, inventoryScopeId)
      || global.currentBranch,
    [scopeBranches, branches, inventoryScopeId, global.currentBranch],
  );

  const inventoryListBranchId = isInventoryConsolidated
    ? undefined
    : (inventoryScopeId || global.apiBranchId || userBranch?.id);

  return {
    ...global,
    branches: scopeBranches,
    inventoryScopeId,
    setInventoryScope,
    isInventoryConsolidated,
    inventoryBranch,
    inventoryListBranchId,
  };
}
