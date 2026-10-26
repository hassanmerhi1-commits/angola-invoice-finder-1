export type TbRow = {
  code?: string;
  name?: string;
  account_type?: string;
  account_nature?: string;
  is_header?: boolean;
  total_debits?: number;
  total_credits?: number;
  closing_balance?: number;
};

const PGC_REVENUE_PREFIXES = ['61', '62', '63', '64', '65', '66', '67', '68', '69'];
const PGC_EXPENSE_PREFIXES = ['71', '72', '73', '75', '76', '77', '78', '79', '87'];

export type IncomeStatementLine = {
  code: string;
  description: string;
  value: number;
  isHeader?: boolean;
  isSubtotal?: boolean;
  isTotal?: boolean;
  indent?: number;
};

export type IncomeStatementLabels = {
  salesOfGoods: string;
  servicesProvided: string;
  otherOperatingIncome: string;
  operatingIncome: string;
  costOfGoodsSold: string;
  grossResult: string;
  externalSuppliesServices: string;
  personnelExpenses: string;
  depreciationAmortization: string;
  otherOperatingExpenses: string;
  totalOperatingExpenses: string;
  operatingResult: string;
  financialIncome: string;
  financialExpenses: string;
  financialResult: string;
  resultBeforeTax: string;
  incomeTax: string;
  netResult: string;
  sectionRevenue: string;
  sectionExpenses: string;
  sectionResult: string;
  totalRevenue: string;
  totalExpenses: string;
};

export function periodMovement(row: TbRow): number {
  const debits = Number(row.total_debits || 0);
  const credits = Number(row.total_credits || 0);
  const nature = String(row.account_nature || '').toLowerCase();
  if (nature === 'credit') return credits - debits;
  return debits - credits;
}

export function sumByPrefix(rows: TbRow[], prefixes: string[]): number {
  return rows.reduce((sum, row) => {
    const code = String(row.code || '').trim();
    if (!code) return sum;
    if (prefixes.some((p) => code === p || code.startsWith(p))) {
      return sum + periodMovement(row);
    }
    return sum;
  }, 0);
}

/** Accounts reclassified to revenue/expense (codes stay) that PGC prefixes would miss. */
export function sumByTypeExcludingPrefixes(
  rows: TbRow[],
  accountType: 'revenue' | 'expense',
  prefixes: string[],
): number {
  return rows.reduce((sum, row) => {
    if (row.is_header) return sum;
    if (String(row.account_type || '').toLowerCase() !== accountType) return sum;
    const code = String(row.code || '').trim();
    if (!code) return sum;
    if (prefixes.some((p) => code === p || code.startsWith(p))) return sum;
    return sum + periodMovement(row);
  }, 0);
}

/**
 * Angola PGC (class 6 proveitos, class 7 custos). Posted sales credit 613;
 * CMV debits 711. Do not use SNC 2009 (inverted 6/7) prefixes.
 */
export function buildIncomeStatement(rows: TbRow[], labels: IncomeStatementLabels) {
  const salesOfGoods = sumByPrefix(rows, ['61']);
  const services = sumByPrefix(rows, ['62']);
  const otherIncome = sumByPrefix(rows, ['63', '64', '65', '68', '69'])
    + sumByTypeExcludingPrefixes(rows, 'revenue', PGC_REVENUE_PREFIXES);
  const operatingIncome = salesOfGoods + services + otherIncome;

  const cogs = sumByPrefix(rows, ['71']);
  const grossProfit = operatingIncome - cogs;

  const externalSupplies = sumByPrefix(rows, ['75']);
  const personnel = sumByPrefix(rows, ['72']);
  const depreciation = sumByPrefix(rows, ['73']);
  const otherOpex = sumByPrefix(rows, ['78', '79'])
    + sumByTypeExcludingPrefixes(rows, 'expense', PGC_EXPENSE_PREFIXES);
  const totalOperatingExpenses = externalSupplies + personnel + depreciation + otherOpex;

  const operatingProfit = grossProfit - totalOperatingExpenses;

  const financialIncome = sumByPrefix(rows, ['66', '67']);
  const financialExpenses = sumByPrefix(rows, ['76', '77']);
  const financialResult = financialIncome - financialExpenses;

  const profitBeforeTax = operatingProfit + financialResult;
  const incomeTax = sumByPrefix(rows, ['87']);
  const netProfit = profitBeforeTax - incomeTax;
  const totalRevenue = operatingIncome + financialIncome;
  const totalExpenses = cogs + totalOperatingExpenses + financialExpenses + incomeTax;

  const lineItems: IncomeStatementLine[] = [
    { code: '', description: labels.sectionRevenue, value: 0, isHeader: true },
    { code: '61', description: labels.salesOfGoods, value: salesOfGoods, indent: 1 },
    { code: '62', description: labels.servicesProvided, value: services, indent: 1 },
    { code: '63', description: labels.otherOperatingIncome, value: otherIncome, indent: 1 },
    { code: '66', description: labels.financialIncome, value: financialIncome, indent: 1 },
    { code: '', description: labels.totalRevenue, value: totalRevenue, isSubtotal: true },

    { code: '', description: labels.sectionExpenses, value: 0, isHeader: true },
    { code: '71', description: labels.costOfGoodsSold, value: cogs, indent: 1 },
    { code: '72', description: labels.personnelExpenses, value: personnel, indent: 1 },
    { code: '73', description: labels.depreciationAmortization, value: depreciation, indent: 1 },
    { code: '75', description: labels.externalSuppliesServices, value: externalSupplies, indent: 1 },
    { code: '76', description: labels.financialExpenses, value: financialExpenses, indent: 1 },
    { code: '78', description: labels.otherOperatingExpenses, value: otherOpex, indent: 1 },
    { code: '87', description: labels.incomeTax, value: incomeTax, indent: 1 },
    { code: '', description: labels.totalExpenses, value: totalExpenses, isSubtotal: true },

    { code: '', description: labels.sectionResult, value: 0, isHeader: true },
    { code: '', description: labels.grossResult, value: grossProfit, isSubtotal: true },
    { code: '', description: labels.operatingResult, value: operatingProfit, isSubtotal: true },
    { code: '', description: labels.financialResult, value: financialResult, isSubtotal: true },
    { code: '', description: labels.resultBeforeTax, value: profitBeforeTax, isSubtotal: true },
    { code: '88', description: labels.netResult, value: netProfit, isTotal: true },
  ];

  return { lineItems, netProfit, operatingIncome, grossProfit, operatingProfit, totalRevenue, totalExpenses };
}

export function treasuryMovement(rows: TbRow[]): { cash: number; banks: number } {
  return {
    cash: sumByPrefix(rows, ['45']),
    banks: sumByPrefix(rows, ['43', '42', '44']),
  };
}
