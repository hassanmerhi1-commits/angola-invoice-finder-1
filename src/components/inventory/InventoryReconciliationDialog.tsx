import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ClipboardCheck, Search, AlertTriangle, CheckCircle, XCircle, ArrowUp, ArrowDown, Minus, Save } from 'lucide-react';
import { Product, Branch } from '@/types/erp';
import { toast } from 'sonner';
import { logTransaction } from '@/lib/transactionHistory';
import { useTranslation } from '@/i18n';

// Generate reconciliation number
function generateReconciliationNumber(branchCode: string): string {
  const date = format(new Date(), 'yyyyMMdd');
  const seq = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `REC-${branchCode || 'XX'}-${date}-${seq}`;
}

interface CountEntry {
  productId: string;
  sku: string;
  name: string;
  systemStock: number;
  countedStock: number | null;
  difference: number;
  unit: string;
  cost: number;
}

interface InventoryReconciliationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  branch: Branch | null;
  categories: string[];
  onReconcile: (adjustments: Array<{
    productId: string;
    sku: string;
    name: string;
    previousStock: number;
    countedStock: number;
    difference: number;
    reason: string;
  }>) => void;
  currentUser?: string;
}

export function InventoryReconciliationDialog({
  open,
  onOpenChange,
  products,
  branch,
  categories,
  onReconcile,
  currentUser,
}: InventoryReconciliationDialogProps) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const resolvedUser = currentUser ?? t.reconcileUi.defaultUser;
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [countEntries, setCountEntries] = useState<Map<string, number | null>>(new Map());
  const [reconciliationNotes, setReconciliationNotes] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [countedBy, setCountedBy] = useState('');

  // Generate reconciliation number
  const reconciliationNumber = useMemo(() => 
    generateReconciliationNumber(branch?.code || ''),
    [branch?.code]
  );

  // Filter products
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (!p.isActive) return false;
      if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return p.sku.toLowerCase().includes(term) || 
               p.name.toLowerCase().includes(term) ||
               (p.barcode && p.barcode.includes(term));
      }
      return true;
    }).sort((a, b) => a.sku.localeCompare(b.sku));
  }, [products, selectedCategory, searchTerm]);

  // Calculate count entries with differences
  const entries: CountEntry[] = useMemo(() => {
    return filteredProducts.map(p => {
      const countedStock = countEntries.get(p.id) ?? null;
      const difference = countedStock !== null ? countedStock - p.stock : 0;
      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        systemStock: p.stock,
        countedStock,
        difference,
        unit: p.unit,
        cost: p.cost || 0,
      };
    });
  }, [filteredProducts, countEntries]);

  // Summary statistics
  const summary = useMemo(() => {
    const counted = entries.filter(e => e.countedStock !== null);
    const withDifference = counted.filter(e => e.difference !== 0);
    const positive = withDifference.filter(e => e.difference > 0);
    const negative = withDifference.filter(e => e.difference < 0);
    
    const totalDifferenceUnits = withDifference.reduce((sum, e) => sum + Math.abs(e.difference), 0);
    const totalDifferenceValue = withDifference.reduce((sum, e) => sum + (e.difference * e.cost), 0);
    
    return {
      total: entries.length,
      counted: counted.length,
      withDifference: withDifference.length,
      positive: positive.length,
      negative: negative.length,
      totalDifferenceUnits,
      totalDifferenceValue,
    };
  }, [entries]);

  // Handle count input
  const handleCountChange = useCallback((productId: string, value: string) => {
    setCountEntries(prev => {
      const next = new Map(prev);
      if (value === '' || value === null) {
        next.delete(productId);
      } else {
        const num = parseInt(value, 10);
        if (!isNaN(num) && num >= 0) {
          next.set(productId, num);
        }
      }
      return next;
    });
  }, []);

  // Set count equal to system stock
  const handleSetEqual = useCallback((productId: string, systemStock: number) => {
    setCountEntries(prev => {
      const next = new Map(prev);
      next.set(productId, systemStock);
      return next;
    });
  }, []);

  // Clear all counts
  const handleClearAll = useCallback(() => {
    setCountEntries(new Map());
  }, []);

  // Handle reconciliation
  const handleReconcile = () => {
    const adjustments = entries
      .filter(e => e.countedStock !== null && e.difference !== 0)
      .map(e => ({
        productId: e.productId,
        sku: e.sku,
        name: e.name,
        previousStock: e.systemStock,
        countedStock: e.countedStock!,
        difference: e.difference,
        reason: e.difference > 0 ? t.reconcileUi.reasonPositive : t.reconcileUi.reasonNegative,
      }));

    if (adjustments.length === 0) {
      toast.info(t.reconcileUi.noDifferences);
      return;
    }

    setShowConfirmDialog(true);
  };

  const confirmReconciliation = () => {
    const adjustments = entries
      .filter(e => e.countedStock !== null && e.difference !== 0)
      .map(e => ({
        productId: e.productId,
        sku: e.sku,
        name: e.name,
        previousStock: e.systemStock,
        countedStock: e.countedStock!,
        difference: e.difference,
        reason: e.difference > 0 ? t.reconcileUi.reasonPositive : t.reconcileUi.reasonNegative,
      }));

    // Record transaction for audit
    logTransaction({
      category: 'inventory',
      action: 'stock_adjusted',
      entityType: 'reconciliation',
      entityNumber: reconciliationNumber,
      description: t.reconcileUi.auditDescription.replace('{count}', String(adjustments.length)),
      details: {
        countedBy,
        notes: reconciliationNotes,
        adjustmentsCount: adjustments.length,
        totalDifferenceValue: summary.totalDifferenceValue,
        adjustments: adjustments.map(a => ({
          sku: a.sku,
          previous: a.previousStock,
          counted: a.countedStock,
          diff: a.difference,
        })),
      },
    });

    // Call parent handler to apply adjustments
    onReconcile(adjustments);

    toast.success(t.reconcileUi.reconciliationDone, {
      description: t.reconcileUi.reconciliationDoneDesc
        .replace('{count}', String(adjustments.length))
        .replace('{ref}', reconciliationNumber),
    });

    setShowConfirmDialog(false);
    setCountEntries(new Map());
    setReconciliationNotes('');
    onOpenChange(false);
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA' }).format(value);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              {t.reconcileUi.title}
            </DialogTitle>
            <DialogDescription>
              {t.reconcileUi.description}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-hidden">
            {/* Filters and Info */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t.reconcileUi.reference}</Label>
                <div className="font-mono text-sm font-medium bg-muted px-2 py-1.5 rounded">
                  {reconciliationNumber}
                </div>
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t.reconcileUi.branch}</Label>
                <div className="text-sm font-medium bg-muted px-2 py-1.5 rounded">
                  {branch?.name || t.reconcileUi.all}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="category">{t.reconcileUi.category}</Label>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger id="category" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg z-50">
                    <SelectItem value="all">{t.reconcileUi.all}</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="search">{t.reconcileUi.search}</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="search"
                    placeholder={t.reconcileUi.searchPlaceholder}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold">{summary.total}</div>
                <div className="text-xs text-muted-foreground">{t.reconcileUi.totalProducts}</div>
              </div>
              <div className="bg-blue-500/10 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-blue-600">{summary.counted}</div>
                <div className="text-xs text-muted-foreground">{t.reconcileUi.counted}</div>
              </div>
              <div className="bg-orange-500/10 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-orange-600">{summary.withDifference}</div>
                <div className="text-xs text-muted-foreground">{t.reconcileUi.withDifference}</div>
              </div>
              <div className="bg-emerald-500/10 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-emerald-600">+{summary.positive}</div>
                <div className="text-xs text-muted-foreground">{t.reconcileUi.excess}</div>
              </div>
              <div className="bg-red-500/10 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-red-600">-{summary.negative}</div>
                <div className="text-xs text-muted-foreground">{t.reconcileUi.missing}</div>
              </div>
            </div>

            {/* Products List */}
            <ScrollArea className="flex-1 border rounded-lg" style={{ height: '300px' }}>
              <div className="p-2">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background border-b">
                    <tr>
                      <th className="text-left py-2 px-2 font-medium w-24">{t.reconcileUi.colCode}</th>
                      <th className="text-left py-2 px-2 font-medium">{t.reconcileUi.colDescription}</th>
                      <th className="text-center py-2 px-2 font-medium w-20">{t.reconcileUi.colSystem}</th>
                      <th className="text-center py-2 px-2 font-medium w-28">{t.reconcileUi.colCount}</th>
                      <th className="text-center py-2 px-2 font-medium w-20">{t.reconcileUi.colDifference}</th>
                      <th className="text-center py-2 px-2 font-medium w-16">{t.reconcileUi.colAction}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr 
                        key={entry.productId} 
                        className={`border-b last:border-0 hover:bg-muted/50 ${
                          entry.countedStock !== null && entry.difference !== 0
                            ? entry.difference > 0 
                              ? 'bg-emerald-500/5' 
                              : 'bg-red-500/5'
                            : ''
                        }`}
                      >
                        <td className="py-2 px-2 font-mono text-xs">{entry.sku}</td>
                        <td className="py-2 px-2 truncate max-w-[200px]" title={entry.name}>
                          {entry.name}
                        </td>
                        <td className="py-2 px-2 text-center font-medium">
                          {entry.systemStock}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <Input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={entry.countedStock ?? ''}
                            onChange={(e) => handleCountChange(entry.productId, e.target.value)}
                            className="h-8 w-20 text-center mx-auto"
                            placeholder="—"
                          />
                        </td>
                        <td className="py-2 px-2 text-center">
                          {entry.countedStock !== null && (
                            <Badge 
                              variant={entry.difference === 0 ? 'secondary' : 'outline'}
                              className={`font-mono ${
                                entry.difference > 0 
                                  ? 'bg-emerald-100 text-emerald-700 border-emerald-300' 
                                  : entry.difference < 0
                                  ? 'bg-red-100 text-red-700 border-red-300'
                                  : ''
                              }`}
                            >
                              {entry.difference > 0 && <ArrowUp className="w-3 h-3 mr-1" />}
                              {entry.difference < 0 && <ArrowDown className="w-3 h-3 mr-1" />}
                              {entry.difference === 0 && <Minus className="w-3 h-3 mr-1" />}
                              {entry.difference > 0 ? '+' : ''}{entry.difference}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleSetEqual(entry.productId, entry.systemStock)}
                            title={t.reconcileUi.markEqual}
                          >
                            <CheckCircle className="w-4 h-4 text-muted-foreground hover:text-emerald-600" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ScrollArea>

            {/* Notes and Counted By */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="countedBy">{t.reconcileUi.countedBy}</Label>
                <Input
                  id="countedBy"
                  value={countedBy}
                  onChange={(e) => setCountedBy(e.target.value)}
                  placeholder={t.reconcileUi.countedByPlaceholder}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="notes">{t.reconcileUi.notes}</Label>
                <Input
                  id="notes"
                  value={reconciliationNotes}
                  onChange={(e) => setReconciliationNotes(e.target.value)}
                  placeholder={t.reconcileUi.notesPlaceholder}
                />
              </div>
            </div>

            {/* Value Impact */}
            {summary.withDifference > 0 && (
              <div className={`p-3 rounded-lg border ${
                summary.totalDifferenceValue >= 0 
                  ? 'bg-emerald-50 border-emerald-200' 
                  : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`w-4 h-4 ${
                      summary.totalDifferenceValue >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`} />
                    <span className="text-sm font-medium">{t.reconcileUi.valueImpact}</span>
                  </div>
                  <span className={`font-bold ${
                    summary.totalDifferenceValue >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {summary.totalDifferenceValue >= 0 ? '+' : ''}{formatCurrency(summary.totalDifferenceValue)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={handleClearAll}>
              <XCircle className="w-4 h-4 mr-2" />
              {t.reconcileUi.clearAll}
            </Button>
            <Button 
              onClick={handleReconcile}
              disabled={summary.withDifference === 0}
            >
              <Save className="w-4 h-4 mr-2" />
              {t.reconcileUi.reconcileCta.replace('{count}', String(summary.withDifference))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              {t.reconcileUi.confirmTitle}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {t.reconcileUi.confirmBody.replace('{count}', String(summary.withDifference))}
                </p>
                <div className="bg-muted p-3 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>{t.reconcileUi.excessProducts}</span>
                    <span className="font-medium text-emerald-600">+{summary.positive}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t.reconcileUi.missingProducts}</span>
                    <span className="font-medium text-red-600">-{summary.negative}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t">
                    <span>{t.reconcileUi.financialImpact}</span>
                    <span className={`font-bold ${
                      summary.totalDifferenceValue >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {summary.totalDifferenceValue >= 0 ? '+' : ''}{formatCurrency(summary.totalDifferenceValue)}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t.reconcileUi.confirmFooter}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.reconcileUi.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReconciliation}>
              {t.reconcileUi.confirmAdjustments}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
