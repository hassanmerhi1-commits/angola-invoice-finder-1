import { useCallback, useEffect, useMemo, useState } from 'react';
import { Branch } from '@/types/erp';
import {
  ALL_BRANCHES_SCOPE_ID,
  isConsolidatedBranchScope,
  resolveBranchFromScope,
} from '@/lib/branchAccess';
import { useBranchScope } from '@/hooks/useBranchScope';

const INVENTORY_SCOPE_STORAGE_KEY = 'kwanza_inventory_scope_id';

function defaultPhysicalBranchId(branches: Branch[]): string {
  const main = branches.find((b) => b.isMain) || branches[0];
  return String(main?.id || '');
}

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
  if (saved && saved !== ALL_BRANCHES_SCOPE_ID && branches.some((b) => String(b.id) === saved)) {
    return saved;
  }

  return defaultPhysicalBranchId(branches);
}

/**
 * Inventory branch scope — follows global top-nav branch.
 * Consolidated "all branches" is not offered in the UI.
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

    const g = String(globalScopeId || '').trim();
    if (g && g !== ALL_BRANCHES_SCOPE_ID) {
      setInventoryScopeIdState((prev) => {
        if (prev === g) return prev;
        localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, g);
        return g;
      });
      return;
    }

    setInventoryScopeIdState((prev) => {
      if (prev && prev !== ALL_BRANCHES_SCOPE_ID && branches.some((b) => b.id === prev)) return prev;
      const next = resolveStoredInventoryScopeId(branches, true, globalScopeId);
      localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, next);
      return next;
    });
  }, [branches, canSwitchBranch, globalScopeId, global.currentBranch?.id, global.apiBranchId, userBranch?.id]);

  const setInventoryScope = useCallback((scopeId: string) => {
    const next = scopeId === ALL_BRANCHES_SCOPE_ID
      ? defaultPhysicalBranchId(allBranches.length > 0 ? allBranches : branches)
      : scopeId;
    setInventoryScopeIdState(next);
    if (canSwitchBranch) {
      localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, next);
      setOperatingScope(next);
    }
  }, [canSwitchBranch, setOperatingScope, allBranches, branches]);

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
