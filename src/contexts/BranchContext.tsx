import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Branch } from '@/types/erp';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';

interface BranchContextType {
  branches: Branch[];
  currentBranch: Branch | null;
  setCurrentBranch: (branch: Branch) => void;
  refreshBranches: () => Promise<void>;
  isLoading: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

// Map API snake_case to frontend camelCase
function mapBranch(b: any): Branch {
  return {
    id: b.id,
    name: b.name,
    code: b.code || b.branch_code || '',
    address: b.address || '',
    phone: b.phone || '',
    isMain: b.isMain ?? b.is_main ?? false,
    priceLevel: b.priceLevel ?? b.price_level ?? 1,
    createdAt: b.createdAt || b.created_at || '',
  };
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranchState] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadBranches = useCallback(async () => {
    try {
      const response = await api.branches.list();
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        const mapped = response.data.map(mapBranch);
        setBranches(mapped);
        localStorage.setItem('kwanzaerp_branches', JSON.stringify(mapped));

        const savedBranchId = localStorage.getItem('kwanza_current_branch_id');
        const saved = savedBranchId
          ? mapped.find((b) => String(b.id) === String(savedBranchId))
          : null;
        const mainBranch = mapped.find((b) => b.isMain);
        const fallback = saved || mainBranch || mapped[0];
        if (fallback) {
          localStorage.setItem('kwanza_current_branch_id', String(fallback.id));
          setCurrentBranchState(fallback);
        }
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
        setBranches(data);
        const savedBranchId = localStorage.getItem('kwanza_current_branch_id');
        const saved = savedBranchId
          ? data.find((b) => String(b.id) === String(savedBranchId))
          : null;
        const mainBranch = data.find((b) => b.isMain);
        const fallback = saved || mainBranch || data[0];
        if (fallback) {
          localStorage.setItem('kwanza_current_branch_id', String(fallback.id));
          setCurrentBranchState(fallback);
        }
      } catch { /* ignore */ }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  const setCurrentBranch = useCallback((branch: Branch) => {
    localStorage.setItem('kwanza_current_branch_id', branch.id);
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
