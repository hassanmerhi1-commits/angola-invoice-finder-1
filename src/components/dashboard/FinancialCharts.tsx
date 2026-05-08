import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/i18n';
import { isDemoMode } from '@/lib/api/config';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// ==================== DATA HELPERS ====================

function getSalesFromStorage() {
  if (!isDemoMode()) return [];
  try {
    const stored = localStorage.getItem('kwanzaerp_sales');
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function getExpensesFromStorage() {
  if (!isDemoMode()) return [];
  try {
    const stored = localStorage.getItem('kwanzaerp_expenses');
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function getProductsFromStorage() {
  if (!isDemoMode()) return [];
  try {
    const stored = localStorage.getItem('kwanzaerp_products');
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

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--destructive))',
  'hsl(142, 76%, 36%)',
  'hsl(38, 92%, 50%)',
  'hsl(262, 83%, 58%)',
  'hsl(199, 89%, 48%)',
];

// ==================== REVENUE VS EXPENSES CHART ====================

export function RevenueExpensesChart() {
  const data = useMemo(() => {
    const sales = getSalesFromStorage();
    const expenses = getExpensesFromStorage();
    const now = new Date();
    const year = now.getFullYear();

    return MONTHS_PT.map((month, i) => {
      const monthSales = sales.filter((s: any) => {
        const d = new Date(s.createdAt || s.date);
        return d.getFullYear() === year && d.getMonth() === i;
      });
      const monthExpenses = expenses.filter((e: any) => {
        const d = new Date(e.createdAt || e.requestedAt);
        return d.getFullYear() === year && d.getMonth() === i;
      });

      const revenue = monthSales.reduce((s: number, sale: any) => s + (sale.total || 0), 0);
      const expense = monthExpenses.reduce((s: number, exp: any) => s + (exp.totalAmount || exp.amount || 0), 0);

      return { month, receita: revenue, despesa: expense, lucro: revenue - expense };
    });
  }, []);

  const hasData = data.some(d => d.receita > 0 || d.despesa > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Receita vs Despesas ({new Date().getFullYear()})</CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number) => `${value.toLocaleString('pt-AO')} Kz`}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="receita" name="Receita" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesa" name="Despesas" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-60 flex items-center justify-center text-muted-foreground text-sm">
            Sem dados de vendas/despesas para gráfico
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== CASH FLOW TREND ====================

export function CashFlowChart() {
  const data = useMemo(() => {
    const sales = getSalesFromStorage();
    const expenses = getExpensesFromStorage();
    const now = new Date();
    const year = now.getFullYear();
    let runningBalance = 0;

    return MONTHS_PT.map((month, i) => {
      const inflow = sales.filter((s: any) => {
        const d = new Date(s.createdAt || s.date);
        return d.getFullYear() === year && d.getMonth() === i;
      }).reduce((s: number, sale: any) => s + (sale.total || 0), 0);

      const outflow = expenses.filter((e: any) => {
        const d = new Date(e.createdAt || e.requestedAt);
        return d.getFullYear() === year && d.getMonth() === i;
      }).reduce((s: number, exp: any) => s + (exp.totalAmount || exp.amount || 0), 0);

      runningBalance += inflow - outflow;
      return { month, entrada: inflow, saida: outflow, saldo: runningBalance };
    });
  }, []);

  const hasData = data.some(d => d.entrada > 0 || d.saida > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Fluxo de Caixa Acumulado</CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number) => `${value.toLocaleString('pt-AO')} Kz`}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Area type="monotone" dataKey="saldo" name="Saldo" fill="hsl(var(--primary) / 0.2)" stroke="hsl(var(--primary))" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-60 flex items-center justify-center text-muted-foreground text-sm">
            Sem dados de fluxo de caixa
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== TOP PRODUCTS BY PROFIT ====================

export function TopProductsChart() {
  const data = useMemo(() => {
    const sales = getSalesFromStorage();
    const productMap = new Map<string, { name: string; revenue: number; cost: number }>();

    for (const sale of sales) {
      for (const item of (sale.items || [])) {
        const key = item.productId || item.productName;
        const existing = productMap.get(key) || { name: item.productName || key, revenue: 0, cost: 0 };
        existing.revenue += (item.subtotal || item.unitPrice * item.quantity) || 0;
        existing.cost += ((item.costPrice || 0) * item.quantity) || 0;
        productMap.set(key, existing);
      }
    }

    return Array.from(productMap.values())
      .map(p => ({ ...p, margin: p.revenue - p.cost }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Top Produtos por Receita</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} className="fill-muted-foreground" />
              <Tooltip
                formatter={(value: number) => `${value.toLocaleString('pt-AO')} Kz`}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="revenue" name="Receita" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-60 flex items-center justify-center text-muted-foreground text-sm">
            Sem dados de produtos vendidos
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== AR AGING ====================

export function ARAgingChart() {
  const data = useMemo(() => {
    const sales = getSalesFromStorage();
    const now = new Date();

    const buckets = { current: 0, '30d': 0, '60d': 0, '90d': 0, '90d+': 0 };

    for (const sale of sales) {
      if (sale.paymentStatus === 'paid' || sale.status === 'paid') continue;
      const remaining = (sale.total || 0) - (sale.amountPaid || 0);
      if (remaining <= 0) continue;

      const saleDate = new Date(sale.createdAt || sale.date);
      const days = Math.floor((now.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24));

      if (days <= 0) buckets.current += remaining;
      else if (days <= 30) buckets['30d'] += remaining;
      else if (days <= 60) buckets['60d'] += remaining;
      else if (days <= 90) buckets['90d'] += remaining;
      else buckets['90d+'] += remaining;
    }

    return [
      { name: 'Corrente', value: buckets.current },
      { name: '1-30 dias', value: buckets['30d'] },
      { name: '31-60 dias', value: buckets['60d'] },
      { name: '61-90 dias', value: buckets['90d'] },
      { name: '90+ dias', value: buckets['90d+'] },
    ];
  }, []);

  const hasData = data.some(d => d.value > 0);
  const colors = ['hsl(142, 76%, 36%)', 'hsl(199, 89%, 48%)', 'hsl(38, 92%, 50%)', 'hsl(25, 95%, 53%)', 'hsl(var(--destructive))'];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Aging de Contas a Receber</CardTitle>
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
                <Tooltip formatter={(value: number) => `${value.toLocaleString('pt-AO')} Kz`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {data.map((item, i) => (
                <div key={item.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[i] }} />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="font-medium">{item.value.toLocaleString('pt-AO')} Kz</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            Sem contas a receber pendentes
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== DAILY SALES TREND (Last 14 days) ====================

export function DailySalesChart() {
  const data = useMemo(() => {
    const sales = getSalesFromStorage();
    const now = new Date();
    const days: { date: string; label: string; total: number; count: number }[] = [];

    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const label = `${d.getDate()}/${d.getMonth() + 1}`;

      const daySales = sales.filter((s: any) => {
        const sd = new Date(s.createdAt || s.date).toISOString().split('T')[0];
        return sd === dateStr;
      });

      days.push({
        date: dateStr,
        label,
        total: daySales.reduce((s: number, sale: any) => s + (sale.total || 0), 0),
        count: daySales.length,
      });
    }
    return days;
  }, []);

  const hasData = data.some(d => d.total > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Vendas Últimos 14 Dias</CardTitle>
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
                  `${value.toLocaleString('pt-AO')} Kz`,
                  name === 'total' ? 'Vendas' : name,
                ]}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Line type="monotone" dataKey="total" name="Vendas" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            Sem vendas nos últimos 14 dias
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== PROFIT MARGIN GAUGE ====================

export function ProfitMarginWidget() {
  const data = useMemo(() => {
    const sales = getSalesFromStorage();
    const products = getProductsFromStorage();
    const productCostMap = new Map<string, number>();
    for (const p of products) {
      productCostMap.set(p.id, p.avgCost || p.cost || 0);
    }

    let totalRevenue = 0;
    let totalCost = 0;

    for (const sale of sales) {
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
  }, []);

  const marginColor = data.margin >= 30 ? 'hsl(142, 76%, 36%)' : data.margin >= 15 ? 'hsl(38, 92%, 50%)' : 'hsl(var(--destructive))';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Margem de Lucro Bruto</CardTitle>
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
              <span className="text-muted-foreground">Receita Total</span>
              <span className="font-medium">{data.totalRevenue.toLocaleString('pt-AO')} Kz</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Custo Total</span>
              <span className="font-medium">{data.totalCost.toLocaleString('pt-AO')} Kz</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span className="font-semibold">Lucro Bruto</span>
              <span className="font-bold" style={{ color: marginColor }}>{data.grossProfit.toLocaleString('pt-AO')} Kz</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== PAYMENT METHOD BREAKDOWN ====================

export function PaymentMethodChart() {
  const { t } = useTranslation();
  const data = useMemo(() => {
    const sales = getSalesFromStorage();
    const methods: Record<string, { name: string; value: number; count: number }> = {
      cash: { name: t.chartsUi.methodCash, value: 0, count: 0 },
      card: { name: t.chartsUi.methodCard, value: 0, count: 0 },
      transfer: { name: t.chartsUi.methodTransfer, value: 0, count: 0 },
      mixed: { name: t.chartsUi.methodMixed, value: 0, count: 0 },
    };

    for (const sale of sales) {
      const method = sale.paymentMethod || 'cash';
      if (methods[method]) {
        methods[method].value += sale.total || 0;
        methods[method].count += 1;
      }
    }

    return Object.values(methods).filter(m => m.value > 0);
  }, []);

  const colors = ['hsl(142, 76%, 36%)', 'hsl(var(--primary))', 'hsl(38, 92%, 50%)', 'hsl(262, 83%, 58%)'];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{t.chartsUi.paymentMethods}</CardTitle>
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
                <Tooltip formatter={(value: number) => `${value.toLocaleString('pt-AO')} Kz`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
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
                    <span className="font-medium">{item.value.toLocaleString('pt-AO')} Kz</span>
                    <span className="text-muted-foreground ml-1">({item.count})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
            Sem dados de vendas
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== STOCK VALUATION SUMMARY ====================

export function StockValuationWidget() {
  const data = useMemo(() => {
    const products = getProductsFromStorage();
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
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Valorização de Stock</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-accent/50">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Valor ao Custo</p>
            <p className="text-lg font-bold">{data.totalCostValue.toLocaleString('pt-AO')} Kz</p>
          </div>
          <div className="p-3 rounded-lg bg-accent/50">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Valor de Venda</p>
            <p className="text-lg font-bold">{data.totalSaleValue.toLocaleString('pt-AO')} Kz</p>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Lucro Potencial</span>
          <span className="font-bold text-green-600">{data.potentialProfit.toLocaleString('pt-AO')} Kz ({data.profitPercent.toFixed(1)}%)</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{data.activeProducts} produtos activos</span>
          <span>{data.totalItems.toLocaleString('pt-AO')} unidades em stock</span>
        </div>
      </CardContent>
    </Card>
  );
}
