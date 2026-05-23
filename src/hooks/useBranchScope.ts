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
    () => resolveUserBranch(branches, user?.branchId),
    [user?.branchId, branches],
  );

  const canSwitchBranch = canUserSwitchBranch(user, userBranch);

  const operatingBranch = useMemo(
    () => resolveOperatingBranch(canSwitchBranch, scopeId, branches, userBranch, user),
    [canSwitchBranch, scopeId, branches, userBranch, user],
  );

  const isHeadOffice = isHeadOfficeScope(canSwitchBranch, scopeId);
  const isConsolidatedView = isConsolidatedBranchScope(canSwitchBranch, scopeId);
  const apiBranchId = effectiveApiBranchId(canSwitchBranch, scopeId, user);

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
