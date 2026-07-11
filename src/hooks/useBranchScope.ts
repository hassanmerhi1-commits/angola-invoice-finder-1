import { useCallback, useMemo } from 'react';
import { Branch } from '@/types/erp';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/hooks/useERP';
import {
  ALL_BRANCHES_SCOPE_ID,
  branchesVisibleToUser,
  canUserSwitchBranch,
  effectiveApiBranchId,
  isConsolidatedBranchScope,
  isHeadOfficeScope,
  resolveOperatingBranch,
  resolveEffectiveUserBranch,
  resolveUserBranch,
} from '@/lib/branchAccess';

/**
 * Branch scope for list/read APIs.
 * Admin/manager at sede: may switch filials and load all-branch data.
 * All other users: locked to their assigned branch only.
 */
export function useBranchScope() {
  const { currentBranch, branches, scopeId, setCurrentBranch, setOperatingScope } = useBranchContext();
  const { user } = useAuth();

  const userBranch = useMemo(
    () => resolveEffectiveUserBranch(branches, user),
    [user, branches],
  );

  const canSwitchBranch = canUserSwitchBranch(user, userBranch);

  const operatingBranch = useMemo(
    () => resolveOperatingBranch(canSwitchBranch, scopeId, branches, userBranch, user),
    [canSwitchBranch, scopeId, branches, userBranch, user],
  );

  const isHeadOffice = isHeadOfficeScope(canSwitchBranch, scopeId);
  const isConsolidatedView = isConsolidatedBranchScope(canSwitchBranch, scopeId);
  const rawApiBranchId = effectiveApiBranchId(canSwitchBranch, scopeId, user);
  const apiBranchId = useMemo(() => {
    if (!rawApiBranchId) return undefined;
    return resolveUserBranch(branches, rawApiBranchId)?.id || rawApiBranchId;
  }, [rawApiBranchId, branches]);

  const visibleBranches = useMemo(
    () => branchesVisibleToUser(branches, canSwitchBranch, userBranch, operatingBranch),
    [branches, canSwitchBranch, userBranch, operatingBranch],
  );

  const setOperatingBranch = useCallback(
    (branch: Branch) => {
      if (!canSwitchBranch) return;
      setCurrentBranch(branch);
    },
    [canSwitchBranch, setCurrentBranch],
  );

  return {
    currentBranch: operatingBranch,
    branches: visibleBranches,
    allBranches: branches,
    userBranch,
    scopeId,
    isHeadOffice,
    isConsolidatedView,
    canSwitchBranch,
    setOperatingBranch,
    setOperatingScope,
    apiBranchId,
    listBranchId: apiBranchId,
    canPickBranch: canSwitchBranch,
    allBranchesScopeId: ALL_BRANCHES_SCOPE_ID,
  };
}
