import { useEffect, useState } from 'react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { ALL_BRANCHES_SCOPE_ID } from '@/lib/branchAccess';

type UseSyncedBranchFilterOptions = {
  /** Sentinel in this screen meaning "all branches" (default `all`). */
  allValue?: string;
  /** Default for branch pickers when top nav has no branch yet. */
  defaultWhenPicker?: 'all' | 'current';
};

/**
 * Local branch filter that follows the global top-nav scope.
 * Locked users stay on their assigned branch.
 */
export function useSyncedBranchFilter(options: UseSyncedBranchFilterOptions = {}) {
  const { allValue = 'all', defaultWhenPicker = 'current' } = options;
  const {
    scopeId,
    currentBranch,
    canPickBranch,
    listBranchId,
    branches,
    allBranchesScopeId,
  } = useBranchScope();

  const lockedBranchId = listBranchId || currentBranch?.id || '';

  const [selectedBranch, setSelectedBranch] = useState<string>(() => {
    if (!canPickBranch) return lockedBranchId;
    if (defaultWhenPicker === 'all') return allValue;
    const global = String(scopeId || currentBranch?.id || '').trim();
    if (global && global !== ALL_BRANCHES_SCOPE_ID) return global;
    return allValue;
  });

  useEffect(() => {
    if (!canPickBranch) {
      if (lockedBranchId) setSelectedBranch(lockedBranchId);
      return;
    }
    const global = String(scopeId || '').trim();
    if (!global || global === ALL_BRANCHES_SCOPE_ID) {
      if (defaultWhenPicker === 'all') setSelectedBranch(allValue);
      return;
    }
    setSelectedBranch(global);
  }, [canPickBranch, lockedBranchId, scopeId, allValue, defaultWhenPicker]);

  const isAllBranches =
    selectedBranch === allValue
    || selectedBranch === allBranchesScopeId
    || selectedBranch === '';

  const apiBranchId = canPickBranch && isAllBranches
    ? undefined
    : (selectedBranch || lockedBranchId);

  return {
    selectedBranch,
    setSelectedBranch,
    canPickBranch,
    branches,
    currentBranch,
    allBranchesScopeId,
    apiBranchId,
    isAllBranches,
  };
}
