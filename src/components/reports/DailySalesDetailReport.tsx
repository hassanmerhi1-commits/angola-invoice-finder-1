import { useState, useRef, useMemo } from 'react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales, useProducts, useCategories } from '@/hooks/useERP';
import { Sale, SaleItem, Product } from '@/types/erp';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Printer, FileDown, Eye, TrendingUp, DollarSign, Package, Filter, X } from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { useTranslation } from '@/i18n';
import { printReport, saveReportPdf } from '@/lib/reportExport';

interface SaleItemDetail extends SaleItem {
  cost: number;
  profit: number;
  profitMargin: number;
  subtotalWithoutIVA: number;
  ivaAmount: number;
  category?: string;
}

interface DailySalesDetailReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: string;
  endDate: string;
  branchId?: string;
  branchName?: string;
}

export function DailySalesDetailReport({ 
  open, 
  onOpenChange, 
  startDate,
  endDate,
  branchId,
  branchName 
}: DailySalesDetailReportProps) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId, currentBranch } = useBranchScope();
  const effectiveBranchId = branchId ?? apiBranchId;
  const { sales } = useSales(effectiveBranchId, { light: false });
  const { products } = useProducts(effectiveBranchId, { light: true });
  const { categories } = useCategories();
  const printRef = useRef<HTMLDivElement>(null);
  
  // Filter states
  const [ivaFilter, setIvaFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [skuFilter, setSkuFilter] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const isDateRange = startDate !== endDate;

  const saleLocalDate = (createdAt: string) => {
    const d = new Date(createdAt);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const daySales = sales.filter((sale) => {
    const saleDate = saleLocalDate(sale.createdAt);
    return saleDate >= startDate && saleDate <= endDate;
  });

  // Create product lookups
  const productCostMap = new Map<string, number>();
  const productCategoryMap = new Map<string, string>();
  products.forEach(p => {
    productCostMap.set(p.id, p.avgCost || p.cost || 0);
    productCategoryMap.set(p.id, p.category || 'GERAL');
  });

  // Get unique IVA rates from sales
  const uniqueIvaRates = useMemo(() => {
    const rates = new Set<number>();
    daySales.forEach(sale => {
      sale.items.forEach(item => rates.add(item.taxRate));
    });
    return Array.from(rates).sort((a, b) => a - b);
  }, [daySales]);

  // Get unique categories from products in sales
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    daySales.forEach(sale => {
      sale.items.forEach(item => {
        const cat = productCategoryMap.get(item.productId);
        if (cat) cats.add(cat);
      });
    });
    return Array.from(cats).sort();
  }, [daySales, productCategoryMap]);

  // Process all sale items with cost and profit calculations
  const processedItems: SaleItemDetail[] = useMemo(() => {
    const items: SaleItemDetail[] = [];
    daySales.forEach(sale => {
      sale.items.forEach(item => {
        const cost = productCostMap.get(item.productId) || 0;
        const totalCost = cost * item.quantity;
        const subtotalWithoutIVA = item.subtotal / (1 + item.taxRate / 100);
        const ivaAmount = item.subtotal - subtotalWithoutIVA;
        const profit = subtotalWithoutIVA - totalCost;
        const profitMargin = subtotalWithoutIVA > 0 ? (profit / subtotalWithoutIVA) * 100 : 0;
        const category = productCategoryMap.get(item.productId) || 'GERAL';

        items.push({
          ...item,
          cost: totalCost,
          profit,
          profitMargin,
          subtotalWithoutIVA,
          ivaAmount,
          category,
        });
      });
    });
    return items;
  }, [daySales, productCostMap, productCategoryMap]);

  // Apply filters to processed items
  const filteredItems = useMemo(() => {
    return processedItems.filter(item => {
      // IVA filter
      if (ivaFilter !== 'all' && item.taxRate !== parseFloat(ivaFilter)) {
        return false;
      }
      // Category filter
      if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false;
      }
      // SKU filter
      if (skuFilter && !item.sku.toLowerCase().includes(skuFilter.toLowerCase()) && 
          !item.productName.toLowerCase().includes(skuFilter.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [processedItems, ivaFilter, categoryFilter, skuFilter]);

  // Aggregate filtered items by product
  const aggregatedByProduct = useMemo(() => {
    const aggregated = new Map<string, {
      sku: string;
      productName: string;
      quantity: number;
      unitPrice: number;
      cost: number;
      subtotalWithoutIVA: number;
      ivaAmount: number;
      subtotalWithIVA: number;
      profit: number;
      taxRate: number;
      category: string;
    }>();

    filteredItems.forEach(item => {
      const existing = aggregated.get(item.productId);
      if (existing) {
        existing.quantity += item.quantity;
        existing.cost += item.cost;
        existing.subtotalWithoutIVA += item.subtotalWithoutIVA;
        existing.ivaAmount += item.ivaAmount;
        existing.subtotalWithIVA += item.subtotal;
        existing.profit += item.profit;
      } else {
        aggregated.set(item.productId, {
          sku: item.sku,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          cost: item.cost,
          subtotalWithoutIVA: item.subtotalWithoutIVA,
          ivaAmount: item.ivaAmount,
          subtotalWithIVA: item.subtotal,
          profit: item.profit,
          taxRate: item.taxRate,
          category: item.category || 'GERAL',
        });
      }
    });

    return aggregated;
  }, [filteredItems]);

  const aggregatedItems = Array.from(aggregatedByProduct.values()).sort((a, b) => 
    b.subtotalWithIVA - a.subtotalWithIVA
  );

  // Calculate totals
  const totals = {
    quantity: aggregatedItems.reduce((sum, item) => sum + item.quantity, 0),
    cost: aggregatedItems.reduce((sum, item) => sum + item.cost, 0),
    subtotalWithoutIVA: aggregatedItems.reduce((sum, item) => sum + item.subtotalWithoutIVA, 0),
    ivaAmount: aggregatedItems.reduce((sum, item) => sum + item.ivaAmount, 0),
    subtotalWithIVA: aggregatedItems.reduce((sum, item) => sum + item.subtotalWithIVA, 0),
    profit: aggregatedItems.reduce((sum, item) => sum + item.profit, 0),
  };

  const profitMargin = totals.subtotalWithoutIVA > 0 
    ? (totals.profit / totals.subtotalWithoutIVA) * 100 
    : 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-AO', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    }).format(value);
  };

  const buildReportPrintHtml = () => {
    const printContent = printRef.current;
    if (!printContent) {
      console.warn('[DailySalesDetailReport] printRef is not ready');
      return null;
    }

    const dateLabel = isDateRange
      ? `${format(new Date(startDate), 'dd/MM/yyyy')} - ${format(new Date(endDate), 'dd/MM/yyyy')}`
      : format(new Date(startDate), 'dd/MM/yyyy');

    return `<!DOCTYPE html>
      <html>
      <head>
        <title>Relatório de Vendas - ${dateLabel}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: Arial, sans-serif;
            font-size: 10pt;
            padding: 20px;
            color: #000;
          }
          .header { text-align: center; margin-bottom: 20px; }
          .header h1 { font-size: 16pt; margin-bottom: 5px; }
          .header p { font-size: 10pt; color: #666; }
          .summary-cards {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 9pt;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 6px 8px;
            text-align: left;
          }
          th {
            background: #f5f5f5;
            font-weight: bold;
            font-size: 8pt;
          }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          tfoot td {
            font-weight: bold;
            background: #f9f9f9;
          }
          .section-title {
            font-size: 11pt;
            font-weight: bold;
            margin: 20px 0 10px 0;
            padding-bottom: 5px;
            border-bottom: 2px solid #000;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 8pt;
            color: #666;
          }
          @media print {
            body { padding: 0; }
            @page { margin: 15mm; }
          }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
        <div class="footer">
          <p>${t.reportsUi.generatedAt.replace('{date}', format(new Date(), "dd/MM/yyyy HH:mm", { locale: pt }))}</p>
          <p>${t.reportsUi.systemName}</p>
        </div>
      </body>
      </html>`;
  };

  const handlePrint = async () => {
    const html = buildReportPrintHtml();
    if (!html) return;
    try {
      await printReport(html);
    } catch (e) {
      console.error('[DailySalesDetailReport] print failed:', e);
    }
  };

  const handleSavePDF = async () => {
    const html = buildReportPrintHtml();
    if (!html) return;
    const dateLabel = isDateRange
      ? `${format(new Date(startDate), 'dd-MM-yyyy')}_${format(new Date(endDate), 'dd-MM-yyyy')}`
      : format(new Date(startDate), 'dd-MM-yyyy');
    try {
      await saveReportPdf(html, `daily-sales-report_${dateLabel}`, { landscape: true });
    } catch (e) {
      console.error('[DailySalesDetailReport] save pdf failed:', e);
    }
  };

  const hasActiveFilters = ivaFilter !== 'all' || categoryFilter !== 'all' || skuFilter !== '';

  const clearFilters = () => {
    setIvaFilter('all');
    setCategoryFilter('all');
    setSkuFilter('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{t.reportsUi.dailySalesDetailTitle}</span>
            <div className="flex gap-2">
              <Button 
                variant={showFilters ? "default" : "outline"} 
                size="sm" 
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="w-4 h-4 mr-2" />
                {t.common.filters}
                {hasActiveFilters && <Badge variant="secondary" className="ml-1 text-xs">{
                  [ivaFilter !== 'all', categoryFilter !== 'all', skuFilter !== ''].filter(Boolean).length
                }</Badge>}
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                {t.reportsUi.print}
              </Button>
              <Button variant="outline" size="sm" onClick={handleSavePDF}>
                <FileDown className="w-4 h-4 mr-2" />
                {t.reportsUi.savePdf}
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Filters Panel */}
        {showFilters && (
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  Filtros
                </span>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="w-4 h-4 mr-1" />
                    Limpar
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* IVA Filter */}
                <div className="space-y-2">
                  <Label htmlFor="iva-filter">{t.reportsUi.taxRateFilter}</Label>
                  <Select value={ivaFilter} onValueChange={setIvaFilter}>
                    <SelectTrigger id="iva-filter">
                      <SelectValue placeholder={t.reportsUi.allTaxRates} />
                    </SelectTrigger>
                    <SelectContent className="bg-background">
                      <SelectItem value="all">{t.reportsUi.allTaxRates}</SelectItem>
                      {uniqueIvaRates.map(rate => (
                        <SelectItem key={rate} value={String(rate)}>
                          {rate}% IVA
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Category Filter */}
                <div className="space-y-2">
                  <Label htmlFor="category-filter">{t.reportsUi.categoryFamily}</Label>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger id="category-filter">
                      <SelectValue placeholder={t.reportsUi.allCategories} />
                    </SelectTrigger>
                    <SelectContent className="bg-background">
                      <SelectItem value="all">{t.reportsUi.allCategories}</SelectItem>
                      {uniqueCategories.map(cat => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* SKU/Product Filter */}
                <div className="space-y-2">
                  <Label htmlFor="sku-filter">{t.reportsUi.codeProduct}</Label>
                  <Input
                    id="sku-filter"
                    placeholder={t.reportsUi.searchByCodeOrName}
                    value={skuFilter}
                    onChange={(e) => setSkuFilter(e.target.value)}
                  />
                </div>
              </div>

              {/* Active Filters Summary */}
              {hasActiveFilters && (
                <div className="mt-4 pt-3 border-t flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">{t.reportsUi.activeFilters}</span>
                  {ivaFilter !== 'all' && (
                    <Badge variant="secondary" className="gap-1">
                      IVA: {ivaFilter}%
                      <button onClick={() => setIvaFilter('all')}>
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  )}
                  {categoryFilter !== 'all' && (
                    <Badge variant="secondary" className="gap-1">
                      {categoryFilter}
                      <button onClick={() => setCategoryFilter('all')}>
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  )}
                  {skuFilter && (
                    <Badge variant="secondary" className="gap-1">
                      "{skuFilter}"
                      <button onClick={() => setSkuFilter('')}>
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  )}
                  <span className="text-sm text-muted-foreground ml-auto">
                    {t.reportsUi.productsFound.replace('{count}', String(aggregatedItems.length))}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div ref={printRef}>
          {/* Header */}
          <div className="header text-center mb-6">
            <h1 className="text-xl font-bold">RELATÓRIO DETALHADO DE VENDAS</h1>
            <p className="text-muted-foreground">
              {startDate && endDate ? (
                isDateRange ? (
                  <>Período: {format(new Date(startDate), "dd/MM/yyyy", { locale: pt })} - {format(new Date(endDate), "dd/MM/yyyy", { locale: pt })}</>
                ) : (
                  <>Data: {format(new Date(startDate), "dd 'de' MMMM 'de' yyyy", { locale: pt })}</>
                )
              ) : (
                <>Selecione um período</>
              )}
            </p>
            <p className="text-muted-foreground">
              Filial: {branchName || currentBranch?.name || t.dailyReportsUi.allBranches}
            </p>
            {hasActiveFilters && (
              <p className="text-sm text-muted-foreground mt-1">
                Filtros: {[
                  ivaFilter !== 'all' && `IVA ${ivaFilter}%`,
                  categoryFilter !== 'all' && categoryFilter,
                  skuFilter && `"${skuFilter}"`,
                ].filter(Boolean).join(', ')}
              </p>
            )}
          </div>

          {/* Summary Cards */}
          <div className="summary-cards grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Vendas (s/ IVA)</p>
                  <p className="text-lg font-bold">{formatCurrency(totals.subtotalWithoutIVA)} Kz</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">IVA Total</p>
                  <p className="text-lg font-bold">{formatCurrency(totals.ivaAmount)} Kz</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Total (c/ IVA)</p>
                  <p className="text-lg font-bold">{formatCurrency(totals.subtotalWithIVA)} Kz</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Lucro Bruto</p>
                  <p className={`text-lg font-bold ${totals.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(totals.profit)} Kz
                  </p>
                  <p className="text-xs text-muted-foreground">({profitMargin.toFixed(1)}% margem)</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Additional Summary */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Itens Vendidos</p>
                    <p className="text-lg font-bold">{totals.quantity}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Custo Total</p>
                    <p className="text-lg font-bold">{formatCurrency(totals.cost)} Kz</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Transações</p>
                    <p className="text-lg font-bold">{daySales.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator className="my-4" />

          {/* Detailed Items Table */}
          <div className="section-title font-bold text-lg mb-2 border-b-2 border-foreground pb-1">
            Detalhes por Produto
          </div>

          {aggregatedItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhuma venda encontrada para esta data
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Código</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-center">Qtd</TableHead>
                  <TableHead className="text-right">P. Unit.</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Subtotal (s/ IVA)</TableHead>
                  <TableHead className="text-center">IVA %</TableHead>
                  <TableHead className="text-right">IVA (Kz)</TableHead>
                  <TableHead className="text-right">Total (c/ IVA)</TableHead>
                  <TableHead className="text-right">Lucro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregatedItems.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.cost)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.subtotalWithoutIVA)}</TableCell>
                    <TableCell className="text-center">{item.taxRate}%</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.ivaAmount)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(item.subtotalWithIVA)}</TableCell>
                    <TableCell className={`text-right font-medium ${item.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(item.profit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-bold">TOTAIS</TableCell>
                  <TableCell className="text-center font-bold">{totals.quantity}</TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(totals.cost)}</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(totals.subtotalWithoutIVA)}</TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(totals.ivaAmount)}</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(totals.subtotalWithIVA)}</TableCell>
                  <TableCell className={`text-right font-bold ${totals.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(totals.profit)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}

          <Separator className="my-4" />

          {/* Sales by Transaction */}
          <div className="section-title font-bold text-lg mb-2 border-b-2 border-foreground pb-1">
            Vendas por Transação
          </div>

          {daySales.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhuma transação encontrada
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Factura</TableHead>
                  <TableHead>Hora</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead className="text-right">Subtotal (s/ IVA)</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daySales.map(sale => {
                  const saleSubtotal = sale.items.reduce((sum, item) => 
                    sum + (item.subtotal / (1 + item.taxRate / 100)), 0);
                  const saleIVA = sale.total - saleSubtotal;
                  
                  return (
                    <TableRow key={sale.id}>
                      <TableCell className="font-mono">{sale.invoiceNumber}</TableCell>
                      <TableCell>{format(new Date(sale.createdAt), 'HH:mm')}</TableCell>
                      <TableCell>{sale.customerName || t.reportsUi.finalConsumer}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {sale.paymentMethod === 'cash' ? t.chartsUi.methodCash :
                           sale.paymentMethod === 'card' ? t.chartsUi.methodCard :
                           sale.paymentMethod === 'transfer' ? t.chartsUi.methodTransfer :
                           sale.paymentMethod === 'credit' ? t.pos.credit : sale.paymentMethod}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(saleSubtotal)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(saleIVA)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(sale.total)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-bold">{t.common.total}</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(totals.subtotalWithoutIVA)}</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(totals.ivaAmount)}</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(totals.subtotalWithIVA)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
