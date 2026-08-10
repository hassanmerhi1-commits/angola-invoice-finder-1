import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Branch } from '@/types/erp';
import {
  ALL_BRANCHES_SCOPE_ID,
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
  if (saved === ALL_BRANCHES_SCOPE_ID) return saved;
  if (saved && branches.some((b) => String(b.id) === saved)) {
    return saved;
  }

  return defaultPhysicalBranchId(branches);
}

/**
 * Inventory branch scope — follows the global top-nav branch, but with its own explicit
 * "All branches (total stock)" choice: unlike other pages (expenses, payments, etc.),
 * where picking the Sede/HQ branch is used as a stand-in for "consolidated", Inventory
 * must be able to show the Sede/HQ branch's *own* stock like any other branch — it has
 * its own physical warehouse and its own products. Only the literal "All branches"
 * option (a distinct row in the picker) triggers the consolidated/company-wide grid.
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

  // Only re-sync inventoryScopeId to the global top-nav branch when that global scope
  // has actually changed (a deliberate top-nav switch) — not on every unrelated
  // re-render (branches list refresh, etc). Otherwise an explicit local "All branches"
  // pick made from the Inventory toolbar got silently reverted moments later by this
  // effect re-running for an unrelated reason, which looked like "sometimes shows
  // nothing / sometimes shows other branches" for whichever branch the top-nav still
  // pointed at.
  const lastSyncedGlobalScopeRef = useRef<string>(globalScopeId);

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
    const globalChanged = g !== lastSyncedGlobalScopeRef.current;
    lastSyncedGlobalScopeRef.current = g;

    if (g && g !== ALL_BRANCHES_SCOPE_ID && globalChanged) {
      setInventoryScopeIdState((prev) => {
        if (prev === g) return prev;
        localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, g);
        return g;
      });
      return;
    }

    setInventoryScopeIdState((prev) => {
      if (prev === ALL_BRANCHES_SCOPE_ID) return prev;
      if (prev && branches.some((b) => b.id === prev)) return prev;
      const next = resolveStoredInventoryScopeId(branches, true, globalScopeId);
      localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, next);
      return next;
    });
  }, [branches, canSwitchBranch, globalScopeId, global.currentBranch?.id, global.apiBranchId, userBranch?.id]);

  /**
   * "All branches" is an Inventory-local choice — it is NOT pushed to the global
   * top-nav scope (which never offers it), so other pages keep operating against a
   * real, specific branch while Inventory shows the company-wide total.
   */
  const setInventoryScope = useCallback((scopeId: string) => {
    setInventoryScopeIdState(scopeId);
    if (!canSwitchBranch) return;
    localStorage.setItem(INVENTORY_SCOPE_STORAGE_KEY, scopeId);
    if (scopeId !== ALL_BRANCHES_SCOPE_ID) {
      setOperatingScope(scopeId);
    }
  }, [canSwitchBranch, setOperatingScope]);

  const scopeBranches = allBranches.length > 0 ? allBranches : branches;
  // Deliberately narrower than the global isConsolidatedBranchScope: picking the
  // Sede/HQ branch here must show *that branch's own* inventory, not the company
  // total — only the explicit "All branches" row does that for this page.
  const isInventoryConsolidated = canSwitchBranch && inventoryScopeId === ALL_BRANCHES_SCOPE_ID;

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
