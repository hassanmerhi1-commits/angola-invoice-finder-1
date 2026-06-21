import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, ArrowRightLeft, Tags } from 'lucide-react';
import { useTranslation } from '@/i18n';
import StockValuationReport from '@/components/reports/StockValuationReport';
import StockByCategoryReport from '@/components/reports/StockByCategoryReport';
import StockMovementReport from '@/components/reports/StockMovementReport';

const SUB_TABS = new Set(['valuation', 'category', 'movements']);

export default function InventoryReports({ initialTab }: { initialTab?: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(initialTab && SUB_TABS.has(initialTab) ? initialTab : 'valuation');

  useEffect(() => {
    if (initialTab && SUB_TABS.has(initialTab)) setTab(initialTab);
  }, [initialTab]);

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="valuation">
          <Package className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabStock}
        </TabsTrigger>
        <TabsTrigger value="category">
          <Tags className="w-4 h-4 mr-2" />
          {t.stockValuationUi.byCategory}
        </TabsTrigger>
        <TabsTrigger value="movements">
          <ArrowRightLeft className="w-4 h-4 mr-2" />
          {t.reportsCenterUi.tabMovements}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="valuation" className="mt-4">
        <StockValuationReport />
      </TabsContent>
      <TabsContent value="category" className="mt-4">
        <StockByCategoryReport />
      </TabsContent>
      <TabsContent value="movements" className="mt-4">
        <StockMovementReport />
      </TabsContent>
    </Tabs>
  );
}
