import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales, useProducts, useCategories } from '@/hooks/useERP';
import { Download, TrendingUp, Calendar, Package, Tags, Building2 } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek, 
         eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, isSameDay, 
         isSameWeek, isSameMonth, getWeek, getMonth, getYear } from 'date-fns';
import { enUS, pt } from 'date-fns/locale';
import { exportToExcel } from '@/lib/excel';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
         PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import { useTranslation } from '@/i18n';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export default function SalesAnalysisReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const dfLocale = language === 'pt' ? pt : enUS;
  const { branches, currentBranch, apiBranchId, canPickBranch } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  const { products } = useProducts(apiBranchId);
  const { categories } = useCategories();
  
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');

  useEffect(() => {
    if (!canPickBranch && currentBranch?.id) {
      setSelectedBranch(currentBranch.id);
    }
  }, [canPickBranch, currentBranch?.id]);
  const [viewTab, setViewTab] = useState('summary');

  const filteredSales = useMemo(() => {
    return sales.filter(sale => {
      const saleDate = sale.createdAt.split('T')[0];
      const matchesDate = saleDate >= dateFrom && saleDate <= dateTo;
      const matchesBranch = selectedBranch === 'all' || sale.branchId === selectedBranch;
      const matchesStatus = sale.status === 'completed';
      return matchesDate && matchesBranch && matchesStatus;
    });
  }, [sales, dateFrom, dateTo, selectedBranch]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const totalRevenue = filteredSales.reduce((sum, s) => sum + s.total, 0);
    const totalTransactions = filteredSales.length;
    const totalItems = filteredSales.reduce((sum, s) => sum + s.items.reduce((itemSum, i) => itemSum + i.quantity, 0), 0);
    const totalTax = filteredSales.reduce((sum, s) => sum + s.taxAmount, 0);
    const avgTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    
    const byPaymentMethod = {
      cash: filteredSales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.total, 0),
      card: filteredSales.filter(s => s.paymentMethod === 'card').reduce((sum, s) => sum + s.total, 0),
      transfer: filteredSales.filter(s => s.paymentMethod === 'transfer').reduce((sum, s) => sum + s.total, 0),
    };
    
    return { totalRevenue, totalTransactions, totalItems, totalTax, avgTicket, byPaymentMethod };
  }, [filteredSales]);

  // Sales by date
  const salesByDate = useMemo(() => {
    const interval = { start: parseISO(dateFrom), end: parseISO(dateTo) };
    
    let dates: Date[];
    if (groupBy === 'day') {
      dates = eachDayOfInterval(interval);
    } else if (groupBy === 'week') {
      dates = eachWeekOfInterval(interval);
    } else {
      dates = eachMonthOfInterval(interval);
    }
    
    return dates.map(date => {
      const periodSales = filteredSales.filter(sale => {
        const saleDate = parseISO(sale.createdAt);
        if (groupBy === 'day') return isSameDay(saleDate, date);
        if (groupBy === 'week') return isSameWeek(saleDate, date);
        return isSameMonth(saleDate, date);
      });
      
      return {
        date,
        label: groupBy === 'day' ? format(date, 'dd/MM', { locale: dfLocale }) :
               groupBy === 'week' ? t.salesAnalysisUi.weekLabel.replace('{week}', String(getWeek(date))) :
               format(date, 'MMM/yy', { locale: dfLocale }),
        revenue: periodSales.reduce((sum, s) => sum + s.total, 0),
        transactions: periodSales.length,
        items: periodSales.reduce((sum, s) => sum + s.items.reduce((itemSum, i) => itemSum + i.quantity, 0), 0),
      };
    });
  }, [filteredSales, dateFrom, dateTo, groupBy]);

  // Sales by product
  const salesByProduct = useMemo(() => {
    const productMap: Record<string, { name: string; quantity: number; revenue: number; cost: number }> = {};
    
    filteredSales.forEach(sale => {
      sale.items.forEach(item => {
        if (!productMap[item.productId]) {
          const product = products.find(p => p.id === item.productId);
          productMap[item.productId] = {
            name: item.productName,
            quantity: 0,
            revenue: 0,
            cost: product?.avgCost || product?.cost || 0,
          };
        }
        productMap[item.productId].quantity += item.quantity;
        productMap[item.productId].revenue += item.subtotal + item.taxAmount;
      });
    });
    
    return Object.entries(productMap)
      .map(([id, data]) => ({
        id,
        ...data,
        profit: data.revenue - (data.cost * data.quantity),
        margin: data.revenue > 0 ? ((data.revenue - (data.cost * data.quantity)) / data.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales, products]);

  // Sales by category
  const salesByCategory = useMemo(() => {
    const categoryMap: Record<string, { name: string; quantity: number; revenue: number }> = {};
    
    filteredSales.forEach(sale => {
      sale.items.forEach(item => {
        const product = products.find(p => p.id === item.productId);
        const categoryName = product?.category || t.salesAnalysisUi.noCategory;
        
        if (!categoryMap[categoryName]) {
          categoryMap[categoryName] = { name: categoryName, quantity: 0, revenue: 0 };
        }
        categoryMap[categoryName].quantity += item.quantity;
        categoryMap[categoryName].revenue += item.subtotal + item.taxAmount;
      });
    });
    
    return Object.values(categoryMap).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales, products]);

  // Sales by branch
  const salesByBranch = useMemo(() => {
    const branchMap: Record<string, { name: string; transactions: number; revenue: number }> = {};
    
    filteredSales.forEach(sale => {
      const branch = branches.find(b => b.id === sale.branchId);
      const branchName = branch?.name || t.common.unknown;
      
      if (!branchMap[sale.branchId]) {
        branchMap[sale.branchId] = { name: branchName, transactions: 0, revenue: 0 };
      }
      branchMap[sale.branchId].transactions += 1;
      branchMap[sale.branchId].revenue += sale.total;
    });
    
    return Object.values(branchMap).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales, branches]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(locale, { 
      style: 'currency', 
      currency: 'AOA',
      minimumFractionDigits: 0 
    }).format(value);
  };

  const handleExport = (type: string) => {
    let data: Record<string, unknown>[] = [];
    let filename = '';
    
    if (type === 'summary') {
      data = salesByDate.map(d => ({
        [t.salesAnalysisUi.colPeriod]: d.label,
        [t.salesAnalysisUi.colRevenue]: d.revenue,
        [t.salesAnalysisUi.colTransactions]: d.transactions,
        [t.salesAnalysisUi.colItemsSold]: d.items,
      }));
      filename = `Vendas_Resumo_${format(new Date(), 'yyyyMMdd')}`;
    } else if (type === 'products') {
      data = salesByProduct.map(p => ({
        [t.common.product]: p.name,
        [t.common.quantity]: p.quantity,
        [t.salesAnalysisUi.colRevenue]: p.revenue,
        [t.salesAnalysisUi.colCost]: p.cost * p.quantity,
        [t.salesAnalysisUi.colProfit]: p.profit,
        [t.salesAnalysisUi.colMarginPercent]: p.margin.toFixed(2),
      }));
      filename = `Vendas_Produtos_${format(new Date(), 'yyyyMMdd')}`;
    } else if (type === 'categories') {
      data = salesByCategory.map(c => ({
        [t.salesAnalysisUi.colCategory]: c.name,
        [t.common.quantity]: c.quantity,
        [t.salesAnalysisUi.colRevenue]: c.revenue,
      }));
      filename = `Vendas_Categorias_${format(new Date(), 'yyyyMMdd')}`;
    }
    
    exportToExcel(data, filename);
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            {t.salesAnalysisUi.title}
          </CardTitle>
          <CardDescription>
            {t.salesAnalysisUi.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <Label>{t.reportsUi.dateFrom}</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <Label>{t.reportsUi.dateTo}</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <Label>{t.salesAnalysisUi.branch}</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={!canPickBranch}>
                <SelectTrigger>
                  <SelectValue placeholder={t.common.all} />
                </SelectTrigger>
                <SelectContent>
                  {canPickBranch && <SelectItem value="all">{t.salesAnalysisUi.allBranches}</SelectItem>}
                  {(canPickBranch ? branches : currentBranch ? [currentBranch] : []).map(branch => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.salesAnalysisUi.groupBy}</Label>
              <Select value={groupBy} onValueChange={(v: 'day' | 'week' | 'month') => setGroupBy(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">{t.salesAnalysisUi.groupDay}</SelectItem>
                  <SelectItem value="week">{t.salesAnalysisUi.groupWeek}</SelectItem>
                  <SelectItem value="month">{t.salesAnalysisUi.groupMonth}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => handleExport('summary')}>
                <Download className="w-4 h-4 mr-2" />
                {t.common.export}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesAnalysisUi.totalRevenue}</p>
            <p className="text-2xl font-bold">{formatCurrency(summaryStats.totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesAnalysisUi.transactions}</p>
            <p className="text-2xl font-bold">{summaryStats.totalTransactions}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesAnalysisUi.itemsSold}</p>
            <p className="text-2xl font-bold">{summaryStats.totalItems}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesAnalysisUi.taxCollected}</p>
            <p className="text-2xl font-bold">{formatCurrency(summaryStats.totalTax)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesAnalysisUi.avgTicket}</p>
            <p className="text-2xl font-bold">{formatCurrency(summaryStats.avgTicket)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for different views */}
      <Tabs value={viewTab} onValueChange={setViewTab}>
        <TabsList>
          <TabsTrigger value="summary">
            <Calendar className="w-4 h-4 mr-2" />
            {t.salesAnalysisUi.tabByPeriod}
          </TabsTrigger>
          <TabsTrigger value="products">
            <Package className="w-4 h-4 mr-2" />
            {t.salesAnalysisUi.tabByProduct}
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Tags className="w-4 h-4 mr-2" />
            {t.salesAnalysisUi.tabByCategory}
          </TabsTrigger>
          <TabsTrigger value="branches">
            <Building2 className="w-4 h-4 mr-2" />
            {t.salesAnalysisUi.tabByBranch}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          {/* Revenue Chart */}
          <Card>
            <CardHeader>
              <CardTitle>{t.salesAnalysisUi.salesEvolution}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salesByDate}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" name={t.salesAnalysisUi.colRevenue} stroke="#3b82f6" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Payment Methods */}
          <Card>
            <CardHeader>
              <CardTitle>{t.salesAnalysisUi.byPaymentMethod}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-green-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.chartsUi.methodCash}</p>
                  <p className="text-xl font-bold text-green-500">{formatCurrency(summaryStats.byPaymentMethod.cash)}</p>
                </div>
                <div className="p-4 bg-blue-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.chartsUi.methodCard}</p>
                  <p className="text-xl font-bold text-blue-500">{formatCurrency(summaryStats.byPaymentMethod.card)}</p>
                </div>
                <div className="p-4 bg-purple-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.chartsUi.methodTransfer}</p>
                  <p className="text-xl font-bold text-purple-500">{formatCurrency(summaryStats.byPaymentMethod.transfer)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>{t.salesAnalysisUi.salesByProduct}</CardTitle>
                <Button variant="outline" size="sm" onClick={() => handleExport('products')}>
                  <Download className="w-4 h-4 mr-2" />
                  Excel
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.common.product}</TableHead>
                    <TableHead className="text-right">{t.common.qty}</TableHead>
                    <TableHead className="text-right">{t.salesAnalysisUi.colRevenue}</TableHead>
                    <TableHead className="text-right">{t.salesAnalysisUi.colCost}</TableHead>
                    <TableHead className="text-right">{t.salesAnalysisUi.colProfit}</TableHead>
                    <TableHead className="text-right">{t.salesAnalysisUi.colMargin}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesByProduct.slice(0, 20).map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell className="text-right">{product.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(product.revenue)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(product.cost * product.quantity)}</TableCell>
                      <TableCell className={`text-right ${product.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {formatCurrency(product.profit)}
                      </TableCell>
                      <TableCell className={`text-right ${product.margin >= 20 ? 'text-green-500' : 'text-orange-500'}`}>
                        {product.margin.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t.salesAnalysisUi.salesByCategory}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={salesByCategory}
                        dataKey="revenue"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {salesByCategory.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>{t.salesAnalysisUi.table}</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => handleExport('categories')}>
                    <Download className="w-4 h-4 mr-2" />
                    Excel
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.salesAnalysisUi.colCategory}</TableHead>
                      <TableHead className="text-right">{t.common.qty}</TableHead>
                      <TableHead className="text-right">{t.salesAnalysisUi.colRevenue}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salesByCategory.map((cat, index) => (
                      <TableRow key={cat.name}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full" 
                              style={{ backgroundColor: COLORS[index % COLORS.length] }}
                            />
                            {cat.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{cat.quantity}</TableCell>
                        <TableCell className="text-right">{formatCurrency(cat.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="branches">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t.salesAnalysisUi.salesByBranch}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesByBranch}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="revenue" name={t.salesAnalysisUi.colRevenue} fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t.salesAnalysisUi.table}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.salesAnalysisUi.branch}</TableHead>
                      <TableHead className="text-right">{t.salesAnalysisUi.transactions}</TableHead>
                      <TableHead className="text-right">{t.salesAnalysisUi.colRevenue}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salesByBranch.map((branch) => (
                      <TableRow key={branch.name}>
                        <TableCell className="font-medium">{branch.name}</TableCell>
                        <TableCell className="text-right">{branch.transactions}</TableCell>
                        <TableCell className="text-right">{formatCurrency(branch.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
