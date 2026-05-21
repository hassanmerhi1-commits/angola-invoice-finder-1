import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Branch } from '@/types/erp';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import * as storage from '@/lib/storage';
import {
  applyUserBranchLockOnLogin,
  canUserSwitchBranch,
  mapBranchRow,
  resolveUserBranch,
} from '@/lib/branchAccess';

interface BranchContextType {
  branches: Branch[];
  currentBranch: Branch | null;
  setCurrentBranch: (branch: Branch) => void;
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

function persistCurrentBranch(branch: Branch): void {
  localStorage.setItem('kwanza_current_branch_id', String(branch.id));
  storage.setCurrentBranch(branch);
}

function pickInitialBranch(mapped: Branch[]): Branch | null {
  if (mapped.length === 0) return null;

  const storedUser = readStoredUser();
  const assigned = resolveUserBranch(mapped, storedUser?.branchId);

  if (assigned && !canUserSwitchBranch(storedUser, assigned)) {
    return assigned;
  }

  const savedBranchId = localStorage.getItem('kwanza_current_branch_id');
  const saved = savedBranchId
    ? mapped.find((b) => String(b.id) === String(savedBranchId))
    : null;

  return saved || mapped.find((b) => b.isMain) || mapped[0];
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranchState] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applyBranchList = useCallback((mapped: Branch[]) => {
    setBranches(mapped);
    localStorage.setItem('kwanzaerp_branches', JSON.stringify(mapped));

    const storedUser = readStoredUser();
    const assigned = resolveUserBranch(mapped, storedUser?.branchId);
    if (assigned && !canUserSwitchBranch(storedUser, assigned)) {
      persistCurrentBranch(assigned);
      setCurrentBranchState(assigned);
      applyUserBranchLockOnLogin(storedUser);
      return;
    }

    setCurrentBranchState((prev) => {
      const savedBranchId = localStorage.getItem('kwanza_current_branch_id');
      const saved = savedBranchId
        ? mapped.find((b) => String(b.id) === String(savedBranchId))
        : null;
      const next = saved || (prev ? mapped.find((b) => b.id === prev.id) : null) || pickInitialBranch(mapped);
      if (next) persistCurrentBranch(next);
      return next;
    });
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      const response = await api.branches.list();
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        applyBranchList(response.data.map((row) => mapBranchRow(row as Record<string, unknown>)));
      } else {
        throw new Error('No branches from API');
      }
    } catch {
      if (!isDemoMode()) {
        setBranches([]);
        setCurrentBranchState(null);
        return;
      }

      try {
        const raw = localStorage.getItem('kwanzaerp_branches');
        const data: Branch[] = raw ? JSON.parse(raw) : [];
        if (data.length > 0) {
          applyBranchList(data.map((row) => mapBranchRow(row as unknown as Record<string, unknown>)));
        }
      } catch {
        /* ignore */
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
      const assigned = resolveUserBranch(branches, storedUser?.branchId);
      if (assigned && !canUserSwitchBranch(storedUser, assigned)) {
        persistCurrentBranch(assigned);
        setCurrentBranchState(assigned);
      }
    };
    window.addEventListener('nexor:branch-lock-changed', onLockChanged);
    return () => window.removeEventListener('nexor:branch-lock-changed', onLockChanged);
  }, [branches]);

  const setCurrentBranch = useCallback((branch: Branch) => {
    const storedUser = readStoredUser();
    const allBranches: Branch[] = JSON.parse(localStorage.getItem('kwanzaerp_branches') || '[]');
    const assigned = resolveUserBranch(allBranches.length ? allBranches : [branch], storedUser?.branchId);

    if (assigned && !canUserSwitchBranch(storedUser, assigned)) {
      if (String(branch.id) !== String(assigned.id)) return;
    }

    persistCurrentBranch(branch);
    setCurrentBranchState(branch);
  }, []);

  const refreshBranches = useCallback(async () => {
    await loadBranches();
  }, [loadBranches]);

  return (
    <BranchContext.Provider value={{ branches, currentBranch, setCurrentBranch, refreshBranches, isLoading }}>
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
