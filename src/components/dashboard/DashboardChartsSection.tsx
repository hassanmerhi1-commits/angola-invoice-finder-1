// Lazily-loaded charts block — keeps recharts out of the Dashboard route's
// critical path so KPI cards paint before any chart code is parsed.
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DashboardChartsProvider,
  RevenueExpensesChart, CashFlowChart, TopProductsChart,
  ARAgingChart, DailySalesChart, ProfitMarginWidget,
  PaymentMethodChart, StockValuationWidget,
} from '@/components/dashboard/FinancialCharts';
import { useTranslation } from '@/i18n';

export default function DashboardChartsSection() {
  const { t } = useTranslation();
  const d = t.dashboardUi;

  return (
    <DashboardChartsProvider>
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">{d.tabOverview}</TabsTrigger>
          <TabsTrigger value="cashflow">{d.tabCashflow}</TabsTrigger>
          <TabsTrigger value="products">{d.tabProducts}</TabsTrigger>
          <TabsTrigger value="aging">{d.tabAging}</TabsTrigger>
          <TabsTrigger value="payments">{d.tabPayments}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ProfitMarginWidget />
            <StockValuationWidget />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RevenueExpensesChart />
            <DailySalesChart />
          </div>
        </TabsContent>
        <TabsContent value="cashflow">
          <CashFlowChart />
        </TabsContent>
        <TabsContent value="products">
          <TopProductsChart />
        </TabsContent>
        <TabsContent value="aging">
          <ARAgingChart />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentMethodChart />
        </TabsContent>
      </Tabs>
    </DashboardChartsProvider>
  );
}
