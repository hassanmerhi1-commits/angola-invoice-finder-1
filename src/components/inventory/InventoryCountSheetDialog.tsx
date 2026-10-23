import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, FileSpreadsheet, Download, ClipboardCheck } from 'lucide-react';
import { Product, Branch } from '@/types/erp';
import { readProductStock } from '@/lib/inventoryGrid';
import {
  buildCountSheetHtml,
  buildCountSheetRows,
  countSheetAsOfLabel,
  downloadCountSheetExcel,
  formatCountSheetQty,
} from '@/lib/inventoryCountSheet';
import { printHtml } from '@/lib/printHtml';
import { useTranslation } from '@/i18n';
import { inventoryFoodCategoryLabel } from '@/lib/inventoryFoodCategories';
import { toast } from 'sonner';

interface InventoryCountSheetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  branch: Branch | null;
  categories: string[];
  branches?: Branch[];
  branchId?: string;
  onBranchIdChange?: (branchId: string) => void;
  branchRequired?: boolean;
  loading?: boolean;
  onContinueToReconcile?: () => void;
}

export function InventoryCountSheetDialog({
  open,
  onOpenChange,
  products,
  branch,
  categories,
  branches = [],
  branchId = '',
  onBranchIdChange,
  branchRequired = false,
  loading = false,
  onContinueToReconcile,
}: InventoryCountSheetDialogProps) {
  const { t, language } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [hideSystemStock, setHideSystemStock] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [includeBarcode, setIncludeBarcode] = useState(false);
  const [countedBy, setCountedBy] = useState('');

  const showBranchPicker = branches.length > 1 || branchRequired;
  const branchBlocked = branchRequired && !branchId;

  const filteredProducts = useMemo(() => products
    .filter((p) => {
      if (!includeInactive && !p.isActive) return false;
      if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
      if (inStockOnly && readProductStock(p) <= 0.0001) return false;
      return true;
    })
    .sort((a, b) => String(a.sku || '').localeCompare(String(b.sku || ''), undefined, { numeric: true })),
  [products, includeInactive, selectedCategory, inStockOnly]);

  const sheetRows = useMemo(
    () => buildCountSheetRows(filteredProducts, hideSystemStock),
    [filteredProducts, hideSystemStock],
  );

  const ensureReady = () => {
    if (branchBlocked) {
      toast.error(t.countSheetUi.branchRequired);
      return false;
    }
    if (loading) return false;
    if (filteredProducts.length === 0) {
      toast.error(t.countSheetUi.noProducts);
      return false;
    }
    return true;
  };

  const locale = language === 'pt' ? 'pt' : 'en';
  const asOfLabel = countSheetAsOfLabel(t.countSheetUi.asOfDate);
  const sheetLabels = {
    reportTitle: t.countSheetUi.reportTitle,
    asOfDate: t.countSheetUi.asOfDate,
    colCode: t.countSheetUi.colCode,
    colDescription: t.countSheetUi.colDescription,
    colBarcode: t.inventory.barcode,
    colQty: t.countSheetUi.colQty,
    colCount: t.countSheetUi.colCount,
    colDiff: t.countSheetUi.colDiff,
  };
  const previewRows = sheetRows.slice(0, 8);

  const buildSheetHtml = () => buildCountSheetHtml({
    rows: sheetRows,
    labels: sheetLabels,
    asOfLabel,
    includeBarcode,
    locale,
  });

  const handlePrint = async () => {
    if (!ensureReady()) return;
    await printHtml(buildSheetHtml());
  };

  const handleExportExcel = () => {
    if (!ensureReady()) return;
    downloadCountSheetExcel(
      buildSheetHtml(),
      `${t.countSheetUi.filePrefix}_${branch?.code || 'geral'}_${format(new Date(), 'yyyy-MM-dd')}`,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            {t.countSheetUi.title}
          </DialogTitle>
          <DialogDescription>
            {t.countSheetUi.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {showBranchPicker && onBranchIdChange ? (
            <div className="space-y-2">
              <Label>{t.countSheetUi.branch}</Label>
              <Select value={branchId || undefined} onValueChange={onBranchIdChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t.countSheetUi.selectBranch} />
                </SelectTrigger>
                <SelectContent className="bg-background border shadow-lg z-50">
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {branchBlocked && (
                <p className="text-xs text-destructive">{t.countSheetUi.branchRequired}</p>
              )}
            </div>
          ) : (
            <div className="p-3 bg-muted rounded-lg">
              <Label className="text-xs text-muted-foreground">{t.countSheetUi.branch}</Label>
              <p className="font-medium">{branch?.name || t.countSheetUi.allBranches}</p>
              {branch?.code && (
                <p className="text-sm text-muted-foreground">
                  {t.countSheetUi.codeLabel}: {branch.code}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>{t.countSheetUi.category}</Label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger>
                <SelectValue placeholder={t.countSheetUi.selectCategory} />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-lg z-50">
                <SelectItem value="all">{t.countSheetUi.allCategories}</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{inventoryFoodCategoryLabel(cat, language)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t.countSheetUi.countedByOptional}</Label>
            <Input
              placeholder={t.countSheetUi.responsibleNamePlaceholder}
              value={countedBy}
              onChange={(e) => setCountedBy(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="hideStock"
                checked={hideSystemStock}
                onCheckedChange={(checked) => setHideSystemStock(checked === true)}
              />
              <label htmlFor="hideStock" className="text-sm cursor-pointer">
                {t.countSheetUi.hideSystemStock}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="inStockOnly"
                checked={inStockOnly}
                onCheckedChange={(checked) => setInStockOnly(checked === true)}
              />
              <label htmlFor="inStockOnly" className="text-sm cursor-pointer">
                {t.countSheetUi.inStockOnly}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="includeBarcode"
                checked={includeBarcode}
                onCheckedChange={(checked) => setIncludeBarcode(checked === true)}
              />
              <label htmlFor="includeBarcode" className="text-sm cursor-pointer">
                {t.countSheetUi.includeBarcode}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="includeInactive"
                checked={includeInactive}
                onCheckedChange={(checked) => setIncludeInactive(checked === true)}
              />
              <label htmlFor="includeInactive" className="text-sm cursor-pointer">
                {t.countSheetUi.includeInactive}
              </label>
            </div>
          </div>

          <div className="rounded-md border border-[#8ea9db] overflow-hidden bg-white">
            <div className="flex items-baseline justify-between px-3 pt-3 pb-2">
              <p className="text-[15px] font-semibold text-slate-900">{t.countSheetUi.reportTitle}</p>
              <p className="text-xs font-semibold text-slate-600">{asOfLabel}</p>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-[#bdd7ee] text-[#1e3a5f]">
                  <th className="border border-[#8ea9db] px-2 py-1.5 text-left font-semibold w-28">{t.countSheetUi.colCode}</th>
                  <th className="border border-[#8ea9db] px-2 py-1.5 text-left font-semibold">{t.countSheetUi.colDescription}</th>
                  {includeBarcode && (
                    <th className="border border-[#8ea9db] px-2 py-1.5 text-left font-semibold w-28">{t.inventory.barcode}</th>
                  )}
                  <th className="border border-[#8ea9db] px-2 py-1.5 text-right font-semibold w-20">{t.countSheetUi.colQty}</th>
                  <th className="border border-[#8ea9db] px-2 py-1.5 text-right font-semibold w-24">{t.countSheetUi.colCount}</th>
                  <th className="border border-[#8ea9db] px-2 py-1.5 text-right font-semibold w-16">{t.countSheetUi.colDiff}</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.length === 0 ? (
                  <tr>
                    <td colSpan={includeBarcode ? 6 : 5} className="px-2 py-4 text-center text-muted-foreground">
                      {loading ? t.common.loading : t.countSheetUi.noProducts}
                    </td>
                  </tr>
                ) : previewRows.map((row, index) => (
                  <tr key={`${row.sku}-${index}`} className={index % 2 ? 'bg-[#f8fbfe]' : 'bg-white'}>
                    <td className="border border-[#b4c6e7] px-2 py-1 font-mono">{row.sku}</td>
                    <td className="border border-[#b4c6e7] px-2 py-1">{row.name}</td>
                    {includeBarcode && <td className="border border-[#b4c6e7] px-2 py-1">{row.barcode}</td>}
                    <td className="border border-[#b4c6e7] px-2 py-1 text-right tabular-nums">
                      {row.qty == null ? '' : formatCountSheetQty(row.qty, locale)}
                    </td>
                    <td className="border border-[#b4c6e7] px-2 py-1 bg-[#fffdf6]" />
                    <td className="border border-[#b4c6e7] px-2 py-1 bg-[#fffdf6]" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-sm text-muted-foreground">
            {loading
              ? t.common.loading
              : t.countSheetUi.productsListed.replace('{count}', String(filteredProducts.length))}
          </div>
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row sm:flex-wrap">
          {onContinueToReconcile && (
            <Button
              variant="secondary"
              className="sm:mr-auto"
              disabled={branchBlocked || loading}
              onClick={() => {
                if (branchBlocked) {
                  toast.error(t.countSheetUi.branchRequired);
                  return;
                }
                onContinueToReconcile();
              }}
            >
              <ClipboardCheck className="w-4 h-4 mr-2" />
              {t.countSheetUi.continueReconcile}
            </Button>
          )}
          <Button variant="outline" onClick={handleExportExcel} disabled={branchBlocked || loading}>
            <Download className="w-4 h-4 mr-2" />
            {t.countSheetUi.excel}
          </Button>
          <Button onClick={handlePrint} disabled={branchBlocked || loading}>
            <Printer className="w-4 h-4 mr-2" />
            {t.countSheetUi.printSheet}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
