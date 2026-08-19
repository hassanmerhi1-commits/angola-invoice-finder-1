export type TbRow = {
  code?: string;
  name?: string;
  account_type?: string;
  account_nature?: string;
  total_debits?: number;
  total_credits?: number;
  closing_balance?: number;
};

export type IncomeStatementLine = {
  code: string;
  description: string;
  value: number;
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

export function buildIncomeStatement(rows: TbRow[], labels: IncomeStatementLabels) {
  const salesOfGoods = sumByPrefix(rows, ['71']);
  const services = sumByPrefix(rows, ['72']);
  const otherIncome = sumByPrefix(rows, ['73', '74', '75']);
  const operatingIncome = salesOfGoods + services + otherIncome;

  const cogs = sumByPrefix(rows, ['61']);
  const grossProfit = operatingIncome - cogs;

  const externalSupplies = sumByPrefix(rows, ['62']);
  const personnel = sumByPrefix(rows, ['63']);
  const depreciation = sumByPrefix(rows, ['64']);
  const otherOpex = sumByPrefix(rows, ['65', '66', '67', '68']);
  const totalOperatingExpenses = externalSupplies + personnel + depreciation + otherOpex;

  const operatingProfit = grossProfit - totalOperatingExpenses;

  const financialIncome = sumByPrefix(rows, ['78']);
  const financialExpenses = sumByPrefix(rows, ['69']);
  const financialResult = financialIncome - financialExpenses;

  const profitBeforeTax = operatingProfit + financialResult;
  const incomeTax = sumByPrefix(rows, ['81']);
  const netProfit = profitBeforeTax - incomeTax;

  const lineItems: IncomeStatementLine[] = [
    { code: '71', description: labels.salesOfGoods, value: salesOfGoods },
    { code: '72', description: labels.servicesProvided, value: services },
    { code: '73', description: labels.otherOperatingIncome, value: otherIncome },
    { code: '', description: labels.operatingIncome, value: operatingIncome, isSubtotal: true },

    { code: '61', description: labels.costOfGoodsSold, value: -cogs, indent: 1 },
    { code: '', description: labels.grossResult, value: grossProfit, isSubtotal: true },

    { code: '62', description: labels.externalSuppliesServices, value: -externalSupplies, indent: 1 },
    { code: '63', description: labels.personnelExpenses, value: -personnel, indent: 1 },
    { code: '64', description: labels.depreciationAmortization, value: -depreciation, indent: 1 },
    { code: '65', description: labels.otherOperatingExpenses, value: -otherOpex, indent: 1 },
    { code: '', description: labels.totalOperatingExpenses, value: -totalOperatingExpenses, isSubtotal: true },

    { code: '', description: labels.operatingResult, value: operatingProfit, isSubtotal: true },

    { code: '78', description: labels.financialIncome, value: financialIncome, indent: 1 },
    { code: '69', description: labels.financialExpenses, value: -financialExpenses, indent: 1 },
    { code: '', description: labels.financialResult, value: financialResult, isSubtotal: true },

    { code: '', description: labels.resultBeforeTax, value: profitBeforeTax, isSubtotal: true },
    { code: '81', description: labels.incomeTax, value: -incomeTax, indent: 1 },
    { code: '', description: labels.netResult, value: netProfit, isTotal: true },
  ];

  return { lineItems, netProfit, operatingIncome, grossProfit, operatingProfit };
}

export function treasuryMovement(rows: TbRow[]): { cash: number; banks: number } {
  return {
    cash: sumByPrefix(rows, ['45']),
    banks: sumByPrefix(rows, ['43', '42', '44']),
  };
}
