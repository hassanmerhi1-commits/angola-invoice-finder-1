import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales, useProducts, useCategories } from '@/hooks/useERP';
import { Download, PieChart, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { exportToExcel } from '@/lib/excel';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
         PieChart as RechartsPie, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

interface ProductProfitability {
  productId: string;
  productName: string;
  category: string;
  quantitySold: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  margin: number;
}

export default function ProfitabilityReport() {
  const { branches, currentBranch, apiBranchId, canPickBranch } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  const { products } = useProducts(apiBranchId);
  const { categories } = useCategories();
  
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'profit' | 'margin' | 'revenue'>('profit');

  useEffect(() => {
    if (!canPickBranch && currentBranch?.id) {
      setSelectedBranch(currentBranch.id);
    }
  }, [canPickBranch, currentBranch?.id]);

  const filteredSales = useMemo(() => {
    return sales.filter(sale => {
      const saleDate = sale.createdAt.split('T')[0];
      const matchesDate = saleDate >= dateFrom && saleDate <= dateTo;
      const matchesBranch = selectedBranch === 'all' || sale.branchId === selectedBranch;
      const matchesStatus = sale.status === 'completed';
      return matchesDate && matchesBranch && matchesStatus;
    });
  }, [sales, dateFrom, dateTo, selectedBranch]);

  // Calculate profitability by product
  const productProfitability = useMemo((): ProductProfitability[] => {
    const productMap: Record<string, ProductProfitability> = {};
    
    filteredSales.forEach(sale => {
      sale.items.forEach(item => {
        const product = products.find(p => p.id === item.productId);
        const cost = product?.avgCost || product?.lastCost || product?.cost || 0;
        
        if (!productMap[item.productId]) {
          productMap[item.productId] = {
            productId: item.productId,
            productName: item.productName,
            category: product?.category || 'Sem Categoria',
            quantitySold: 0,
            revenue: 0,
            cost: 0,
            grossProfit: 0,
            margin: 0,
          };
        }
        
        const revenue = item.subtotal;
        const itemCost = cost * item.quantity;
        
        productMap[item.productId].quantitySold += item.quantity;
        productMap[item.productId].revenue += revenue;
        productMap[item.productId].cost += itemCost;
      });
    });
    
    // Calculate profit and margin
    return Object.values(productMap)
      .map(p => ({
        ...p,
        grossProfit: p.revenue - p.cost,
        margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : 0,
      }))
      .sort((a, b) => {
        if (sortBy === 'profit') return b.grossProfit - a.grossProfit;
        if (sortBy === 'margin') return b.margin - a.margin;
        return b.revenue - a.revenue;
      });
  }, [filteredSales, products, sortBy]);

  // Category profitability
  const categoryProfitability = useMemo(() => {
    const categoryMap: Record<string, { name: string; revenue: number; cost: number; profit: number }> = {};
    
    productProfitability.forEach(product => {
      if (!categoryMap[product.category]) {
        categoryMap[product.category] = { name: product.category, revenue: 0, cost: 0, profit: 0 };
      }
      categoryMap[product.category].revenue += product.revenue;
      categoryMap[product.category].cost += product.cost;
      categoryMap[product.category].profit += product.grossProfit;
    });
    
    return Object.values(categoryMap)
      .map(c => ({
        ...c,
        margin: c.revenue > 0 ? (c.profit / c.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit);
  }, [productProfitability]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const totalRevenue = productProfitability.reduce((sum, p) => sum + p.revenue, 0);
    const totalCost = productProfitability.reduce((sum, p) => sum + p.cost, 0);
    const grossProfit = totalRevenue - totalCost;
    const avgMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    
    const profitableProducts = productProfitability.filter(p => p.grossProfit > 0).length;
    const unprofitableProducts = productProfitability.filter(p => p.grossProfit < 0).length;
    
    return { totalRevenue, totalCost, grossProfit, avgMargin, profitableProducts, unprofitableProducts };
  }, [productProfitability]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-AO', { 
      style: 'currency', 
      currency: 'AOA',
      minimumFractionDigits: 0 
    }).format(value);
  };

  const handleExport = () => {
    const data = productProfitability.map(p => ({
      'Produto': p.productName,
      'Categoria': p.category,
      'Qtd Vendida': p.quantitySold,
      'Receita': p.revenue,
      'Custo': p.cost,
      'Lucro Bruto': p.grossProfit,
      'Margem %': p.margin.toFixed(2),
    }));
    
    exportToExcel(data, `Rentabilidade_${format(new Date(), 'yyyyMMdd')}`);
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="w-5 h-5" />
            Análise de Rentabilidade
          </CardTitle>
          <CardDescription>
            Margens de lucro por produto e categoria
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <Label>Data Início</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <Label>Data Fim</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <Label>Filial</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={!canPickBranch}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  {canPickBranch && <SelectItem value="all">Todas as Filiais</SelectItem>}
                  {(canPickBranch ? branches : currentBranch ? [currentBranch] : []).map(branch => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ordenar Por</Label>
              <Select value={sortBy} onValueChange={(v: 'profit' | 'margin' | 'revenue') => setSortBy(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="profit">Lucro</SelectItem>
                  <SelectItem value="margin">Margem %</SelectItem>
                  <SelectItem value="revenue">Receita</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={handleExport}>
                <Download className="w-4 h-4 mr-2" />
                Exportar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Receita Total</p>
            <p className="text-2xl font-bold">{formatCurrency(summaryStats.totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Custo Total</p>
            <p className="text-2xl font-bold text-orange-500">{formatCurrency(summaryStats.totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              {summaryStats.grossProfit >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <p className="text-sm text-muted-foreground">Lucro Bruto</p>
            </div>
            <p className={`text-2xl font-bold ${summaryStats.grossProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(summaryStats.grossProfit)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Margem Média</p>
            <p className={`text-2xl font-bold ${summaryStats.avgMargin >= 20 ? 'text-green-500' : 'text-orange-500'}`}>
              {summaryStats.avgMargin.toFixed(1)}%
            </p>
            <div className="flex gap-4 mt-2 text-xs">
              <span className="text-green-500">{summaryStats.profitableProducts} rentáveis</span>
              <span className="text-red-500">{summaryStats.unprofitableProducts} negativos</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Category Profitability Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Lucro por Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryProfitability}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="profit" name="Lucro" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Margin Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Distribuição de Margens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPie>
                  <Pie
                    data={categoryProfitability}
                    dataKey="profit"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, margin }) => `${name} (${margin.toFixed(0)}%)`}
                  >
                    {categoryProfitability.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                </RechartsPie>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Product Table */}
      <Card>
        <CardHeader>
          <CardTitle>Rentabilidade por Produto</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Lucro</TableHead>
                <TableHead>Margem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productProfitability.slice(0, 20).map((product) => (
                <TableRow key={product.productId}>
                  <TableCell className="font-medium">{product.productName}</TableCell>
                  <TableCell>{product.category}</TableCell>
                  <TableCell className="text-right">{product.quantitySold}</TableCell>
                  <TableCell className="text-right">{formatCurrency(product.revenue)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(product.cost)}</TableCell>
                  <TableCell className={`text-right font-medium ${product.grossProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {formatCurrency(product.grossProfit)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress 
                        value={Math.max(0, Math.min(product.margin, 100))} 
                        className={`h-2 w-16 ${product.margin >= 30 ? '[&>div]:bg-green-500' : product.margin >= 15 ? '[&>div]:bg-yellow-500' : '[&>div]:bg-red-500'}`}
                      />
                      <span className={`text-sm ${product.margin >= 20 ? 'text-green-500' : product.margin >= 0 ? 'text-orange-500' : 'text-red-500'}`}>
                        {product.margin.toFixed(1)}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
