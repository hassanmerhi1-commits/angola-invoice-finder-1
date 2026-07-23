/**
 * Stock Valuation Report
 * Shows inventory value by product/category
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, Printer, Package, FileSpreadsheet, FileDown, AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { buildDataTableHtml, exportReportExcel, printReport, saveReportPdf } from '@/lib/reportExport';
import { useProducts } from '@/hooks/useERP';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useTranslation } from '@/i18n';

export default function StockValuationReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { products } = useProducts(apiBranchId, { light: true });
  
  const [sortBy, setSortBy] = useState('value');
  const [filterCategory, setFilterCategory] = useState('all');
  const [showZeroStock, setShowZeroStock] = useState(false);

  // Get unique categories
  const categories = [...new Set(products.map(p => p.category))];

  // Filter and sort products
  let filteredProducts = [...products];
  
  if (filterCategory !== 'all') {
    filteredProducts = filteredProducts.filter(p => p.category === filterCategory);
  }
  
  if (!showZeroStock) {
    filteredProducts = filteredProducts.filter(p => p.stock > 0);
  }

  // Add calculated values — prefer weighted average cost for inventory valuation
  const productsWithValues = filteredProducts.map(p => {
    const unitCost = (p.avgCost != null && Number.isFinite(Number(p.avgCost)))
      ? Number(p.avgCost)
      : Number(p.cost) || 0;
    return {
      ...p,
      unitCost,
      costValue: p.stock * unitCost,
      saleValue: p.stock * p.price,
      potentialProfit: p.stock * (p.price - unitCost),
      margin: p.price > 0 ? ((p.price - unitCost) / p.price) * 100 : 0,
    };
  });

  // Sort
  productsWithValues.sort((a, b) => {
    switch (sortBy) {
      case 'value': return b.costValue - a.costValue;
      case 'quantity': return b.stock - a.stock;
      case 'margin': return b.margin - a.margin;
      case 'name': return a.name.localeCompare(b.name);
      default: return 0;
    }
  });

  // Totals
  const totals = productsWithValues.reduce(
    (acc, p) => ({
      quantity: acc.quantity + p.stock,
      costValue: acc.costValue + p.costValue,
      saleValue: acc.saleValue + p.saleValue,
      potentialProfit: acc.potentialProfit + p.potentialProfit,
    }),
    { quantity: 0, costValue: 0, saleValue: 0, potentialProfit: 0 }
  );

  // Category breakdown
  const categoryBreakdown = categories.map(cat => {
    const catProducts = productsWithValues.filter(p => p.category === cat);
    return {
      category: cat,
      count: catProducts.length,
      quantity: catProducts.reduce((sum, p) => sum + p.stock, 0),
      value: catProducts.reduce((sum, p) => sum + p.costValue, 0),
    };
  }).sort((a, b) => b.value - a.value);

  const formatMoney = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 2 });

  const excelData = productsWithValues.map((p) => ({
    SKU: p.sku,
    [t.common.product]: p.name,
    [t.stockValuationUi.category]: p.category,
    [t.stockValuationUi.stock]: p.stock,
    [t.stockValuationUi.unitCost]: p.unitCost,
    [t.stockValuationUi.unitPrice]: p.price,
    [t.stockValuationUi.costValue]: p.costValue,
    [t.stockValuationUi.saleValue]: p.saleValue,
    [t.stockValuationUi.marginPercent]: Number(p.margin.toFixed(1)),
  }));

  const previewMeta = { title: t.stockValuationUi.title, landscape: true as const };
  const exportFilename = `valorizacao_stock_${new Date().toISOString().split('T')[0]}`;

  const handlePrint = async () => {
    if (excelData.length === 0) return;
    try {
      await printReport(buildDataTableHtml(excelData, previewMeta));
    } catch (e) {
      console.error('[StockValuationReport] print failed:', e);
    }
  };

  const handleSavePdf = async () => {
    if (excelData.length === 0) return;
    try {
      await saveReportPdf(buildDataTableHtml(excelData, previewMeta), exportFilename, { landscape: true });
    } catch (e) {
      console.error('[StockValuationReport] save pdf failed:', e);
    }
  };

  const handleExportExcel = async () => {
    try {
      await exportReportExcel(excelData, exportFilename, previewMeta);
    } catch (e) {
      console.error('[StockValuationReport] excel export failed:', e);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="w-5 h-5" />
            {t.stockValuationUi.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">{t.stockValuationUi.category}</Label>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.common.all}</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.stockValuationUi.sortBy}</Label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="value">{t.stockValuationUi.sortValue}</SelectItem>
                  <SelectItem value="quantity">{t.stockValuationUi.sortQuantity}</SelectItem>
                  <SelectItem value="margin">{t.stockValuationUi.sortMargin}</SelectItem>
                  <SelectItem value="name">{t.common.name}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="showZero"
                checked={showZeroStock}
                onChange={(e) => setShowZeroStock(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="showZero" className="text-xs">{t.stockValuationUi.showZeroStock}</Label>
            </div>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => void handlePrint()} disabled={excelData.length === 0}>
                <Printer className="w-4 h-4 mr-2" />
                {t.reportsUi.print}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleSavePdf()} disabled={excelData.length === 0}>
                <FileDown className="w-4 h-4 mr-2" />
                {t.reportsUi.savePdf}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleExportExcel()} disabled={excelData.length === 0}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.stockValuationUi.totalCostValue}</p>
            <p className="text-2xl font-bold">{formatMoney(totals.costValue)} {t.common.currency}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.stockValuationUi.totalSaleValue}</p>
            <p className="text-2xl font-bold text-blue-600">{formatMoney(totals.saleValue)} {t.common.currency}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.stockValuationUi.potentialProfit}</p>
            <p className="text-2xl font-bold text-green-600">{formatMoney(totals.potentialProfit)} {t.common.currency}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.stockValuationUi.itemsInStock}</p>
            <p className="text-2xl font-bold">{totals.quantity.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{t.stockValuationUi.productsCount.replace('{count}', String(productsWithValues.length))}</p>
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">{t.stockValuationUi.byCategory}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {categoryBreakdown.map(cat => (
              <div key={cat.category} className="px-3 py-2 bg-muted rounded-lg text-sm">
                <p className="font-medium">{cat.category}</p>
                <p className="text-xs text-muted-foreground">
                  {t.stockValuationUi.categoryProductsValue.replace('{count}', String(cat.count)).replace('{value}', `${formatMoney(cat.value)} ${t.common.currency}`)}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stock Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>SKU</TableHead>
                  <TableHead>{t.common.product}</TableHead>
                  <TableHead>{t.stockValuationUi.category}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.stock}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.unitCost}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.unitPrice}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.costValue}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.saleValue}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.margin}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productsWithValues.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {product.name}
                        {product.stock <= 5 && product.stock > 0 && (
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                        )}
                        {product.stock === 0 && (
                          <Badge variant="destructive" className="text-xs">{t.stockValuationUi.noStock}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{product.category}</TableCell>
                    <TableCell className="text-right font-mono">
                      {product.stock} {product.unit}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatMoney(product.unitCost)} {t.common.currency}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatMoney(product.price)} {t.common.currency}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatMoney(product.costValue)} {t.common.currency}
                    </TableCell>
                    <TableCell className="text-right font-mono text-blue-600">
                      {formatMoney(product.saleValue)} {t.common.currency}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {product.margin >= 20 ? (
                          <TrendingUp className="w-4 h-4 text-green-500" />
                        ) : product.margin < 10 ? (
                          <TrendingDown className="w-4 h-4 text-red-500" />
                        ) : null}
                        <span className={`font-mono ${product.margin >= 20 ? 'text-green-600' : product.margin < 10 ? 'text-red-600' : ''}`}>
                          {product.margin.toFixed(1)}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals */}
                <TableRow className="bg-primary/10 font-bold">
                  <TableCell colSpan={3} className="text-right">{t.stockValuationUi.totals}</TableCell>
                  <TableCell className="text-right font-mono">{totals.quantity.toLocaleString()}</TableCell>
                  <TableCell colSpan={2}></TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(totals.costValue)} {t.common.currency}</TableCell>
                  <TableCell className="text-right font-mono text-blue-600">{formatMoney(totals.saleValue)} {t.common.currency}</TableCell>
                  <TableCell className="text-right font-mono text-green-600">
                    {totals.costValue > 0 ? ((totals.potentialProfit / totals.costValue) * 100).toFixed(1) : 0}%
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
