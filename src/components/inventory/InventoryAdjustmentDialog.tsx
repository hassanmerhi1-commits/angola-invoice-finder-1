import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { 
  ClipboardCheck, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowUp, 
  ArrowDown,
  Save,
  RotateCcw,
  Upload,
  Calculator,
  Plus,
  Receipt,
} from 'lucide-react';
import { Product, Branch } from '@/types/erp';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import { useTranslation } from '@/i18n';

interface AdjustmentItem {
  productId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  systemStock: number;
  physicalCount: number | null;
  difference: number;
  isModified: boolean;
}

interface InventoryAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  branches: Branch[];
  branchId: string;
  onBranchChange: (branchId: string) => void;
  canSwitchBranch?: boolean;
  onAddProduct?: () => void;
  onApplyAdjustments: (
    adjustments: { productId: string; newStock: number; difference: number }[],
    reason: string,
    notes: string,
    receiptNumber: string,
    warehouseId: string,
  ) => void;
}

export function InventoryAdjustmentDialog({
  open,
  onOpenChange,
  products,
  branches,
  branchId,
  onBranchChange,
  canSwitchBranch = false,
  onAddProduct,
  onApplyAdjustments,
}: InventoryAdjustmentDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [adjustmentReason, setAdjustmentReason] = useState('physical_count');
  const [notes, setNotes] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [adjustments, setAdjustments] = useState<Map<string, number | null>>(new Map());
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === branchId) ?? null,
    [branches, branchId],
  );

  const ADJUSTMENT_REASONS = useMemo(() => ([
    { value: 'physical_count', label: t.inventoryAdjustUi.reasonPhysicalCount },
    { value: 'damage', label: t.inventoryAdjustUi.reasonDamage },
    { value: 'theft', label: t.inventoryAdjustUi.reasonTheft },
    { value: 'expiry', label: t.inventoryAdjustUi.reasonExpiry },
    { value: 'correction', label: t.inventoryAdjustUi.reasonCorrection },
    { value: 'transfer', label: t.inventoryAdjustUi.reasonTransfer },
    { value: 'other', label: t.inventoryAdjustUi.reasonOther },
  ]), [t]);

  const COL_CODE = t.inventoryAdjustUi.colCode;
  const COL_PHYSICAL = t.inventoryAdjustUi.colPhysicalCount;
  const COL_PHYSICAL_SHORT = t.inventoryAdjustUi.colPhysicalShort;

  // Get unique categories
  const categories = useMemo(() => 
    [...new Set(products.map(p => p.category).filter(Boolean))].sort(),
    [products]
  );

  // Build adjustment items
  const adjustmentItems: AdjustmentItem[] = useMemo(() => {
    return products
      .filter(p => {
        if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          return p.sku.toLowerCase().includes(term) || 
                 p.name.toLowerCase().includes(term) ||
                 p.barcode?.toLowerCase().includes(term);
        }
        return true;
      })
      .map(p => {
        const physicalCount = adjustments.get(p.id);
        const difference = physicalCount !== null && physicalCount !== undefined 
          ? physicalCount - p.stock 
          : 0;
        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          unit: p.unit,
          systemStock: p.stock,
          physicalCount: physicalCount ?? null,
          difference,
          isModified: physicalCount !== null && physicalCount !== undefined,
        };
      })
      .filter(item => !showOnlyDifferences || (item.isModified && item.difference !== 0))
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [products, searchTerm, selectedCategory, adjustments, showOnlyDifferences]);

  // Calculate summary
  const summary = useMemo(() => {
    const modified = adjustmentItems.filter(i => i.isModified);
    const withDifference = modified.filter(i => i.difference !== 0);
    const increases = withDifference.filter(i => i.difference > 0);
    const decreases = withDifference.filter(i => i.difference < 0);
    
    return {
      totalProducts: adjustmentItems.length,
      modifiedCount: modified.length,
      withDifferenceCount: withDifference.length,
      increasesCount: increases.length,
      decreasesCount: decreases.length,
      totalIncrease: increases.reduce((sum, i) => sum + i.difference, 0),
      totalDecrease: Math.abs(decreases.reduce((sum, i) => sum + i.difference, 0)),
    };
  }, [adjustmentItems]);

  // Handle physical count change
  const handlePhysicalCountChange = useCallback((productId: string, value: string) => {
    setAdjustments(prev => {
      const newMap = new Map(prev);
      if (value === '' || value === null) {
        newMap.delete(productId);
      } else {
        const numValue = parseInt(value, 10);
        if (!isNaN(numValue) && numValue >= 0) {
          newMap.set(productId, numValue);
        }
      }
      return newMap;
    });
  }, []);

  // Set physical count equal to system stock (no difference)
  const handleSetAsSystem = useCallback((productId: string, systemStock: number) => {
    setAdjustments(prev => {
      const newMap = new Map(prev);
      newMap.set(productId, systemStock);
      return newMap;
    });
  }, []);

  // Clear all adjustments
  const handleClearAll = () => {
    setAdjustments(new Map());
    setNotes('');
    setReceiptNumber('');
  };

  // Apply adjustments
  const handleApply = () => {
    const itemsToAdjust = adjustmentItems
      .filter(i => i.isModified && i.difference !== 0)
      .map(i => ({
        productId: i.productId,
        newStock: i.physicalCount!,
        difference: i.difference,
      }));

    if (itemsToAdjust.length === 0) {
      toast({
        title: t.inventoryAdjustUi.noAdjustmentsTitle,
        description: t.inventoryAdjustUi.noDifferencesDesc,
        variant: 'destructive',
      });
      return;
    }

    if (!branchId) {
      toast({
        title: t.inventoryAdjustUi.branchRequiredTitle,
        description: t.inventoryAdjustUi.branchRequiredDesc,
        variant: 'destructive',
      });
      return;
    }

    const reasonLabel = ADJUSTMENT_REASONS.find(r => r.value === adjustmentReason)?.label || adjustmentReason;
    
    onApplyAdjustments(itemsToAdjust, reasonLabel, notes, receiptNumber.trim(), branchId);
    
    toast({
      title: t.inventoryAdjustUi.appliedTitle,
      description: t.inventoryAdjustUi.appliedDesc.replace('{count}', String(itemsToAdjust.length)),
    });

    handleClearAll();
    onOpenChange(false);
  };

  // Import from Excel
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet) as Record<string, unknown>[];

        const newAdjustments = new Map<string, number>();
        let matched = 0;

        jsonData.forEach((row) => {
          // Try to match by SKU
          const sku = String(row[COL_CODE] || row['codigo'] || row['SKU'] || row['sku'] || '').trim();
          const count = parseInt(String(row[COL_PHYSICAL] || row['contagem'] || row['Count'] || row[COL_PHYSICAL_SHORT] || 0), 10);

          if (sku && !isNaN(count)) {
            const product = products.find(p => p.sku.toLowerCase() === sku.toLowerCase());
            if (product) {
              newAdjustments.set(product.id, count);
              matched++;
            }
          }
        });

        setAdjustments(newAdjustments);
        toast({
          title: t.inventoryAdjustUi.importDone,
          description: t.inventoryAdjustUi.importDoneDesc
            .replace('{matched}', String(matched))
            .replace('{rows}', String(jsonData.length)),
        });
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      toast({
        title: t.inventoryAdjustUi.importError,
        description: t.inventoryAdjustUi.importErrorDesc,
        variant: 'destructive',
      });
    }

    // Reset input
    e.target.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5" />
            {t.inventoryAdjustUi.title.replace('{branch}', selectedBranch?.name || t.inventoryAdjustUi.allBranches)}
          </DialogTitle>
          <DialogDescription>
            {t.inventoryAdjustUi.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>{t.inventoryAdjustUi.branch}</Label>
              {canSwitchBranch && branches.length > 0 ? (
                <Select value={branchId} onValueChange={onBranchChange}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.inventoryAdjustUi.selectBranch} />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg z-50">
                    {branches.filter((b) => b.id).map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input readOnly value={selectedBranch?.name || '—'} className="bg-muted/50" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5" />
                {t.inventoryAdjustUi.receiptNumber}
              </Label>
              <Input
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                placeholder={t.inventoryAdjustUi.receiptNumberPlaceholder}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-end">
              {onAddProduct ? (
                <Button type="button" variant="outline" className="w-full" onClick={onAddProduct}>
                  <Plus className="w-4 h-4 mr-2" />
                  {t.inventoryAdjustUi.newProduct}
                </Button>
              ) : null}
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t.inventoryAdjustUi.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-lg z-50">
                <SelectItem value="all">Todas Categorias</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={showOnlyDifferences ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowOnlyDifferences(!showOnlyDifferences)}
            >
              <AlertTriangle className="w-4 h-4 mr-1" />
              Só Diferenças
            </Button>
            <label className="cursor-pointer">
              <Button variant="outline" size="sm" asChild>
                <span>
                  <Upload className="w-4 h-4 mr-1" />
                  Importar Excel
                </span>
              </Button>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleImportExcel}
                className="hidden"
              />
            </label>
            <Button variant="ghost" size="sm" onClick={handleClearAll}>
              <RotateCcw className="w-4 h-4 mr-1" />
              Limpar
            </Button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Produtos</p>
              <p className="text-lg font-bold">{summary.totalProducts}</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Contados</p>
              <p className="text-lg font-bold">{summary.modifiedCount}</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Com Diferença</p>
              <p className="text-lg font-bold text-amber-600">{summary.withDifferenceCount}</p>
            </div>
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Aumentos</p>
              <p className="text-lg font-bold text-emerald-600">+{summary.totalIncrease}</p>
            </div>
            <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Reduções</p>
              <p className="text-lg font-bold text-destructive">-{summary.totalDecrease}</p>
            </div>
          </div>

          {/* Table */}
          <ScrollArea className="flex-1 border rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[100px]">{t.inventoryAdjustUi.colCode}</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-[100px]">Categoria</TableHead>
                  <TableHead className="w-[60px] text-center">Un.</TableHead>
                  <TableHead className="w-[100px] text-center">Stock Sistema</TableHead>
                  <TableHead className="w-[120px] text-center">{t.inventoryAdjustUi.colPhysicalCount}</TableHead>
                  <TableHead className="w-[100px] text-center">Diferença</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustmentItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      <Calculator className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>Nenhum produto encontrado</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  adjustmentItems.map((item) => (
                    <TableRow 
                      key={item.productId}
                      className={cn(
                        item.isModified && item.difference !== 0 && 'bg-amber-50 dark:bg-amber-950/20',
                        item.isModified && item.difference > 0 && 'bg-emerald-50 dark:bg-emerald-950/20',
                        item.isModified && item.difference < 0 && 'bg-red-50 dark:bg-red-950/20'
                      )}
                    >
                      <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                      <TableCell>
                        <div className="max-w-[250px] truncate" title={item.name}>
                          {item.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.category}</TableCell>
                      <TableCell className="text-center text-sm">{item.unit}</TableCell>
                      <TableCell className="text-center font-medium">{item.systemStock}</TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={item.physicalCount ?? ''}
                          onChange={(e) => handlePhysicalCountChange(item.productId, e.target.value)}
                          placeholder="—"
                          className="h-8 text-center"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        {item.isModified ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              'font-mono',
                              item.difference > 0 && 'text-emerald-600 border-emerald-600',
                              item.difference < 0 && 'text-destructive border-destructive',
                              item.difference === 0 && 'text-muted-foreground'
                            )}
                          >
                            {item.difference > 0 && <ArrowUp className="w-3 h-3 mr-1" />}
                            {item.difference < 0 && <ArrowDown className="w-3 h-3 mr-1" />}
                            {item.difference === 0 && <CheckCircle2 className="w-3 h-3 mr-1" />}
                            {item.difference > 0 ? '+' : ''}{item.difference}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleSetAsSystem(item.productId, item.systemStock)}
                          title="Definir contagem igual ao sistema"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          {/* Adjustment Details */}
          {summary.withDifferenceCount > 0 && (
            <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t.inventoryAdjustUi.adjustmentReason}</Label>
                  <Select value={adjustmentReason} onValueChange={setAdjustmentReason}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background border shadow-lg z-50">
                      {ADJUSTMENT_REASONS.map(reason => (
                        <SelectItem key={reason.value} value={reason.value}>
                          {reason.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t.inventoryAdjustUi.notes}</Label>
                  <Textarea
                    placeholder={t.inventoryAdjustUi.notesPlaceholder}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="h-[60px] resize-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button 
            onClick={handleApply}
            disabled={summary.withDifferenceCount === 0 || !branchId}
          >
            <Save className="w-4 h-4 mr-2" />
            {t.inventoryAdjustUi.applyCount.replace('{count}', String(summary.withDifferenceCount))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
