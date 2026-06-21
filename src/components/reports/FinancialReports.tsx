import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Scale, DollarSign, FileText, Receipt, Wallet } from 'lucide-react';
import { useTranslation } from '@/i18n';
import TrialBalanceReport from '@/components/reports/TrialBalanceReport';
import IncomeStatementReport from '@/components/reports/IncomeStatementReport';
import BalanceSheetReport from '@/components/reports/BalanceSheetReport';
import VatSummaryReport from '@/components/reports/VatSummaryReport';
import CashFlowReport from '@/components/reports/CashFlowReport';

const SUB_TABS = new Set(['trial-balance', 'income-statement', 'balance-sheet', 'vat', 'cash-flow']);

export default function FinancialReports({ initialTab }: { initialTab?: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(initialTab && SUB_TABS.has(initialTab) ? initialTab : 'trial-balance');

  useEffect(() => {
    if (initialTab && SUB_TABS.has(initialTab)) setTab(initialTab);
  }, [initialTab]);

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="trial-balance">
          <Scale className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabTrialBalance}
        </TabsTrigger>
        <TabsTrigger value="income-statement">
          <DollarSign className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabIncomeStatement}
        </TabsTrigger>
        <TabsTrigger value="balance-sheet">
          <FileText className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabBalanceSheet}
        </TabsTrigger>
        <TabsTrigger value="vat">
          <Receipt className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabVat}
        </TabsTrigger>
        <TabsTrigger value="cash-flow">
          <Wallet className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabCashFlow}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="trial-balance" className="mt-4">
        <TrialBalanceReport />
      </TabsContent>
      <TabsContent value="income-statement" className="mt-4">
        <IncomeStatementReport />
      </TabsContent>
      <TabsContent value="balance-sheet" className="mt-4">
        <BalanceSheetReport />
      </TabsContent>
      <TabsContent value="vat" className="mt-4">
        <VatSummaryReport />
      </TabsContent>
      <TabsContent value="cash-flow" className="mt-4">
        <CashFlowReport />
      </TabsContent>
    </Tabs>
  );
}
