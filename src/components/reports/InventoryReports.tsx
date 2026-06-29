import { useState } from 'react';
import { Package, ArrowRightLeft, Tags } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';
import StockValuationReport from '@/components/reports/StockValuationReport';
import StockByCategoryReport from '@/components/reports/StockByCategoryReport';
import StockMovementReport from '@/components/reports/StockMovementReport';

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
  ];

  return (
    <div className="space-y-4">
      {!onViewChange && <ReportPicker options={options} value={tab} onChange={setTab} />}
      <div>
        {tab === 'valuation' && <StockValuationReport />}
        {tab === 'category' && <StockByCategoryReport />}
        {tab === 'movements' && <StockMovementReport />}
      </div>
    </div>
  );
}
