import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/i18n';
import { isDemoMode } from '@/lib/api/config';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales, useProducts } from '@/hooks/useERP';
import type { Sale, Product } from '@/types/erp';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// ==================== DATA HELPERS ====================

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function saleLocalDate(sale: Sale | Record<string, unknown>): string {
  const raw = (sale as Sale).createdAt
    || (sale as Record<string, string>).created_at
    || (sale as Record<string, string>).date;
  if (!raw) return '';
  return toLocalDateStr(new Date(raw));
}

function isCompletedSale(sale: Sale | Record<string, unknown>): boolean {
  const status = String((sale as Sale).status || 'completed');
  return status === 'completed' || status === 'paid';
}

function useChartSales(): Sale[] {
  const { apiBranchId } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  return sales;
}

function useChartProducts(): Product[] {
  const { apiBranchId } = useBranchScope();
  const { products } = useProducts(apiBranchId);
  return products;
}

function getExpensesFromStorage() {
  if (!isDemoMode()) return [];
  try {
    const stored = localStorage.getItem('kwanzaerp_expenses');
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function getPaymentsFromStorage() {
  if (!isDemoMode()) return [];
  try {
    const stored = localStorage.getItem('kwanzaerp_payments');
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--destructive))',
  'hsl(142, 76%, 36%)',
  'hsl(38, 92%, 50%)',
  'hsl(262, 83%, 58%)',
  'hsl(199, 89%, 48%)',
];

function useChartsI18n() {
  const { t, language } = useTranslation();
  const c = t.chartsUi;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const fmtMoney = (value: number) => `${value.toLocaleString(locale)} Kz`;
  return { c, locale, fmtMoney, months: c.monthsShort, language };
}

// ==================== REVENUE VS EXPENSES CHART ====================

export function RevenueExpensesChart() {
  const { c, fmtMoney, months } = useChartsI18n();
  const year = new Date().getFullYear();
  const sales = useChartSales();

  const data = useMemo(() => {
    const completed = sales.filter(isCompletedSale);
    const expenses = getExpensesFromStorage();
    return months.map((month, i) => {
      const monthSales = completed.filter((s) => {
        const d = new Date(s.createdAt);
        return d.getFullYear() === year && d.getMonth() === i;
      });
      const monthExpenses = expenses.filter((e: any) => {
        const d = new Date(e.createdAt || e.requestedAt);
        return d.getFullYear() === year && d.getMonth() === i;
      });

      const revenue = monthSales.reduce((s, sale) => s + (sale.total || 0), 0);
      const expense = monthExpenses.reduce((s: number, exp: any) => s + (exp.totalAmount || exp.amount || 0), 0);

      return { month, receita: revenue, despesa: expense, lucro: revenue - expense };
    });
  }, [months, year, sales]);

  const hasData = data.some((row) => row.receita > 0 || row.despesa > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{c.revenueVsExpenses.replace('{year}', String(year))}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number) => fmtMoney(value)}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="receita" name={c.revenue} fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesa" name={c.expenses} fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-60 flex items-center justify-center text-muted-foreground text-sm">
            {c.noSalesExpenseData}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== CASH FLOW TREND ====================

export function CashFlowChart() {
  const { c, fmtMoney, months } = useChartsI18n();
  const year = new Date().getFullYear();
  const sales = useChartSales();

  const data = useMemo(() => {
    const completed = sales.filter(isCompletedSale);
    const expenses = getExpensesFromStorage();
    let runningBalance = 0;

    return months.map((month, i) => {
      const inflow = completed.filter((s) => {
        const d = new Date(s.createdAt);
        return d.getFullYear() === year && d.getMonth() === i;
      }).reduce((s, sale) => s + (sale.total || 0), 0);

      const outflow = expenses.filter((e: any) => {
        const d = new Date(e.createdAt || e.requestedAt);
        return d.getFullYear() === year && d.getMonth() === i;
      }).reduce((s: number, exp: any) => s + (exp.totalAmount || exp.amount || 0), 0);

      runningBalance += inflow - outflow;
      return { month, entrada: inflow, saida: outflow, saldo: runningBalance };
    });
  }, [months, year, sales]);

  const hasData = data.some((row) => row.entrada > 0 || row.saida > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{c.cashFlowAccumulated}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number) => fmtMoney(value)}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Area type="monotone" dataKey="saldo" name={c.balance} fill="hsl(var(--primary) / 0.2)" stroke="hsl(var(--primary))" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-60 flex items-center justify-center text-muted-foreground text-sm">
            {c.noCashFlowData}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== TOP PRODUCTS BY PROFIT ====================

export function TopProductsChart() {
  const { c, fmtMoney } = useChartsI18n();
  const sales = useChartSales();

  const data = useMemo(() => {
    const completed = sales.filter(isCompletedSale);
    const productMap = new Map<string, { name: string; revenue: number; cost: number }>();

    for (const sale of completed) {
      for (const item of (sale.items || [])) {
        const key = item.productId || item.productName;
        const existing = productMap.get(key) || { name: item.productName || key, revenue: 0, cost: 0 };
        existing.revenue += (item.subtotal || item.unitPrice * item.quantity) || 0;
        existing.cost += ((item as { costPrice?: number }).costPrice || 0) * item.quantity;
        productMap.set(key, existing);
      }
    }

    return Array.from(productMap.values())
      .map(p => ({ ...p, margin: p.revenue - p.cost }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [sales]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{c.topProductsByRevenue}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} className="fill-muted-foreground" />
              <Tooltip
                formatter={(value: number) => fmtMoney(value)}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="revenue" name={c.revenue} fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-60 flex items-center justify-center text-muted-foreground text-sm">
            {c.noProductSalesData}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== AR AGING ====================

export function ARAgingChart() {
  const { c, fmtMoney, language } = useChartsI18n();
  const sales = useChartSales();

  const data = useMemo(() => {
    const now = new Date();

    const buckets = { current: 0, '30d': 0, '60d': 0, '90d': 0, '90d+': 0 };

    for (const sale of sales) {
      if ((sale as Sale & { paymentStatus?: string }).paymentStatus === 'paid' || sale.status === 'paid') continue;
      const remaining = (sale.total || 0) - (sale.amountPaid || 0);
      if (remaining <= 0) continue;

      const saleDate = new Date(sale.createdAt);
      const days = Math.floor((now.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24));

      if (days <= 0) buckets.current += remaining;
      else if (days <= 30) buckets['30d'] += remaining;
      else if (days <= 60) buckets['60d'] += remaining;
      else if (days <= 90) buckets['90d'] += remaining;
      else buckets['90d+'] += remaining;
    }

    return [
      { name: c.agingCurrent, value: buckets.current },
      { name: c.aging1_30, value: buckets['30d'] },
      { name: c.aging31_60, value: buckets['60d'] },
      { name: c.aging61_90, value: buckets['90d'] },
      { name: c.aging90plus, value: buckets['90d+'] },
    ];
  }, [language, sales, c.agingCurrent, c.aging1_30, c.aging31_60, c.aging61_90, c.aging90plus]);

  const hasData = data.some((row) => row.value > 0);
  const colors = ['hsl(142, 76%, 36%)', 'hsl(199, 89%, 48%)', 'hsl(38, 92%, 50%)', 'hsl(25, 95%, 53%)', 'hsl(var(--destructive))'];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{c.arAging}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={200}>
              <PieChart>
                <Pie data={data.filter(d => d.value > 0)} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                  {data.filter(d => d.value > 0).map((_, i) => (
                    <Cell key={i} fill={colors[i % colors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => fmtMoney(value)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {data.map((item, i) => (
                <div key={item.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[i] }} />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="font-medium">{fmtMoney(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            {c.noPendingAR}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== DAILY SALES TREND (Last 14 days) ====================

export function DailySalesChart() {
  const { c, fmtMoney } = useChartsI18n();
  const sales = useChartSales();

  const data = useMemo(() => {
    const completed = sales.filter(isCompletedSale);
    const now = new Date();
    const days: { date: string; label: string; total: number; count: number }[] = [];

    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = toLocalDateStr(d);
      const label = `${d.getDate()}/${d.getMonth() + 1}`;

      const daySales = completed.filter((s) => saleLocalDate(s) === dateStr);

      days.push({
        date: dateStr,
        label,
        total: daySales.reduce((s, sale) => s + (sale.total || 0), 0),
        count: daySales.length,
      });
    }
    return days;
  }, [sales]);

  const hasData = data.some(d => d.total > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{c.dailySales14}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number, name: string) => [
                  fmtMoney(value),
                  name === 'total' ? c.sales : name,
                ]}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Line type="monotone" dataKey="total" name={c.sales} stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            {c.noSales14Days}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== PROFIT MARGIN GAUGE ====================

export function ProfitMarginWidget() {
  const { c, fmtMoney } = useChartsI18n();
  const sales = useChartSales();
  const products = useChartProducts();

  const data = useMemo(() => {
    const completed = sales.filter(isCompletedSale);
    const productCostMap = new Map<string, number>();
    for (const p of products) {
      productCostMap.set(p.id, p.avgCost || p.cost || 0);
    }

    let totalRevenue = 0;
    let totalCost = 0;

    for (const sale of completed) {
      for (const item of (sale.items || [])) {
        const revenue = (item.subtotal || item.unitPrice * item.quantity) || 0;
        const cost = (productCostMap.get(item.productId) || 0) * item.quantity;
        totalRevenue += revenue;
        totalCost += cost;
      }
    }

    const grossProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    return { totalRevenue, totalCost, grossProfit, margin };
  }, [sales, products]);

  const marginColor = data.margin >= 30 ? 'hsl(142, 76%, 36%)' : data.margin >= 15 ? 'hsl(38, 92%, 50%)' : 'hsl(var(--destructive))';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{c.grossProfitMargin}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <div className="relative w-28 h-28">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
              <circle cx="50" cy="50" r="40" fill="none" stroke={marginColor} strokeWidth="10"
                strokeDasharray={`${Math.min(data.margin, 100) * 2.51} 251`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold" style={{ color: marginColor }}>{data.margin.toFixed(1)}%</span>
            </div>
          </div>
          <div className="flex-1 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{c.totalRevenue}</span>
              <span className="font-medium">{fmtMoney(data.totalRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{c.totalCost}</span>
              <span className="font-medium">{fmtMoney(data.totalCost)}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span className="font-semibold">{c.grossProfit}</span>
              <span className="font-bold" style={{ color: marginColor }}>{fmtMoney(data.grossProfit)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== PAYMENT METHOD BREAKDOWN ====================

export function PaymentMethodChart() {
  const { c, fmtMoney, language } = useChartsI18n();
  const sales = useChartSales();

  const data = useMemo(() => {
    const completed = sales.filter(isCompletedSale);
    const methods: Record<string, { name: string; value: number; count: number }> = {
      cash: { name: c.methodCash, value: 0, count: 0 },
      card: { name: c.methodCard, value: 0, count: 0 },
      transfer: { name: c.methodTransfer, value: 0, count: 0 },
      mixed: { name: c.methodMixed, value: 0, count: 0 },
    };

    for (const sale of completed) {
      const method = sale.paymentMethod || 'cash';
      if (methods[method]) {
        methods[method].value += sale.total || 0;
        methods[method].count += 1;
      }
    }

    return Object.values(methods).filter(m => m.value > 0);
  }, [language, sales, c.methodCash, c.methodCard, c.methodTransfer, c.methodMixed]);

  const colors = ['hsl(142, 76%, 36%)', 'hsl(var(--primary))', 'hsl(38, 92%, 50%)', 'hsl(262, 83%, 58%)'];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{c.paymentMethods}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="45%" height={160}>
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={3}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={colors[i % colors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => fmtMoney(value)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {data.map((item, i) => (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium">{fmtMoney(item.value)}</span>
                    <span className="text-muted-foreground ml-1">({item.count})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
            {c.noSalesData}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== STOCK VALUATION SUMMARY ====================

export function StockValuationWidget() {
  const { c, fmtMoney, locale } = useChartsI18n();
  const products = useChartProducts();

  const data = useMemo(() => {
    let totalCostValue = 0;
    let totalSaleValue = 0;
    let totalItems = 0;
    let activeProducts = 0;

    for (const p of products) {
      if (!p.isActive) continue;
      activeProducts++;
      const qty = p.stock || 0;
      totalItems += qty;
      totalCostValue += qty * (p.avgCost || p.cost || 0);
      totalSaleValue += qty * (p.price || 0);
    }

    const potentialProfit = totalSaleValue - totalCostValue;
    const profitPercent = totalCostValue > 0 ? (potentialProfit / totalCostValue) * 100 : 0;

    return { totalCostValue, totalSaleValue, potentialProfit, profitPercent, totalItems, activeProducts };
  }, [products]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{c.stockValuation}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-accent/50">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">{c.costValue}</p>
            <p className="text-lg font-bold">{fmtMoney(data.totalCostValue)}</p>
          </div>
          <div className="p-3 rounded-lg bg-accent/50">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">{c.saleValue}</p>
            <p className="text-lg font-bold">{fmtMoney(data.totalSaleValue)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{c.potentialProfit}</span>
          <span className="font-bold text-green-600">{fmtMoney(data.potentialProfit)} ({data.profitPercent.toFixed(1)}%)</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{c.activeProducts.replace('{count}', String(data.activeProducts))}</span>
          <span>{c.unitsInStock.replace('{count}', data.totalItems.toLocaleString(locale))}</span>
        </div>
      </CardContent>
    </Card>
  );
}
