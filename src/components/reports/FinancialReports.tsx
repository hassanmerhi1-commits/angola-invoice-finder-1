import { useState } from 'react';
import { Scale, DollarSign, FileText, Receipt, Wallet } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';
import TrialBalanceReport from '@/components/reports/TrialBalanceReport';
import IncomeStatementReport from '@/components/reports/IncomeStatementReport';
import BalanceSheetReport from '@/components/reports/BalanceSheetReport';
import VatSummaryReport from '@/components/reports/VatSummaryReport';
import CashFlowReport from '@/components/reports/CashFlowReport';

export default function FinancialReports({
  view,
  onViewChange,
}: {
  view?: string;
  onViewChange?: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [internalTab, setInternalTab] = useState('trial-balance');
  const tab = view ?? internalTab;
  const setTab = onViewChange ?? setInternalTab;

  const options: ReportOption[] = [
    { value: 'trial-balance', label: t.reportsCenterUi.tabTrialBalance, icon: Scale },
    { value: 'income-statement', label: t.reportsCenterUi.tabIncomeStatement, icon: DollarSign },
    { value: 'balance-sheet', label: t.reportsCenterUi.tabBalanceSheet, icon: FileText },
    { value: 'vat', label: t.reportsCenterUi.tabVat, icon: Receipt },
    { value: 'cash-flow', label: t.reportsCenterUi.tabCashFlow, icon: Wallet },
  ];

  return (
    <div className="space-y-4">
      {!onViewChange && <ReportPicker options={options} value={tab} onChange={setTab} />}
      <div>
        {tab === 'trial-balance' && <TrialBalanceReport />}
        {tab === 'income-statement' && <IncomeStatementReport />}
        {tab === 'balance-sheet' && <BalanceSheetReport />}
        {tab === 'vat' && <VatSummaryReport />}
        {tab === 'cash-flow' && <CashFlowReport />}
      </div>
    </div>
  );
}
