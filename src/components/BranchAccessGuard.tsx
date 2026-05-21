import { useEffect } from 'react';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/hooks/useERP';
import { canUserSwitchBranch, resolveUserBranch } from '@/lib/branchAccess';

/** Keeps filial users on their assigned branch (ignores stale localStorage / manual switches). */
export function BranchAccessGuard() {
  const { branches, currentBranch, setCurrentBranch } = useBranchContext();
  const { user } = useAuth();

  useEffect(() => {
    if (!user || branches.length === 0) return;
    if (canUserSwitchBranch(user, resolveUserBranch(branches, user.branchId))) return;

    const locked =
      resolveUserBranch(branches, user.branchId) ??
      (String(user.branchId ?? '').trim() && currentBranch ? currentBranch : null);

    if (locked && currentBranch?.id !== locked.id) {
      setCurrentBranch(locked);
    }
  }, [user, user?.branchId, branches, currentBranch?.id, setCurrentBranch]);

  return null;
}
