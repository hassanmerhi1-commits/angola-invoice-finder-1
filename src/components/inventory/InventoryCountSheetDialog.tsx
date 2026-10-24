import { useState, useMemo } from 'react';
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
  COUNT_SHEET_TEMPLATE,
  buildCountSheetHtml,
  buildCountSheetPrintedHeader,
  buildCountSheetRows,
  downloadCountSheetExcel,
  formatCountSheetQty,
} from '@/lib/inventoryCountSheet';
import { printHtml } from '@/lib/printHtml';
import { getCompanySettings } from '@/lib/companySettings';
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

  const sheetHeader = {
    companyName: getCompanySettings().name || getCompanySettings().tradeName || '',
    branchName: branch?.name || '',
    branchCode: branch?.code || '',
    countedBy,
  };
  const previewRows = sheetRows.slice(0, 8);
  const printedHeader = buildCountSheetPrintedHeader(sheetHeader);

  const handlePrint = async () => {
    if (!ensureReady()) return;
    await printHtml(buildCountSheetHtml({ rows: sheetRows, header: sheetHeader }));
  };

  const handleExportExcel = () => {
    if (!ensureReady()) return;
    downloadCountSheetExcel(sheetRows, sheetHeader);
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
                id="includeInactive"
                checked={includeInactive}
                onCheckedChange={(checked) => setIncludeInactive(checked === true)}
              />
              <label htmlFor="includeInactive" className="text-sm cursor-pointer">
                {t.countSheetUi.includeInactive}
              </label>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[420px] rounded-md border bg-white p-3 shadow-sm">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">A4 retrato</p>
            <div className="mb-2 space-y-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] font-bold leading-tight">{printedHeader.title}</p>
                <p className="text-[10px] text-slate-700 whitespace-nowrap">{printedHeader.asOf}</p>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[10px] text-slate-700">{printedHeader.company}</p>
                <p className="text-[10px] text-slate-700 whitespace-nowrap">{printedHeader.countedBy}</p>
              </div>
              <p className="text-[10px] text-slate-700">{printedHeader.branch}</p>
            </div>
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="bg-[#d6e3f0]">
                  <th className="border border-[#7f8c9b] px-1.5 py-1 text-left w-24">{COUNT_SHEET_TEMPLATE.colCode}</th>
                  <th className="border border-[#7f8c9b] px-1.5 py-1 text-left">{COUNT_SHEET_TEMPLATE.colDescription}</th>
                  <th className="border border-[#7f8c9b] px-1.5 py-1 text-right w-14">{COUNT_SHEET_TEMPLATE.colQty}</th>
                  <th className="border border-[#7f8c9b] px-1.5 py-1 text-right w-16">{COUNT_SHEET_TEMPLATE.colCount}</th>
                  <th className="border border-[#7f8c9b] px-1.5 py-1 text-right w-12">{COUNT_SHEET_TEMPLATE.colDiff}</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                      {loading ? t.common.loading : t.countSheetUi.noProducts}
                    </td>
                  </tr>
                ) : previewRows.map((row, index) => (
                  <tr key={`${row.sku}-${index}`}>
                    <td className="border border-[#7f8c9b] px-1.5 py-0.5">{row.sku}</td>
                    <td className="border border-[#7f8c9b] px-1.5 py-0.5">{row.name}</td>
                    <td className="border border-[#7f8c9b] px-1.5 py-0.5 text-right">
                      {row.qty == null ? '' : formatCountSheetQty(row.qty)}
                    </td>
                    <td className="border border-[#7f8c9b] px-1.5 py-0.5 bg-[#fffdf4]" />
                    <td className="border border-[#7f8c9b] px-1.5 py-0.5 bg-[#fffdf4]" />
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
