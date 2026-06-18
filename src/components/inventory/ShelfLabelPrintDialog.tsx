import { useState } from 'react';
import { Product } from '@/types/erp';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Printer } from 'lucide-react';
import { printHtml } from '@/lib/printHtml';
import { toast } from 'sonner';

interface ShelfLabelPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
}

type LabelSize = 'small' | 'medium' | 'large';

const LABEL_SIZES: Record<LabelSize, { width: number; height: number; label: string }> = {
  small: { width: 40, height: 25, label: '40×25mm' },
  medium: { width: 58, height: 30, label: '58×30mm' },
  large: { width: 80, height: 40, label: '80×40mm' },
};

export function ShelfLabelPrintDialog({ open, onOpenChange, products }: ShelfLabelPrintDialogProps) {
  const [labelSize, setLabelSize] = useState<LabelSize>('medium');
  const [columns, setColumns] = useState(3);
  const [showBarcode, setShowBarcode] = useState(true);
  const [showBasePrice, setShowBasePrice] = useState(true);
  const [copies, setCopies] = useState(1);

  const [printing, setPrinting] = useState(false);

  const handlePrint = async () => {
    if (products.length === 0) {
      toast.error('Nenhum produto seleccionado para etiquetas.');
      return;
    }
    const size = LABEL_SIZES[labelSize];
    const labelWidthMM = size.width;
    const labelHeightMM = size.height;

    const labelsHtml = products.flatMap(product => {
      const taxRate = product.taxRate || 0;
      const priceWithIVA = product.price * (1 + taxRate / 100);
      const labels: string[] = [];

      for (let c = 0; c < copies; c++) {
        labels.push(`
          <div class="label" style="width:${labelWidthMM}mm; height:${labelHeightMM}mm;">
            <div class="product-name">${product.name}</div>
            <div class="sku">${product.sku || ''}</div>
            ${showBarcode && product.barcode ? `<div class="barcode">||||| ${product.barcode} |||||</div>` : ''}
            <div class="prices">
            <div class="price-main">${priceWithIVA.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} Kz</div>
              ${showBasePrice ? `<div class="price-base">s/IVA: ${product.price.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} Kz</div>` : ''}
              ${taxRate > 0 ? `<div class="tax-info">IVA ${taxRate}%</div>` : '<div class="tax-info">Isento</div>'}
            </div>
          </div>
        `);
      }
      return labels;
    }).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Etiquetas de Prateleira</title>
        <style>
          @page { margin: 5mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; }
          .labels-grid {
            display: grid;
            grid-template-columns: repeat(${columns}, ${labelWidthMM}mm);
            gap: 2mm;
          }
          .label {
            width: ${labelWidthMM}mm;
            height: ${labelHeightMM}mm;
            border: 0.5pt dashed #999;
            padding: 2mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow: hidden;
            page-break-inside: avoid;
          }
          .product-name {
            font-weight: bold;
            font-size: ${labelSize === 'small' ? '7pt' : '9pt'};
            line-height: 1.1;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
          }
          .sku {
            font-size: 6pt;
            color: #666;
            margin-top: 0.5mm;
          }
          .barcode {
            font-family: monospace;
            font-size: 7pt;
            text-align: center;
            letter-spacing: 1px;
            margin: 1mm 0;
          }
          .prices { margin-top: auto; }
          .price-main {
            font-weight: bold;
            font-size: ${labelSize === 'small' ? '10pt' : '13pt'};
          }
          .price-base {
            font-size: ${labelSize === 'small' ? '6pt' : '7pt'};
            color: #555;
          }
          .tax-info {
            font-size: 6pt;
            color: #777;
          }
          @media print {
            .label { border: 0.5pt dashed #ccc; }
          }
        </style>
      </head>
      <body>
        <div class="labels-grid">${labelsHtml}</div>
      </body>
      </html>
    `;

    setPrinting(true);
    try {
      await printHtml(html);
      onOpenChange(false);
    } catch (error) {
      console.error('[labels] print error:', error);
      toast.error('Falha ao imprimir etiquetas.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5" />
            Imprimir Etiquetas de Prateleira
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            {products.length} produto(s) seleccionado(s)
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Tamanho da Etiqueta</Label>
              <Select value={labelSize} onValueChange={(v) => setLabelSize(v as LabelSize)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">Pequena (40×25mm)</SelectItem>
                  <SelectItem value="medium">Média (58×30mm)</SelectItem>
                  <SelectItem value="large">Grande (80×40mm)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Colunas por Página</Label>
              <Input
                type="number"
                min={1}
                max={6}
                value={columns}
                onChange={(e) => setColumns(Number(e.target.value))}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Cópias por Produto</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={copies}
              onChange={(e) => setCopies(Number(e.target.value))}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="showBarcode"
                checked={showBarcode}
                onCheckedChange={(v) => setShowBarcode(!!v)}
              />
              <Label htmlFor="showBarcode" className="text-xs">Mostrar Código de Barras</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="showBasePrice"
                checked={showBasePrice}
                onCheckedChange={(v) => setShowBasePrice(!!v)}
              />
              <Label htmlFor="showBasePrice" className="text-xs">Mostrar Preço sem IVA</Label>
            </div>
          </div>

          {/* Preview */}
          <div className="border border-border rounded-md p-3 bg-muted/30">
            <div className="text-xs font-medium mb-2">Pré-visualização:</div>
            <div className="border border-dashed border-border p-2 bg-background rounded text-center" style={{ maxWidth: '180px' }}>
              <div className="text-xs font-bold truncate">{products[0]?.name || 'Nome do Produto'}</div>
              <div className="text-[10px] text-muted-foreground">{products[0]?.sku || 'SKU'}</div>
              {showBarcode && <div className="text-[10px] font-mono my-0.5">||||| {products[0]?.barcode || '0000000'} |||||</div>}
              <div className="text-sm font-bold mt-1">
                {((products[0]?.price || 0) * (1 + (products[0]?.taxRate || 0) / 100)).toLocaleString('pt-AO', { minimumFractionDigits: 2 })} Kz
              </div>
              {showBasePrice && (
                <div className="text-[10px] text-muted-foreground">
                  s/IVA: {(products[0]?.price || 0).toLocaleString('pt-AO', { minimumFractionDigits: 2 })} Kz
                </div>
              )}
              <div className="text-[9px] text-muted-foreground">IVA {products[0]?.taxRate || 0}%</div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={printing}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handlePrint} disabled={printing || products.length === 0}>
              <Printer className="w-4 h-4 mr-1" />
              {printing ? 'A imprimir...' : 'Imprimir'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
