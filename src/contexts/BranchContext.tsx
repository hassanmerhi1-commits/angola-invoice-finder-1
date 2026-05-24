import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Branch } from '@/types/erp';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import * as storage from '@/lib/storage';
import {
  ALL_BRANCHES_SCOPE_ID,
  applyUserBranchLockOnLogin,
  canUserSwitchBranch,
  mapBranchRow,
  persistBranchScope,
  resolveBranchFromScope,
  resolveStoredBranchScopeId,
  resolveEffectiveUserBranch,
} from '@/lib/branchAccess';

interface BranchContextType {
  branches: Branch[];
  currentBranch: Branch | null;
  scopeId: string;
  setCurrentBranch: (branch: Branch) => void;
  setOperatingScope: (scopeId: string) => void;
  refreshBranches: () => Promise<void>;
  isLoading: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

function readStoredUser(): { branchId?: string; role?: string } | null {
  try {
    const raw = localStorage.getItem('kwanzaerp_current_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistCurrentBranch(scopeId: string, branch: Branch): void {
  persistBranchScope(scopeId, branch);
  storage.setCurrentBranch(branch);
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranchState] = useState<Branch | null>(null);
  const [scopeId, setScopeIdState] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  const applyBranchList = useCallback((mapped: Branch[]) => {
    setBranches(mapped);
    localStorage.setItem('kwanzaerp_branches', JSON.stringify(mapped));

    const storedUser = readStoredUser();
    const assigned = resolveEffectiveUserBranch(mapped, storedUser);
    if (assigned && !canUserSwitchBranch(storedUser, assigned)) {
      persistCurrentBranch(assigned.id, assigned);
      setScopeIdState(assigned.id);
      setCurrentBranchState(assigned);
      applyUserBranchLockOnLogin(storedUser);
      return;
    }

    setScopeIdState((prevScope) => {
      const userBranch = resolveEffectiveUserBranch(mapped, storedUser);
      const canSwitch = canUserSwitchBranch(storedUser, userBranch);
      const nextScope =
        prevScope === ALL_BRANCHES_SCOPE_ID
          ? resolveStoredBranchScopeId(mapped, canSwitch)
          : prevScope && mapped.some((b) => b.id === prevScope)
            ? prevScope
            : resolveStoredBranchScopeId(mapped, canSwitch);
      const nextBranch = resolveBranchFromScope(mapped, nextScope);
      if (nextBranch) persistCurrentBranch(nextScope, nextBranch);
      setCurrentBranchState(nextBranch);
      return nextScope;
    });
  }, []);

  const loadBranches = useCallback(async () => {
    const applyCachedBranches = (): boolean => {
      try {
        const raw = localStorage.getItem('kwanzaerp_branches');
        const data: Branch[] = raw ? JSON.parse(raw) : [];
        if (data.length > 0) {
          applyBranchList(data.map((row) => mapBranchRow(row as unknown as Record<string, unknown>)));
          return true;
        }
      } catch {
        /* ignore */
      }
      return false;
    };

    try {
      const response = await api.branches.list();
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        applyBranchList(response.data.map((row) => mapBranchRow(row as Record<string, unknown>)));
      } else {
        throw new Error('No branches from API');
      }
    } catch {
      if (applyCachedBranches()) return;

      if (!isDemoMode()) {
        setBranches([]);
        setCurrentBranchState(null);
        return;
      }
    } finally {
      setIsLoading(false);
    }
  }, [applyBranchList]);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  useEffect(() => {
    const onLockChanged = () => {
      if (branches.length === 0) return;
      const storedUser = readStoredUser();
      const assigned = resolveEffectiveUserBranch(branches, storedUser);
      if (assigned && !canUserSwitchBranch(storedUser, assigned)) {
        persistCurrentBranch(assigned.id, assigned);
        setScopeIdState(assigned.id);
        setCurrentBranchState(assigned);
      }
    };
    window.addEventListener('nexor:branch-lock-changed', onLockChanged);
    return () => window.removeEventListener('nexor:branch-lock-changed', onLockChanged);
  }, [branches]);

  const setOperatingScope = useCallback((nextScopeId: string) => {
    const storedUser = readStoredUser();
    const allBranches: Branch[] = JSON.parse(localStorage.getItem('kwanzaerp_branches') || '[]');
    const list = allBranches.length ? allBranches : branches;
    const assigned = resolveEffectiveUserBranch(list, storedUser);

    if (assigned && !canUserSwitchBranch(storedUser, assigned)) {
      if (String(nextScopeId) !== String(assigned.id)) return;
    }

    const branch = resolveBranchFromScope(list.length ? list : branches, nextScopeId);
    if (!branch) return;

    persistCurrentBranch(nextScopeId, branch);
    setScopeIdState(nextScopeId);
    setCurrentBranchState(branch);
  }, [branches]);

  const setCurrentBranch = useCallback((branch: Branch) => {
    setOperatingScope(branch.id);
  }, [setOperatingScope]);

  const refreshBranches = useCallback(async () => {
    await loadBranches();
  }, [loadBranches]);

  return (
    <BranchContext.Provider value={{
      branches,
      currentBranch,
      scopeId,
      setCurrentBranch,
      setOperatingScope,
      refreshBranches,
      isLoading,
    }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranchContext() {
  const context = useContext(BranchContext);
  if (context === undefined) {
    throw new Error('useBranchContext must be used within a BranchProvider');
  }
  return context;
}
