import { generateId } from '@/lib/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api/client';
import { Account, AccountFormData, TrialBalanceRow, AccountType } from '@/types/accounting';
import { ensureBranchCaixaAccounts } from '@/lib/chartOfAccountsEngine';

const LOCAL_COA_STORAGE_KEY = 'kwanzaerp_chart_of_accounts';

const nowIso = () => new Date().toISOString();

const isOfflineError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /failed to fetch|network error|fetch failed|load failed/i.test(message);
};

const sortAccountsByCode = (items: Account[]) => [...items].sort((a, b) => a.code.localeCompare(b.code));

const createSeedChartOfAccounts = (): Account[] => {
  const timestamp = nowIso();
  const seedRows: Array<{
    code: string;
    name: string;
    account_type: AccountType;
    account_nature: 'debit' | 'credit';
    level: number;
    is_header: boolean;
    parent_code?: string;
  }> = [
    { code: '1', name: 'Meios Fixos e Investimentos', account_type: 'asset', account_nature: 'debit', level: 1, is_header: true },
    { code: '2', name: 'Existências', account_type: 'asset', account_nature: 'debit', level: 1, is_header: true },
    { code: '2.1', name: 'Compra de Mercadorias', account_type: 'asset', account_nature: 'debit', level: 2, is_header: false, parent_code: '2' },
    { code: '2.2', name: 'Mercadorias', account_type: 'asset', account_nature: 'debit', level: 2, is_header: false, parent_code: '2' },
    { code: '3', name: 'Terceiros', account_type: 'asset', account_nature: 'debit', level: 1, is_header: true },
    { code: '3.1', name: 'Clientes', account_type: 'asset', account_nature: 'debit', level: 2, is_header: true, parent_code: '3' },
    { code: '3.2', name: 'Fornecedores', account_type: 'liability', account_nature: 'credit', level: 2, is_header: true, parent_code: '3' },
    { code: '3.3', name: 'IVA', account_type: 'liability', account_nature: 'credit', level: 2, is_header: true, parent_code: '3' },
    { code: '3.3.1', name: 'IVA Dedutível', account_type: 'liability', account_nature: 'debit', level: 3, is_header: false, parent_code: '3.3' },
    { code: '3.3.2', name: 'IVA Liquidado', account_type: 'liability', account_nature: 'credit', level: 3, is_header: false, parent_code: '3.3' },
    { code: '3.4', name: 'Pessoal', account_type: 'liability', account_nature: 'credit', level: 2, is_header: true, parent_code: '3' },
    { code: '4', name: 'Meios Monetários', account_type: 'asset', account_nature: 'debit', level: 1, is_header: true },
    { code: '4.1', name: 'Caixa', account_type: 'asset', account_nature: 'debit', level: 2, is_header: true, parent_code: '4' },
    { code: '4.1.1', name: 'Caixa Principal', account_type: 'asset', account_nature: 'debit', level: 3, is_header: false, parent_code: '4.1' },
    { code: '4.2', name: 'Depósitos à Ordem', account_type: 'asset', account_nature: 'debit', level: 2, is_header: true, parent_code: '4' },
    { code: '5', name: 'Capital Próprio', account_type: 'equity', account_nature: 'credit', level: 1, is_header: true },
    { code: '6', name: 'Gastos e Perdas', account_type: 'expense', account_nature: 'debit', level: 1, is_header: true },
    { code: '6.1', name: 'Custo das Mercadorias Vendidas', account_type: 'expense', account_nature: 'debit', level: 2, is_header: false, parent_code: '6' },
    { code: '6.3', name: 'Gastos com Pessoal', account_type: 'expense', account_nature: 'debit', level: 2, is_header: true, parent_code: '6' },
    { code: '7', name: 'Rendimentos e Ganhos', account_type: 'revenue', account_nature: 'credit', level: 1, is_header: true },
    { code: '7.1', name: 'Vendas', account_type: 'revenue', account_nature: 'credit', level: 2, is_header: false, parent_code: '7' },
  ];

  const idByCode = new Map<string, string>();

  const seeded = seedRows.map(row => {
    const id = `local-coa-${row.code.replace(/\./g, '-')}`;
    idByCode.set(row.code, id);
    return {
      id,
      code: row.code,
      name: row.name,
      description: null,
      account_type: row.account_type,
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

const loadLocalAccounts = (): Account[] => {
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

  const seeded = createSeedChartOfAccounts();
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const branchCaixaSeeded = useRef(false);

  const fetchAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await api.chartOfAccounts.list();
      if (response.error) throw new Error(response.error);
      const remoteAccounts = sortAccountsByCode(response.data || []);
      setAccounts(remoteAccounts);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch accounts');
      console.error('[useChartOfAccounts] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-seed branch caixa accounts once after first load
  useEffect(() => {
    if (isLoading || branchCaixaSeeded.current || accounts.length === 0) return;
    branchCaixaSeeded.current = true;

    // Fetch branches from API instead of storage
    api.branches.list().then(response => {
      const branches = response.data || [];
      if (branches.length > 0) {
        ensureBranchCaixaAccounts(branches.map((b: any) => ({ id: b.id, name: b.name }))).then(() => {
          const updated = loadLocalAccounts();
          if (updated.length > accounts.length) {
            setAccounts(sortAccountsByCode(updated));
          }
        });
      }
    }).catch(() => {
      // Fallback: read from localStorage
      try {
        const raw = localStorage.getItem('kwanzaerp_branches');
        const branches = raw ? JSON.parse(raw) : [];
        if (branches.length > 0) {
          ensureBranchCaixaAccounts(branches.map((b: any) => ({ id: b.id, name: b.name }))).then(() => {
            const updated = loadLocalAccounts();
            if (updated.length > accounts.length) {
              setAccounts(sortAccountsByCode(updated));
            }
          });
        }
      } catch { /* ignore */ }
    });
  }, [isLoading, accounts.length]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const createAccount = async (data: AccountFormData): Promise<Account> => {
    try {
      const response = await api.chartOfAccounts.create(data);
      if (response.error) throw new Error(response.error);
      await fetchAccounts();
      return response.data;
    } catch (err) {
      if (!isOfflineError(err)) throw err;

      const localAccounts = loadLocalAccounts();
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
      await fetchAccounts();
      return response.data;
    } catch (err) {
      if (!isOfflineError(err)) throw err;

      const localAccounts = loadLocalAccounts();
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
      await fetchAccounts();
    } catch (err) {
      if (!isOfflineError(err)) throw err;

      const localAccounts = loadLocalAccounts();
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

export function useTrialBalance(startDate?: string, endDate?: string) {
  const [data, setData] = useState<TrialBalanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrialBalance = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await api.chartOfAccounts.getTrialBalance(startDate, endDate);
      if (response.error) throw new Error(response.error);
      setData(response.data || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch trial balance');
      console.error('[useTrialBalance] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

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
