import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Truck, Clock, CreditCard, History } from 'lucide-react';
import { useTranslation } from '@/i18n';
import ClientStatementReport from '@/components/reports/ClientStatementReport';
import SupplierStatementReport from '@/components/reports/SupplierStatementReport';
import AccountsReceivableReport from '@/components/reports/AccountsReceivableReport';
import AccountsPayableReport from '@/components/reports/AccountsPayableReport';
import { TransactionHistoryReport } from '@/components/reports/TransactionHistoryReport';

const SUB_TABS = new Set(['client-statement', 'supplier-statement', 'receivables', 'payables', 'transactions']);

export default function StatementsReports({ initialTab }: { initialTab?: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(initialTab && SUB_TABS.has(initialTab) ? initialTab : 'client-statement');

  useEffect(() => {
    if (initialTab && SUB_TABS.has(initialTab)) setTab(initialTab);
  }, [initialTab]);

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="client-statement">
          <Users className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabClients}
        </TabsTrigger>
        <TabsTrigger value="receivables">
          <Clock className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabReceivables}
        </TabsTrigger>
        <TabsTrigger value="supplier-statement">
          <Truck className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabSuppliers}
        </TabsTrigger>
        <TabsTrigger value="payables">
          <CreditCard className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabPayables}
        </TabsTrigger>
        <TabsTrigger value="transactions">
          <History className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabHistory}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="client-statement" className="mt-4">
        <ClientStatementReport />
      </TabsContent>
      <TabsContent value="receivables" className="mt-4">
        <AccountsReceivableReport />
      </TabsContent>
      <TabsContent value="supplier-statement" className="mt-4">
        <SupplierStatementReport />
      </TabsContent>
      <TabsContent value="payables" className="mt-4">
        <AccountsPayableReport />
      </TabsContent>
      <TabsContent value="transactions" className="mt-4">
        <TransactionHistoryReport />
      </TabsContent>
    </Tabs>
  );
}
