import type { Account, ExpenseCategory } from '@/types/accounting';
import { branchIdsEquivalent } from '@/lib/branchAccess';

/** Category on the expense form still suggests a family. The posting account is chosen separately. */
export const EXPENSE_CATEGORY_GL: Record<ExpenseCategory, string> = {
  staff: '722',
  transport: '752',
  utilities: '752',
  materials: '752',
  maintenance: '752',
  other: '758',
};

type PostingLike = Pick<Account, 'code' | 'is_header' | 'is_active' | 'account_type'>;

export function isExpensePostingAccount(account: PostingLike | null | undefined): boolean {
  if (!account || account.is_header) return false;
  if (account.is_active === false) return false;
  if (account.account_type !== 'expense') return false;
  return /^\d{3,8}$/.test(String(account.code || '').trim());
}

export function expensePostingAccounts<T extends PostingLike>(accounts: T[]): T[] {
  return (accounts || [])
    .filter(isExpensePostingAccount)
    .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
}

/**
 * One posting account in the category family is selected for them.
 * Several children (Água, electricity, …) stay empty so the wrong child is not guessed.
 */
export function defaultExpenseAccountCode(category: ExpenseCategory, accounts: PostingLike[]): string {
  const root = EXPENSE_CATEGORY_GL[category] || '758';
  const pool = expensePostingAccounts(accounts).filter(
    (account) => account.code === root || String(account.code).startsWith(root),
  );
  if (pool.length === 1) return pool[0].code;
  return '';
}

type CashLike = { branchId?: string | null; branchName?: string | null; name?: string | null };

/** Best 45x leaf for this till, using the same hints the server uses. */
export function caixaGlCodeForTill(
  accounts: Array<Pick<Account, 'code' | 'name' | 'is_header' | 'is_active' | 'branch_id'>>,
  caixa: CashLike | null | undefined,
): string {
  if (!caixa) return '';
  const leaves = (accounts || []).filter((account) => {
    if (account.is_header || account.is_active === false) return false;
    const code = String(account.code || '').trim();
    return /^45\d+$/.test(code) && code !== '45';
  });
  const branchId = String(caixa.branchId || '').trim();
  const byBranch = branchId
    ? leaves.filter((account) => account.branch_id && branchIdsEquivalent(account.branch_id, branchId))
    : [];
  const branchName = String(caixa.branchName || '').trim().toLowerCase();
  const caixaName = String(caixa.name || '').trim().toLowerCase();
  const byName = leaves.filter((account) => {
    const name = String(account.name || '').toLowerCase();
    return (branchName && name.includes(branchName)) || (caixaName && name.includes(caixaName));
  });
  const pool = byBranch.length ? byBranch : byName;
  if (!pool.length) return '';
  pool.sort((a, b) => String(b.code).length - String(a.code).length || String(a.code).localeCompare(String(b.code)));
  return String(pool[0].code);
}
