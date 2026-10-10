import { useState } from 'react';
import { Package, ArrowRightLeft, Tags, ClipboardList, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';
import StockValuationReport from '@/components/reports/StockValuationReport';
import StockByCategoryReport from '@/components/reports/StockByCategoryReport';
import StockMovementReport from '@/components/reports/StockMovementReport';
import StockAdjustmentHistoryReport from '@/components/reports/StockAdjustmentHistoryReport';
import DeadStockReport from '@/components/reports/DeadStockReport';

export default function InventoryReports({
  view,
  onViewChange,
}: {
  view?: string;
  onViewChange?: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [internalTab, setInternalTab] = useState('valuation');
  const tab = view ?? internalTab;
  const setTab = onViewChange ?? setInternalTab;

  const options: ReportOption[] = [
    { value: 'valuation', label: t.reportsCenterUi.tabStock, icon: Package },
    { value: 'category', label: t.stockValuationUi.byCategory, icon: Tags },
    { value: 'movements', label: t.reportsCenterUi.tabMovements, icon: ArrowRightLeft },
    { value: 'adjustments', label: t.adjustmentHistoryUi.title, icon: ClipboardList },
    { value: 'dead-stock', label: t.reportsCenterUi.deadStock, icon: AlertTriangle },
  ];

  return (
    <div className="space-y-4">
      <ReportPicker options={options} value={tab} onChange={setTab} />
      <div>
        {tab === 'valuation' && <StockValuationReport />}
        {tab === 'category' && <StockByCategoryReport />}
        {tab === 'movements' && <StockMovementReport />}
        {tab === 'adjustments' && <StockAdjustmentHistoryReport />}
        {(tab === 'dead-stock' || tab === 'ops') && <DeadStockReport />}
      </div>
    </div>
  );
}
