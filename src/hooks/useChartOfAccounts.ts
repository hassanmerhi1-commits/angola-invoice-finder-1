import { generateId } from '@/lib/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api/client';
import { getCachedList, isCachedListFresh, markCachedListStale, setCachedList } from '@/lib/listCache';
import { Account, AccountFormData, TrialBalanceRow, BalanceSheetAccountRow, AccountType } from '@/types/accounting';
import { ensureBranchCaixaAccounts } from '@/lib/chartOfAccountsEngine';
import { PGC_ACCOUNTS } from '@/lib/pgcChartOfAccounts';
import { useTranslation } from '@/i18n';
import { useTableRefreshListener } from '@/hooks/useRealtimeSyncBridge';

const LOCAL_COA_STORAGE_KEY = 'kwanzaerp_chart_of_accounts';

const nowIso = () => new Date().toISOString();

const isOfflineError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /failed to fetch|network error|fetch failed|load failed/i.test(message);
};

const sortAccountsByCode = (items: Account[]) => [...items].sort((a, b) => a.code.localeCompare(b.code));

// Build the local fallback chart from the Angola PGC (novo com IVA) dataset.
// (The `t` argument is kept for signature compatibility; PGC names are canonical Portuguese.)
const createSeedChartOfAccounts = (_t?: any): Account[] => {
  const timestamp = nowIso();
  const idByCode = new Map<string, string>();

  const seeded = PGC_ACCOUNTS.map(row => {
    const id = `local-coa-${row.code}`;
    idByCode.set(row.code, id);
    return {
      id,
      code: row.code,
      name: row.name,
      description: null,
      account_type: row.account_type as AccountType,
      account_nature: row.account_nature,
      parent_id: null,
      parent_name: null,
      parent_code: row.parent_code || null,
      level: row.level,
      is_header: row.is_header,
      is_active: true,
      opening_balance: 0,
      current_balance: 0,
      branch_id: null,
      children_count: 0,
      created_at: timestamp,
      updated_at: timestamp,
    } as Account;
  });

  return seeded.map(account => {
    const parentId = account.parent_code ? idByCode.get(account.parent_code) ?? null : null;
    return {
      ...account,
      parent_id: parentId,
      children_count: seeded.filter(child => child.parent_code === account.code).length,
    };
  });
};

const loadLocalAccounts = (t: any): Account[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(LOCAL_COA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Account[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return sortAccountsByCode(parsed.filter(a => a.is_active !== false));
      }
    }
  } catch (error) {
    console.error('[useChartOfAccounts] Failed to read local chart of accounts:', error);
  }

  const seeded = createSeedChartOfAccounts(t);
  localStorage.setItem(LOCAL_COA_STORAGE_KEY, JSON.stringify(seeded));
  return sortAccountsByCode(seeded);
};

const saveLocalAccounts = (accounts: Account[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCAL_COA_STORAGE_KEY, JSON.stringify(sortAccountsByCode(accounts)));
};

const createLocalId = () =>
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? generateId()
    : `local-coa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function useChartOfAccounts() {
  const { t } = useTranslation();
  const cachedAccounts = getCachedList<Account[]>('chartOfAccounts');
  const [accounts, setAccounts] = useState<Account[]>(() => cachedAccounts ?? []);
  const [isLoading, setIsLoading] = useState(() => !(cachedAccounts && cachedAccounts.length));
  const [error, setError] = useState<string | null>(null);
  const branchCaixaSeeded = useRef(false);
  // Once we have rows to show, background refreshes shouldn't flash the spinner.
  const hasRowsRef = useRef((cachedAccounts?.length ?? 0) > 0);

  const fetchAccounts = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && isCachedListFresh('chartOfAccounts') && hasRowsRef.current) {
      setIsLoading(false);
      return;
    }
    try {
      if (!hasRowsRef.current) setIsLoading(true);
      const response = await api.chartOfAccounts.list();
      if (response.error) throw new Error(response.error);
      let remoteAccounts = sortAccountsByCode(response.data || []);
      if (remoteAccounts.length === 0) {
        // Only seed locally when the server genuinely has no chart yet.
        // Never replace a previously loaded live chart with zeroed PGC seed.
        if (!hasRowsRef.current) {
          const local = loadLocalAccounts(t);
          if (local.length > 0) remoteAccounts = local;
        } else {
          return;
        }
      } else {
        saveLocalAccounts(remoteAccounts);
      }
      setAccounts(remoteAccounts);
      setCachedList('chartOfAccounts', remoteAccounts);
      hasRowsRef.current = remoteAccounts.length > 0;
      setError(null);
    } catch (err: any) {
      // Keep last good server data — don't flash zeroed seed over live balances.
      if (hasRowsRef.current) {
        setError(null);
        console.warn('[useChartOfAccounts] Refresh failed; keeping cached accounts:', err?.message || err);
      } else {
        const local = loadLocalAccounts(t);
        if (local.length > 0) {
          setAccounts(local);
          setCachedList('chartOfAccounts', local);
          hasRowsRef.current = true;
          setError(null);
        } else {
          setError(err.message || 'Failed to fetch accounts');
          console.error('[useChartOfAccounts] Error:', err);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useTableRefreshListener(['chart_of_accounts', 'journal_entries', 'payments'], () => {
    markCachedListStale('chartOfAccounts');
    void fetchAccounts({ force: true });
  });

  // Auto-seed branch caixa accounts once after first load (skip second CoA fetch if still fresh).
  useEffect(() => {
    if (isLoading || branchCaixaSeeded.current || accounts.length === 0) return;
    branchCaixaSeeded.current = true;

    // Fetch branches from API instead of storage
    api.branches.list().then(response => {
      const branches = response.data || [];
      if (branches.length > 0) {
        ensureBranchCaixaAccounts(branches.map((b: any) => ({ id: b.id, name: b.name }))).then(() => {
          markCachedListStale('chartOfAccounts');
          void fetchAccounts({ force: true });
        });
      }
    }).catch(() => {
      // Fallback: read from localStorage
      try {
        const raw = localStorage.getItem('kwanzaerp_branches');
        const branches = raw ? JSON.parse(raw) : [];
        if (branches.length > 0) {
          ensureBranchCaixaAccounts(branches.map((b: any) => ({ id: b.id, name: b.name }))).then(() => {
            markCachedListStale('chartOfAccounts');
            void fetchAccounts({ force: true });
          });
        }
      } catch { /* ignore */ }
    });
  }, [isLoading, accounts.length, t, fetchAccounts]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const createAccount = async (data: AccountFormData): Promise<Account> => {
    try {
      const response = await api.chartOfAccounts.create(data);
      if (response.error) throw new Error(response.error);
      markCachedListStale('chartOfAccounts');
      await fetchAccounts({ force: true });
      return response.data;
    } catch (err) {
      if (!isOfflineError(err)) throw err;

      const localAccounts = loadLocalAccounts(t);
      if (localAccounts.some(account => account.code === data.code)) {
        throw new Error('Account code already exists');
      }

      const timestamp = nowIso();
      const createdAccount: Account = {
        id: createLocalId(),
        code: data.code,
        name: data.name,
        description: data.description || null,
        account_type: data.account_type,
        account_nature: data.account_nature,
        parent_id: data.parent_id || null,
        parent_name: null,
        parent_code: null,
        level: data.level ?? 1,
        is_header: data.is_header ?? false,
        is_active: true,
        opening_balance: Number(data.opening_balance) || 0,
        current_balance: Number(data.opening_balance) || 0,
        branch_id: data.branch_id || null,
        children_count: 0,
        created_at: timestamp,
        updated_at: timestamp,
      };

      const next = sortAccountsByCode([...localAccounts, createdAccount]);
      saveLocalAccounts(next);
      setAccounts(next);
      setError(null);
      return createdAccount;
    }
  };

  const updateAccount = async (id: string, data: Partial<AccountFormData>): Promise<Account> => {
    try {
      const response = await api.chartOfAccounts.update(id, data);
      if (response.error) throw new Error(response.error);
      markCachedListStale('chartOfAccounts');
      await fetchAccounts({ force: true });
      return response.data;
    } catch (err) {
      if (!isOfflineError(err)) throw err;

      const localAccounts = loadLocalAccounts(t);
      const index = localAccounts.findIndex(account => account.id === id);
      if (index < 0) throw new Error('Account not found');

      const existing = localAccounts[index];
      const updatedAccount: Account = {
        ...existing,
        ...data,
        opening_balance: data.opening_balance !== undefined ? Number(data.opening_balance) || 0 : existing.opening_balance,
        updated_at: nowIso(),
      };

      if (
        updatedAccount.code !== existing.code &&
        localAccounts.some(account => account.id !== id && account.code === updatedAccount.code)
      ) {
        throw new Error('Account code already exists');
      }

      const next = [...localAccounts];
      next[index] = updatedAccount;
      const sorted = sortAccountsByCode(next);
      saveLocalAccounts(sorted);
      setAccounts(sorted);
      setError(null);
      return updatedAccount;
    }
  };

  const deleteAccount = async (id: string): Promise<void> => {
    try {
      const response = await api.chartOfAccounts.delete(id);
      if (response.error) throw new Error(response.error);
      markCachedListStale('chartOfAccounts');
      await fetchAccounts({ force: true });
    } catch (err) {
      if (!isOfflineError(err)) throw err;

      const localAccounts = loadLocalAccounts(t);
      if (localAccounts.some(account => account.parent_id === id)) {
        throw new Error('Cannot delete account with child accounts');
      }

      const next = localAccounts.filter(account => account.id !== id);
      saveLocalAccounts(next);
      setAccounts(next);
      setError(null);
    }
  };

  const getAccountsByType = (type: AccountType): Account[] => {
    return accounts.filter(a => a.account_type === type);
  };

  const getChildAccounts = (parentId: string): Account[] => {
    return accounts.filter(a => a.parent_id === parentId);
  };

  const getParentAccounts = (): Account[] => {
    return accounts.filter(a => a.is_header);
  };

  const getRootAccounts = (): Account[] => {
    return accounts.filter(a => !a.parent_id);
  };

  const getAccountTree = (): (Account & { children: Account[] })[] => {
    const buildTree = (parentId: string | null): (Account & { children: Account[] })[] => {
      return accounts
        .filter(a => a.parent_id === parentId)
        .map(account => ({
          ...account,
          children: buildTree(account.id)
        }));
    };

    return buildTree(null);
  };

  return {
    accounts,
    isLoading,
    error,
    refetch: fetchAccounts,
    createAccount,
    updateAccount,
    deleteAccount,
    getAccountsByType,
    getChildAccounts,
    getParentAccounts,
    getRootAccounts,
    getAccountTree
  };
}

export function useBalanceSheet(asOf: string, previousAsOf?: string) {
  const [rows, setRows] = useState<BalanceSheetAccountRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalanceSheet = useCallback(async () => {
    if (!asOf) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      const response = await api.chartOfAccounts.getBalanceSheet(asOf, previousAsOf);
      if (response.error) throw new Error(response.error);
      setRows((response.data?.rows || []) as BalanceSheetAccountRow[]);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch balance sheet');
      setRows([]);
      console.error('[useBalanceSheet] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [asOf, previousAsOf]);

  useEffect(() => {
    fetchBalanceSheet();
  }, [fetchBalanceSheet]);

  return { rows, isLoading, error, refetch: fetchBalanceSheet };
}

export function useTrialBalance(startDate?: string, endDate?: string, branchId?: string) {
  const [data, setData] = useState<TrialBalanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrialBalance = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await api.chartOfAccounts.getTrialBalance(startDate, endDate, branchId);
      if (response.error) throw new Error(response.error);
      setData(response.data || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch trial balance');
      console.error('[useTrialBalance] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, branchId]);

  useEffect(() => {
    fetchTrialBalance();
  }, [fetchTrialBalance]);

  const totals = data.reduce((acc, row) => {
    if (!row.is_header) {
      acc.debits += Number(row.total_debits) || 0;
      acc.credits += Number(row.total_credits) || 0;
    }
    return acc;
  }, { debits: 0, credits: 0 });

  return {
    data,
    isLoading,
    error,
    refetch: fetchTrialBalance,
    totals
  };
}
