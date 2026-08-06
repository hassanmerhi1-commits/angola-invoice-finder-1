import { generateId } from '@/lib/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api/client';
import { getCachedList, isCachedListFresh, markCachedListStale, setCachedList } from '@/lib/listCache';
import { Account, AccountFormData, TrialBalanceRow, BalanceSheetAccountRow, AccountType } from '@/types/accounting';
import { ensureBranchCaixaAccounts } from '@/lib/chartOfAccountsEngine';
import { PGC_ACCOUNTS } from '@/lib/pgcChartOfAccounts';
import { useTranslation } from '@/i18n';
import { useTableRefreshListener } from '@/hooks/useRealtimeSyncBridge';

const LOCAL_COA_STORAGE_KEY = 'kwanzaerp_chart_of_accounts_v3';
const LEGACY_COA_STORAGE_KEYS = ['kwanzaerp_chart_of_accounts', 'kwanzaerp_chart_of_accounts_v2'];

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
    for (const key of LEGACY_COA_STORAGE_KEYS) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
    const raw = localStorage.getItem(LOCAL_COA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Account[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Ignore caches that look like the zeroed PGC seed (no real balances).
        const hasAnyBalance = parsed.some((a) => Math.abs(Number(a.current_balance) || 0) > 0.0001);
        if (hasAnyBalance) {
          return sortAccountsByCode(parsed.filter(a => a.is_active !== false));
        }
      }
    }
  } catch (error) {
    console.error('[useChartOfAccounts] Failed to read local chart of accounts:', error);
  }

  // Seed structure only for empty DBs — never persist as if it were live balances.
  return sortAccountsByCode(createSeedChartOfAccounts(t));
};

const saveLocalAccounts = (accounts: Account[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCAL_COA_STORAGE_KEY, JSON.stringify(sortAccountsByCode(accounts)));
};

const createLocalId = () =>
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? generateId()
    : `local-coa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Structure can cache briefly; balances must not stick at stale zeros for minutes. */
const COA_CACHE_FRESH_MS = 45_000;

function readInitialAccounts(): Account[] {
  const mem = getCachedList<Account[]>('chartOfAccounts');
  if (mem && mem.length > 0) {
    const hasBal = mem.some((a) => Math.abs(Number(a.current_balance) || 0) > 0.0001);
    if (hasBal) return mem;
  }
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_COA_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Account[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const hasAnyBalance = parsed.some((a) => Math.abs(Number(a.current_balance) || 0) > 0.0001);
        if (!hasAnyBalance) return [];
        const sorted = sortAccountsByCode(parsed.filter((a) => a.is_active !== false));
        setCachedList('chartOfAccounts', sorted);
        return sorted;
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function useChartOfAccounts(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled !== false;
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>(() => readInitialAccounts());
  const [isLoading, setIsLoading] = useState(() => enabled && readInitialAccounts().length === 0);
  const [error, setError] = useState<string | null>(null);
  const branchCaixaSeeded = useRef(false);
  const hasRowsRef = useRef(false);
  if (accounts.length > 0) hasRowsRef.current = true;

  const applyAccounts = useCallback((remoteAccounts: Account[]) => {
    const sorted = sortAccountsByCode(remoteAccounts);
    setAccounts(sorted);
    setCachedList('chartOfAccounts', sorted);
    hasRowsRef.current = sorted.length > 0;
    saveLocalAccounts(sorted);
  }, []);

  const fetchAccounts = useCallback(async (opts?: { force?: boolean; liveBalances?: boolean }) => {
    if (
      !opts?.force
      && !opts?.liveBalances
      && isCachedListFresh('chartOfAccounts', COA_CACHE_FRESH_MS)
      && hasRowsRef.current
    ) {
      setIsLoading(false);
      return;
    }
    try {
      // Never blank the tree when we already have local/cache rows.
      if (!hasRowsRef.current) setIsLoading(true);
      // Stored balances by default (fast). liveBalances joins journals for ledger parity.
      const response = await api.chartOfAccounts.list(
        opts?.liveBalances ? { liveBalances: true } : undefined,
      );
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
      applyAccounts(remoteAccounts);
      setError(null);
    } catch (err: any) {
      // Keep last good server data — don't flash zeroed seed over live balances.
      if (hasRowsRef.current) {
        setError(null);
        console.warn('[useChartOfAccounts] Refresh failed; keeping cached accounts:', err?.message || err);
      } else {
        const local = loadLocalAccounts(t);
        if (local.length > 0) {
          applyAccounts(local);
          setError(null);
        } else {
          setError(err.message || 'Failed to fetch accounts');
          console.error('[useChartOfAccounts] Error:', err);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [t, applyAccounts]);

  const coaRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCoaRefresh = useCallback((delayMs = 1200) => {
    if (!enabled) return;
    markCachedListStale('chartOfAccounts');
    if (coaRefreshTimer.current) clearTimeout(coaRefreshTimer.current);
    coaRefreshTimer.current = setTimeout(() => {
      coaRefreshTimer.current = null;
      void fetchAccounts({ force: true });
    }, delayMs);
  }, [enabled, fetchAccounts]);

  useEffect(() => () => {
    if (coaRefreshTimer.current) clearTimeout(coaRefreshTimer.current);
  }, []);

  useTableRefreshListener(['chart_of_accounts'], () => {
    // Coalesce Adjust In / purchase / sale CoA broadcasts into one refetch.
    scheduleCoaRefresh(500);
  });

  // After posts, balances recompute in background on the server. Stale-mark + delayed
  // refresh — never block Journals/Invoices with an immediate full CoA download.
  useTableRefreshListener(['journal_entries', 'payments'], () => {
    scheduleCoaRefresh(1500);
  });

  // Auto-seed branch caixa accounts once after first load — only refetch if something was created.
  useEffect(() => {
    if (!enabled || isLoading || branchCaixaSeeded.current || accounts.length === 0) return;
    branchCaixaSeeded.current = true;

    const run = (branches: { id: string; name: string }[]) => {
      if (branches.length === 0) return;
      void ensureBranchCaixaAccounts(branches, accounts).then((created) => {
        if (!created) return;
        scheduleCoaRefresh(400);
      });
    };

    api.branches.list().then(response => {
      run((response.data || []).map((b: any) => ({ id: b.id, name: b.name })));
    }).catch(() => {
      try {
        const raw = localStorage.getItem('kwanzaerp_branches');
        const branches = raw ? JSON.parse(raw) : [];
        run(branches.map((b: any) => ({ id: b.id, name: b.name })));
      } catch { /* ignore */ }
    });
  }, [enabled, isLoading, accounts, scheduleCoaRefresh]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    void fetchAccounts();
  }, [enabled, fetchAccounts]);

  const mergeAccountIntoList = useCallback((account: Account) => {
    setAccounts((prev) => {
      const idx = prev.findIndex((a) => a.id === account.id || a.code === account.code);
      const next = idx >= 0
        ? prev.map((a, i) => (i === idx ? { ...a, ...account } : a))
        : sortAccountsByCode([...prev, account]);
      const sorted = sortAccountsByCode(next);
      setCachedList('chartOfAccounts', sorted);
      return sorted;
    });
  }, []);

  const createAccount = async (data: AccountFormData): Promise<Account> => {
    try {
      const response = await api.chartOfAccounts.create(data);
      if (response.error) throw new Error(response.error);
      const created = response.data as Account;
      markCachedListStale('chartOfAccounts');
      if (created?.id) mergeAccountIntoList(created);
      else scheduleCoaRefresh(300);
      return created;
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
      const updated = response.data as Account;
      markCachedListStale('chartOfAccounts');
      if (updated?.id) mergeAccountIntoList(updated);
      else scheduleCoaRefresh(300);
      return updated;
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
      setAccounts((prev) => {
        const next = prev.filter((a) => a.id !== id);
        setCachedList('chartOfAccounts', next);
        return next;
      });
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
