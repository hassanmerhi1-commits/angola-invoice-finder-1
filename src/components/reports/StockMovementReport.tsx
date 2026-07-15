/**
 * Stock Movement Report
 * Shows inventory entries and exits from ALL sources:
 * purchases, sales, transfers, adjustments (entrada/saída)
 */

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Download, Printer, ArrowDownCircle, ArrowUpCircle, FileSpreadsheet, Package, Search } from 'lucide-react';
import { useProducts } from '@/hooks/useERP';
import { useBranchScope } from '@/hooks/useBranchScope';
import { api } from '@/lib/api/client';
import { getStockMovements as getLocalStockMovements } from '@/lib/storage';
import { StockMovement } from '@/types/erp';
import { useTranslation } from '@/i18n';

export default function StockMovementReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const branchFilter = apiBranchId;
  const { products } = useProducts(branchFilter, { light: true });
  
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [movementType, setMovementType] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Load real stock movements from storage
  useEffect(() => {
    const loadMovements = async () => {
      try {
        const result = await api.transactions.stockMovements({ warehouseId: branchFilter });
        if (result.data) {
          setMovements(result.data.map((m: any) => ({
            id: m.id, productId: m.product_id, productName: m.product_name,
            sku: m.sku, branchId: m.warehouse_id, type: m.movement_type,
            quantity: Number(m.quantity), reason: m.reference_type,
            referenceId: m.reference_id, referenceNumber: m.reference_number,
            costAtTime: Number(m.unit_cost || 0), notes: m.notes,
            createdBy: m.created_by, createdAt: m.created_at,
          })));
          return;
        }
      } catch { /* fall through */ }
      const data = await getLocalStockMovements(branchFilter);
      setMovements(data);
    };
    loadMovements();
  }, [branchFilter]);

  const getReasonLabel = (reason: string) => {
    switch (reason) {
      case 'purchase': return t.stockMovementUi.reasonPurchase;
      case 'sale': return t.stockMovementUi.reasonSale;
      case 'transfer_in': return t.stockMovementUi.reasonTransferIn;
      case 'transfer_out': return t.stockMovementUi.reasonTransferOut;
      case 'adjustment': return t.stockMovementUi.reasonAdjustment;
      case 'damage': return t.stockMovementUi.reasonDamage;
      case 'return': return t.stockMovementUi.reasonReturn;
      case 'initial': return t.stockMovementUi.reasonInitial;
      default: return reason;
    }
  };

  const getTypeBadgeColor = (type: string, reason: string) => {
    if (type === 'IN') {
      switch (reason) {
        case 'purchase': return 'bg-green-100 text-green-800';
        case 'transfer_in': return 'bg-blue-100 text-blue-800';
        case 'return': return 'bg-yellow-100 text-yellow-800';
        case 'adjustment': return 'bg-purple-100 text-purple-800';
        case 'initial': return 'bg-gray-100 text-gray-800';
        default: return 'bg-green-100 text-green-800';
      }
    }
    switch (reason) {
      case 'sale': return 'bg-red-100 text-red-800';
      case 'transfer_out': return 'bg-blue-100 text-blue-800';
      case 'damage': return 'bg-orange-100 text-orange-800';
      case 'adjustment': return 'bg-purple-100 text-purple-800';
      default: return 'bg-red-100 text-red-800';
    }
  };

  // Filter movements
  const filteredMovements = useMemo(() => {
    let result = [...movements];
    
    // Date filter
    result = result.filter(m => {
      const date = new Date(m.createdAt);
      return date >= new Date(startDate) && date <= new Date(endDate + 'T23:59:59');
    });
    
    // Type filter
    if (movementType !== 'all') {
      if (movementType === 'entry') result = result.filter(m => m.type === 'IN');
      else if (movementType === 'exit') result = result.filter(m => m.type === 'OUT');
      else result = result.filter(m => m.reason === movementType);
    }
    
    // Product filter
    if (selectedProduct !== 'all') {
      result = result.filter(m => m.productId === selectedProduct);
    }

    // Search filter
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(m =>
        m.productName.toLowerCase().includes(q) ||
        m.sku.toLowerCase().includes(q) ||
        (m.referenceNumber || '').toLowerCase().includes(q) ||
        (m.notes || '').toLowerCase().includes(q)
      );
    }

    // Sort by date descending
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    return result;
  }, [movements, startDate, endDate, movementType, selectedProduct, searchTerm]);

  // Totals
  const totals = useMemo(() => filteredMovements.reduce(
    (acc, m) => ({
      entries: acc.entries + (m.type === 'IN' ? m.quantity : 0),
      exits: acc.exits + (m.type === 'OUT' ? m.quantity : 0),
      entryValue: acc.entryValue + (m.type === 'IN' ? (m.costAtTime || 0) * m.quantity : 0),
      exitValue: acc.exitValue + (m.type === 'OUT' ? (m.costAtTime || 0) * m.quantity : 0),
    }),
    { entries: 0, exits: 0, entryValue: 0, exitValue: 0 }
  ), [filteredMovements]);

  const formatMoney = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 2 });

  const handlePrint = () => window.print();

  const handleExportExcel = () => {
    const headers = [
      t.common.date,
      t.stockMovementUi.colType,
      t.stockMovementUi.colReason,
      t.stockMovementUi.colDocument,
      'SKU',
      t.common.product,
      t.common.qty,
      t.stockMovementUi.colUnitCost,
      t.stockMovementUi.colTotalValue,
      t.common.notes,
    ];
    const rows = filteredMovements.map(m => [
      new Date(m.createdAt).toLocaleDateString(locale),
      m.type === 'IN' ? t.stockMovementUi.typeIn : t.stockMovementUi.typeOut,
      getReasonLabel(m.reason),
      m.referenceNumber || '',
      m.sku,
      m.productName,
      m.quantity,
      m.costAtTime || 0,
      (m.costAtTime || 0) * m.quantity,
      m.notes || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `movimentos_stock_${startDate}_${endDate}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="w-5 h-5" />
            {t.stockMovementUi.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">{t.reportsUi.dateFrom}</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.reportsUi.dateTo}</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.stockMovementUi.movementType}</Label>
              <Select value={movementType} onValueChange={setMovementType}>
                <SelectTrigger className="h-8 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.common.all}</SelectItem>
                  <SelectItem value="entry">{t.stockMovementUi.allEntries}</SelectItem>
                  <SelectItem value="exit">{t.stockMovementUi.allExits}</SelectItem>
                  <SelectItem value="purchase">{t.stockMovementUi.reasonPurchasePlural}</SelectItem>
                  <SelectItem value="sale">{t.stockMovementUi.reasonSalePlural}</SelectItem>
                  <SelectItem value="transfer_in">{t.stockMovementUi.reasonTransferInShort}</SelectItem>
                  <SelectItem value="transfer_out">{t.stockMovementUi.reasonTransferOutShort}</SelectItem>
                  <SelectItem value="adjustment">{t.stockMovementUi.reasonAdjustmentPlural}</SelectItem>
                  <SelectItem value="damage">{t.stockMovementUi.reasonDamage}</SelectItem>
                  <SelectItem value="return">{t.stockMovementUi.reasonReturnPlural}</SelectItem>
                  <SelectItem value="initial">{t.stockMovementUi.reasonInitial}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.common.product}</Label>
              <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                <SelectTrigger className="h-8 w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.stockMovementUi.allProducts}</SelectItem>
                  {products.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={t.stockMovementUi.searchPlaceholder} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9 h-8" />
            </div>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" /> {t.reportsUi.print}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportExcel}>
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <ArrowDownCircle className="w-5 h-5 text-green-500" />
              <p className="text-sm text-muted-foreground">{t.stockMovementUi.entries}</p>
            </div>
            <p className="text-2xl font-bold text-green-600">{totals.entries}</p>
            <p className="text-sm text-muted-foreground">{formatMoney(totals.entryValue)} Kz</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="w-5 h-5 text-red-500" />
              <p className="text-sm text-muted-foreground">{t.stockMovementUi.exits}</p>
            </div>
            <p className="text-2xl font-bold text-red-600">{totals.exits}</p>
            <p className="text-sm text-muted-foreground">{formatMoney(totals.exitValue)} Kz</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.stockMovementUi.netMovement}</p>
            <p className={`text-2xl font-bold ${totals.entries - totals.exits >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {totals.entries - totals.exits > 0 ? '+' : ''}{totals.entries - totals.exits}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.stockMovementUi.totalMovements}</p>
            <p className="text-2xl font-bold">{filteredMovements.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Movements Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>{t.stockMovementUi.colDateTime}</TableHead>
                  <TableHead>{t.stockMovementUi.colType}</TableHead>
                  <TableHead>{t.stockMovementUi.colReason}</TableHead>
                  <TableHead>{t.stockMovementUi.colDocument}</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>{t.common.product}</TableHead>
                  <TableHead className="text-right">{t.common.quantity}</TableHead>
                  <TableHead className="text-right">{t.stockMovementUi.colUnitCost}</TableHead>
                  <TableHead className="text-right">{t.stockMovementUi.colTotalValue}</TableHead>
                  <TableHead>{t.common.notes}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMovements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      {t.common.noResults}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMovements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-sm">
                        {new Date(m.createdAt).toLocaleDateString(locale)}<br />
                        <span className="text-xs text-muted-foreground">
                          {new Date(m.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={`flex items-center gap-1 w-fit ${getTypeBadgeColor(m.type, m.reason)}`}>
                          {m.type === 'IN' ? <ArrowDownCircle className="w-3 h-3" /> : <ArrowUpCircle className="w-3 h-3" />}
                          {m.type === 'IN' ? t.stockMovementUi.typeIn : t.stockMovementUi.typeOut}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{getReasonLabel(m.reason)}</TableCell>
                      <TableCell className="font-mono text-sm">{m.referenceNumber || t.common.dash}</TableCell>
                      <TableCell className="font-mono text-sm">{m.sku}</TableCell>
                      <TableCell>{m.productName}</TableCell>
                      <TableCell className={`text-right font-mono font-medium ${m.type === 'IN' ? 'text-green-600' : 'text-red-600'}`}>
                        {m.type === 'IN' ? '+' : '-'}{m.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {m.costAtTime ? formatMoney(m.costAtTime) + ' ' + t.common.currency : t.common.dash}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {m.costAtTime ? formatMoney(m.costAtTime * m.quantity) + ' ' + t.common.currency : t.common.dash}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {m.notes || t.common.dash}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
