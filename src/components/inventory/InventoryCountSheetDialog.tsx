import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, FileSpreadsheet, Download } from 'lucide-react';
import { Product, Branch } from '@/types/erp';
import { getCompanySettings } from '@/lib/companySettings';
import * as XLSX from 'xlsx';
import { useTranslation } from '@/i18n';

// Generate count sheet number
function generateCountNumber(branchCode: string): string {
  const date = format(new Date(), 'yyyyMMdd');
  const seq = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `INV-${branchCode || 'XX'}-${date}-${seq}`;
}

interface InventoryCountSheetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  branch: Branch | null;
  categories: string[];
}

export function InventoryCountSheetDialog({
  open,
  onOpenChange,
  products,
  branch,
  categories,
}: InventoryCountSheetDialogProps) {
  const { t, language } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [hideSystemStock, setHideSystemStock] = useState(false);
  const [countedBy, setCountedBy] = useState('');

  const company = getCompanySettings();
  
  // Generate count number
  const countNumber = useMemo(() => 
    generateCountNumber(branch?.code || ''),
    [branch?.code]
  );

  // Filter products
  const filteredProducts = products.filter(p => {
    if (!includeInactive && !p.isActive) return false;
    if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
    return true;
  }).sort((a, b) => a.sku.localeCompare(b.sku));

  const handlePrint = () => {
    const printContent = generatePrintContent();
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  };

  const handleExportExcel = () => {
    const data = filteredProducts.map((p, idx) => ({
      [t.countSheetUi.colCode]: p.sku,
      [t.countSheetUi.colDescription]: p.name,
      [t.countSheetUi.colQty]: hideSystemStock ? '' : p.stock,
      [t.countSheetUi.colCount]: '',
      [t.countSheetUi.colDiff]: '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contagem');

    // Set column widths
    ws['!cols'] = [
      { wch: 12 }, // Codigo
      { wch: 45 }, // Descrição
      { wch: 8 },  // Qtd
      { wch: 12 }, // Contagem
      { wch: 8 },  // Diff
    ];

    const dateStr = format(new Date(), 'yyyy-MM-dd');
    XLSX.writeFile(wb, `${t.countSheetUi.filePrefix}_${branch?.code || 'geral'}_${dateStr}.xlsx`);
  };

  const generatePrintContent = () => {
    const dateStr = format(new Date(), "dd.MM.yyyy", { locale: language === 'pt' ? pt : undefined });
    const branchName = branch?.name || t.countSheetUi.general;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${t.countSheetUi.sheetTitle.replace('{branch}', branchName)}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            line-height: 1.2;
            padding: 10mm;
            background: white;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            border: 1px solid #000;
            padding: 4px 6px;
            text-align: left;
          }
          th {
            background: #fff;
            font-weight: bold;
            font-size: 10px;
          }
          td {
            font-size: 10px;
          }
          .col-codigo {
            width: 90px;
          }
          .col-descricao {
            /* takes remaining space */
          }
          .col-qtd {
            width: 50px;
            text-align: center;
          }
          .col-contagem {
            width: 80px;
            text-align: center;
          }
          .col-diff {
            width: 50px;
            text-align: center;
          }
          .branch-header {
            text-align: center;
            font-weight: bold;
            font-size: 11px;
            text-transform: uppercase;
          }
          .header-row th {
            border-bottom: 2px solid #000;
          }
          .signature-section {
            margin-top: 40px;
            display: flex;
            justify-content: space-between;
            font-size: 10px;
          }
          .signature-line {
            border-top: 1px solid #000;
            padding-top: 3px;
            min-width: 180px;
          }
          @media print {
            body {
              padding: 8mm;
            }
          }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr class="header-row">
              <th class="col-codigo">${t.countSheetUi.colCode}</th>
              <th class="col-descricao branch-header">${branchName.toUpperCase()}</th>
              <th class="col-qtd">${t.countSheetUi.colQty}</th>
              <th class="col-contagem">${t.countSheetUi.colCount}</th>
              <th class="col-diff">${t.countSheetUi.colDiff}</th>
            </tr>
          </thead>
          <tbody>
            ${filteredProducts.map((p) => `
              <tr>
                <td class="col-codigo">${p.sku}</td>
                <td class="col-descricao">${p.name.toUpperCase()}</td>
                <td class="col-qtd">${hideSystemStock ? '' : p.stock}</td>
                <td class="col-contagem"></td>
                <td class="col-diff"></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="signature-section">
          <div>
            <div class="signature-line">
              ${countedBy || '_________________________'}
            </div>
          </div>
          <div style="text-align: right;">
            ${branch?.name || ''}, aos ${dateStr}
          </div>
        </div>
      </body>
      </html>
    `;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
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
          {/* Branch Info */}
          <div className="p-3 bg-muted rounded-lg">
            <Label className="text-xs text-muted-foreground">{t.countSheetUi.branch}</Label>
            <p className="font-medium">{branch?.name || t.countSheetUi.allBranches}</p>
            {branch?.code && <p className="text-sm text-muted-foreground">Código: {branch.code}</p>}
          </div>

          {/* Category Filter */}
          <div className="space-y-2">
            <Label>{t.countSheetUi.category}</Label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger>
                <SelectValue placeholder={t.countSheetUi.selectCategory} />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-lg z-50">
                <SelectItem value="all">{t.countSheetUi.allCategories}</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Counted By */}
          <div className="space-y-2">
            <Label>{t.countSheetUi.countedByOptional}</Label>
            <Input
              placeholder={t.countSheetUi.responsibleNamePlaceholder}
              value={countedBy}
              onChange={(e) => setCountedBy(e.target.value)}
            />
          </div>

          {/* Options */}
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
                id="includeInactive"
                checked={includeInactive}
                onCheckedChange={(checked) => setIncludeInactive(checked === true)}
              />
              <label htmlFor="includeInactive" className="text-sm cursor-pointer">
                {t.countSheetUi.includeInactive}
              </label>
            </div>
          </div>

          {/* Product Count */}
          <div className="text-sm text-muted-foreground">
            {t.countSheetUi.productsListed.replace('{count}', String(filteredProducts.length))}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleExportExcel}>
            <Download className="w-4 h-4 mr-2" />
            {t.countSheetUi.excel}
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" />
            {t.countSheetUi.printSheet}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
