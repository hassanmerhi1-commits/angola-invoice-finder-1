import { useCallback, useMemo } from 'react';
import { Branch } from '@/types/erp';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/hooks/useERP';
import {
  branchesVisibleToUser,
  canUserSwitchBranch,
  effectiveApiBranchId,
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
  const { currentBranch, branches, setCurrentBranch } = useBranchContext();
  const { user } = useAuth();

  const userBranch = useMemo(
    () => resolveUserBranch(branches, user?.branchId),
    [user?.branchId, branches],
  );

  const canSwitchBranch = canUserSwitchBranch(user, userBranch);

  const operatingBranch = useMemo(
    () => resolveOperatingBranch(canSwitchBranch, currentBranch, userBranch, user),
    [canSwitchBranch, currentBranch, userBranch, user],
  );

  const isHeadOffice = isHeadOfficeScope(canSwitchBranch, operatingBranch);
  const apiBranchId = effectiveApiBranchId(canSwitchBranch, operatingBranch, user);

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
    isHeadOffice,
    canSwitchBranch,
    setOperatingBranch,
    apiBranchId,
    listBranchId: apiBranchId,
    canPickBranch: canSwitchBranch && isHeadOffice,
  };
}
