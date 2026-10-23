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
import * as XLSX from 'xlsx';
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

  const handlePrint = () => {
    if (!ensureReady()) return;
    const printContent = generatePrintContent();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error(t.common.error);
      return;
    }
    printWindow.document.write(printContent);
    printWindow.document.close();
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  };

  const reportDate = format(new Date(), 'dd/MM/yyyy');
  const asOfLabel = t.countSheetUi.asOfDate.replace('{date}', reportDate);
  const qtyLocale = language === 'pt' ? 'pt-AO' : 'en-GB';

  const formatSheetQty = (qty: number) =>
    qty.toLocaleString(qtyLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const columnHeaders = [
    t.countSheetUi.colCode,
    t.countSheetUi.colDescription,
    ...(includeBarcode ? [t.inventory.barcode] : []),
    t.countSheetUi.colQty,
    t.countSheetUi.colCount,
    t.countSheetUi.colDiff,
  ];

  const handleExportExcel = () => {
    if (!ensureReady()) return;

    const qtyCol = includeBarcode ? 'D' : 'C';
    const countCol = includeBarcode ? 'E' : 'D';
    const headerRow = 2;

    const aoa: (string | number)[][] = [
      [t.countSheetUi.reportTitle, ...Array(Math.max(0, columnHeaders.length - 2)).fill(''), asOfLabel],
      columnHeaders,
      ...filteredProducts.map((p, index) => {
        const excelRow = headerRow + 1 + index;
        const qty = hideSystemStock ? '' : readProductStock(p);
        return [
          p.sku || '',
          String(p.name || '').toUpperCase(),
          ...(includeBarcode ? [p.barcode || ''] : []),
          qty,
          '',
          hideSystemStock ? '' : `=IF(${countCol}${excelRow}="","",${countCol}${excelRow}-${qtyCol}${excelRow})`,
        ];
      }),
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const lastCol = String.fromCharCode(64 + columnHeaders.length);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, columnHeaders.length - 2) } }];
    if (ws.A1) ws.A1.s = { font: { bold: true, sz: 14 } };
    for (let i = 0; i < filteredProducts.length; i += 1) {
      const addr = `${qtyCol}${headerRow + 1 + i}`;
      const cell = ws[addr];
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';
    }
    ws['!cols'] = [
      { wch: 14 },
      { wch: 48 },
      ...(includeBarcode ? [{ wch: 16 }] : []),
      { wch: 10 },
      { wch: 12 },
      { wch: 10 },
    ];
    ws['!ref'] = `A1:${lastCol}${headerRow + filteredProducts.length}`;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t.countSheetUi.reportTitle.slice(0, 31));
    XLSX.writeFile(wb, `${t.countSheetUi.filePrefix}_${branch?.code || 'geral'}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const generatePrintContent = () => {
    const branchName = branch?.name || t.countSheetUi.general;
    const barcodeHeader = includeBarcode
      ? `<th class="col-barcode">${t.inventory.barcode}</th>`
      : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${t.countSheetUi.reportTitle}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Calibri, Arial, sans-serif; font-size: 11px; line-height: 1.25; padding: 12mm; background: white; color: #111; }
          .title-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
          .title-row h1 { font-size: 18px; font-weight: 600; }
          .title-row .as-of { font-size: 12px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #9aa7b5; padding: 4px 8px; text-align: left; }
          th { background: #d6e3f0; font-weight: 600; font-size: 11px; }
          td { font-size: 11px; }
          .col-codigo { width: 110px; }
          .col-barcode { width: 110px; }
          .col-qtd, .col-contagem, .col-diff { width: 72px; text-align: right; }
          .signature-section { margin-top: 36px; display: flex; justify-content: space-between; font-size: 10px; }
          .signature-line { border-top: 1px solid #000; padding-top: 3px; min-width: 180px; }
          @media print { body { padding: 8mm; } }
        </style>
      </head>
      <body>
        <div class="title-row">
          <h1>${t.countSheetUi.reportTitle}</h1>
          <div class="as-of">${asOfLabel}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th class="col-codigo">${t.countSheetUi.colCode}</th>
              <th class="col-descricao">${t.countSheetUi.colDescription}</th>
              ${barcodeHeader}
              <th class="col-qtd">${t.countSheetUi.colQty}</th>
              <th class="col-contagem">${t.countSheetUi.colCount}</th>
              <th class="col-diff">${t.countSheetUi.colDiff}</th>
            </tr>
          </thead>
          <tbody>
            ${filteredProducts.map((p) => `
              <tr>
                <td class="col-codigo">${p.sku || ''}</td>
                <td class="col-descricao">${String(p.name || '').toUpperCase()}</td>
                ${includeBarcode ? `<td class="col-barcode">${p.barcode || ''}</td>` : ''}
                <td class="col-qtd">${hideSystemStock ? '' : formatSheetQty(readProductStock(p))}</td>
                <td class="col-contagem"></td>
                <td class="col-diff"></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="signature-section">
          <div>
            <div class="signature-line">${countedBy || '_________________________'}</div>
          </div>
          <div style="text-align: right;">${branchName}</div>
        </div>
      </body>
      </html>
    `;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
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
