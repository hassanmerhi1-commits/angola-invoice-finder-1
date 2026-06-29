import { useState } from 'react';
import { Users, Truck, Clock, CreditCard, History } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';
import ClientStatementReport from '@/components/reports/ClientStatementReport';
import SupplierStatementReport from '@/components/reports/SupplierStatementReport';
import AccountsReceivableReport from '@/components/reports/AccountsReceivableReport';
import AccountsPayableReport from '@/components/reports/AccountsPayableReport';
import { TransactionHistoryReport } from '@/components/reports/TransactionHistoryReport';

export default function StatementsReports({
  view,
  onViewChange,
}: {
  view?: string;
  onViewChange?: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [internalTab, setInternalTab] = useState('client-statement');
  const tab = view ?? internalTab;
  const setTab = onViewChange ?? setInternalTab;

  const options: ReportOption[] = [
    { value: 'client-statement', label: t.reportsCenterUi.tabClients, icon: Users },
    { value: 'receivables', label: t.reportsCenterUi.tabReceivables, icon: Clock },
    { value: 'supplier-statement', label: t.reportsCenterUi.tabSuppliers, icon: Truck },
    { value: 'payables', label: t.reportsCenterUi.tabPayables, icon: CreditCard },
    { value: 'transactions', label: t.reportsCenterUi.tabHistory, icon: History },
  ];

  return (
    <div className="space-y-4">
      {!onViewChange && <ReportPicker options={options} value={tab} onChange={setTab} />}
      <div>
        {tab === 'client-statement' && <ClientStatementReport />}
        {tab === 'receivables' && <AccountsReceivableReport />}
        {tab === 'supplier-statement' && <SupplierStatementReport />}
        {tab === 'payables' && <AccountsPayableReport />}
        {tab === 'transactions' && <TransactionHistoryReport />}
      </div>
    </div>
  );
}
