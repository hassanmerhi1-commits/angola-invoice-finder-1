import { useCallback, useEffect, useMemo, useState } from 'react';
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

  return ALL_BRANCHES_SCOPE_ID;
}

/**
 * Inventory-only branch scope (includes "All branches" totals).
 * Global top-nav scope stays a single physical branch.
 */
export function useInventoryBranchScope() {
  const global = useBranchScope();
  const { branches, canSwitchBranch, userBranch } = global;

  const [inventoryScopeId, setInventoryScopeIdState] = useState<string>(() =>
    resolveStoredInventoryScopeId(branches, canSwitchBranch),
  );

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
      if (prev === ALL_BRANCHES_SCOPE_ID) return prev;
      if (prev && branches.some((b) => b.id === prev)) return prev;
      return resolveStoredInventoryScopeId(branches, true);
    });
  }, [branches, canSwitchBranch, global.currentBranch?.id, global.apiBranchId, userBranch?.id]);

  const setInventoryScope = useCallback((scopeId: string) => {
    setInventoryScopeIdState(scopeId);
    if (canSwitchBranch) {
      localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, scopeId);
    }
  }, [canSwitchBranch]);

  const isInventoryConsolidated = isConsolidatedBranchScope(canSwitchBranch, inventoryScopeId);

  const inventoryBranch = useMemo(
    () => resolveBranchFromScope(branches, inventoryScopeId) || global.currentBranch,
    [branches, inventoryScopeId, global.currentBranch],
  );

  const inventoryListBranchId = isInventoryConsolidated
    ? undefined
    : (inventoryScopeId || global.apiBranchId || userBranch?.id);

  return {
    ...global,
    inventoryScopeId,
    setInventoryScope,
    isInventoryConsolidated,
    inventoryBranch,
    inventoryListBranchId,
  };
}
