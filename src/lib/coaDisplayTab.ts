import type { Account, AccountNature, AccountType } from '@/types/accounting';
import { getDefaultNature } from '@/types/accounting';

const TAB_ACCOUNT_TYPE: Record<CoaDisplayTab, AccountType> = {
  clientes: 'asset',
  fornecedores: 'liability',
  caixa: 'asset',
  bancos: 'asset',
  ativos: 'asset',
  recebimentos: 'revenue',
  custos: 'expense',
  funcionarios: 'expense',
  capital: 'equity',
};

export function accountingForTab(tab: string): { accountType: AccountType; nature: AccountNature } | null {
  const key = normalizeDisplayTab(tab);
  if (!key) return null;
  const accountType = TAB_ACCOUNT_TYPE[key];
  return { accountType, nature: getDefaultNature(accountType) };
}

export const COA_DISPLAY_TABS = [
  'clientes',
  'fornecedores',
  'caixa',
  'bancos',
  'ativos',
  'recebimentos',
  'custos',
  'funcionarios',
  'capital',
] as const;

export type CoaDisplayTab = (typeof COA_DISPLAY_TABS)[number];

export function normalizeDisplayTab(raw: unknown): CoaDisplayTab | null {
  const value = String(raw || '').trim();
  return (COA_DISPLAY_TABS as readonly string[]).includes(value) ? (value as CoaDisplayTab) : null;
}

export function resolveDisplayTab(
  account: Pick<Account, 'id' | 'parent_id' | 'display_tab'>,
  byId: Map<string, Pick<Account, 'id' | 'parent_id' | 'display_tab'>>,
): CoaDisplayTab | null {
  let current: Pick<Account, 'id' | 'parent_id' | 'display_tab'> | undefined = account;
  const seen = new Set<string>();
  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    const tab = normalizeDisplayTab(current.display_tab);
    if (tab) return tab;
    const parentId = current.parent_id ? String(current.parent_id) : '';
    current = parentId ? byId.get(parentId) : undefined;
  }
  return null;
}

export function collectDescendantIds(rootId: string, accounts: Account[]): string[] {
  const children = new Map<string, string[]>();
  for (const account of accounts) {
    if (!account.parent_id) continue;
    const parentId = String(account.parent_id);
    const list = children.get(parentId) || [];
    list.push(account.id);
    children.set(parentId, list);
  }
  const out: string[] = [];
  const stack = [...(children.get(rootId) || [])];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    const kids = children.get(id);
    if (kids) stack.push(...kids);
  }
  return out;
}

export function applyDisplayTabToBranch(
  accounts: Account[],
  rootId: string,
  displayTab: string | null,
): Account[] {
  const ids = new Set([rootId, ...collectDescendantIds(rootId, accounts)]);
  const tab = normalizeDisplayTab(displayTab);
  const accounting = tab ? accountingForTab(tab) : null;
  return accounts.map((account) => (
    ids.has(account.id)
      ? {
        ...account,
        display_tab: tab,
        ...(accounting
          ? { account_type: accounting.accountType, account_nature: accounting.nature }
          : {}),
      }
      : account
  ));
}
