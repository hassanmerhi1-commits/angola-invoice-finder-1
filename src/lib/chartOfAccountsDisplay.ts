import type { Account, AccountType } from '@/types/accounting';
import type { TranslationKeys } from '@/i18n';

/**
 * English labels for the key posting accounts of the Angola PGC (novo com IVA).
 * Codes use the no-dot scheme (main 11 → first sub 111). For any account not
 * listed here, the resolver falls back to the account's stored (Portuguese) name.
 */
export const CHART_OF_ACCOUNTS_NAMES_EN: Record<string, string> = {
  '212': 'Purchases - Merchandise',
  '261': 'Merchandise in Stock',
  '311': 'Customers - Current Account',
  '321': 'Suppliers - Current Account',
  '343': 'State - Withholding Tax',
  '345': 'State - VAT',
  '3451': 'VAT Deductible',
  '3452': 'VAT Liquidated',
  '349': 'State - Other Taxes (Stamp Duty)',
  '431': 'Demand Deposits - National Currency',
  '451': 'Cash',
  '561': 'Revaluation Reserves',
  '613': 'Sales - Merchandise',
  '638': 'Other Operating Income and Gains',
  '711': 'Cost of Merchandise Sold',
  '752': 'Freight on Purchases',
  '758': 'Inventory Losses and Breakage',
};

export const CHART_OF_ACCOUNTS_NAMES_PT: Record<string, string> = {
  '212': 'Compras - Mercadorias',
  '261': 'Mercadorias em armazém',
  '311': 'Clientes - correntes',
  '321': 'Fornecedores - correntes',
  '343': 'Estado - Retenção na fonte',
  '345': 'Estado - IVA',
  '3451': 'IVA dedutível',
  '3452': 'IVA liquidado',
  '349': 'Estado - Outros impostos (Imposto de Selo)',
  '431': 'Depósitos à ordem - Moeda nacional',
  '451': 'Caixa',
  '561': 'Reservas de reavaliação',
  '613': 'Vendas - Mercadorias',
  '638': 'Outros proveitos e ganhos operacionais',
  '711': 'Custo das mercadorias vendidas',
  '752': 'Transporte sobre Compras',
  '758': 'Perdas e quebras de inventário',
};

const CASH_BRANCH_RE = /^Caixa\s*-\s*(.+)$/i;

export function resolveAccountDisplayName(
  account: Pick<Account, 'code' | 'name'>,
  language: 'en' | 'pt',
  t?: Pick<TranslationKeys, 'chartOfAccountsUi'>,
): string {
  const byCode = language === 'en' ? CHART_OF_ACCOUNTS_NAMES_EN : CHART_OF_ACCOUNTS_NAMES_PT;
  const mapped = byCode[account.code];
  if (mapped) return mapped;

  if (language === 'en' && t) {
    const cashMatch = account.name.match(CASH_BRANCH_RE);
    if (cashMatch) {
      return `${t.chartOfAccountsUi.cashBranchPrefix}${cashMatch[1].trim()}`;
    }
  }

  return account.name;
}

export function resolveAccountTypeLabel(type: AccountType, t: TranslationKeys): string {
  const labels: Record<AccountType, string> = {
    asset: t.chartOfAccountsUi.typeAsset,
    liability: t.chartOfAccountsUi.typeLiability,
    equity: t.chartOfAccountsUi.typeEquity,
    revenue: t.chartOfAccountsUi.typeRevenue,
    expense: t.chartOfAccountsUi.typeExpense,
  };
  return labels[type] ?? type;
}
