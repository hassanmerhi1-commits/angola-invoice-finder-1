import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NumericInput } from '@/components/ui/numeric-input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Save } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useToast } from '@/hooks/use-toast';
import type { StockAdjustmentDocument } from '@/lib/stockAdjustmentDocuments';
import { replaceStockAdjustmentDocument } from '@/lib/stockAdjustmentActions';

interface EditableLine {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitCost: number;
}

interface StockAdjustmentEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: StockAdjustmentDocument | null;
  onSaved: () => void;
}

export function StockAdjustmentEditDialog({
  open,
  onOpenChange,
  document,
  onSaved,
}: StockAdjustmentEditDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !document) return;
    setReferenceNumber(document.referenceNumber);
    setNotes(document.notes);
    setLines(
      document.lines.map((line) => ({
        productId: line.productId,
        sku: line.sku,
        productName: line.productName,
        quantity: line.quantity,
        unitCost: line.unitCost,
      })),
    );
  }, [open, document]);

  const totalValue = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
    [lines],
  );

  const handleSave = async () => {
    if (!document) return;
    const validLines = lines.filter((l) => l.productId && l.quantity > 0);
    if (validLines.length === 0) {
      toast({
        title: t.common.error,
        description: t.adjustmentHistoryUi.editNeedsLines,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const result = await replaceStockAdjustmentDocument(document, {
        referenceNumber: referenceNumber.trim() || document.referenceNumber,
        notes,
        lines: validLines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
        })),
      });
      toast({
        title: t.common.success,
        description: t.adjustmentHistoryUi.editSuccess.replace('{ref}', result.referenceNumber),
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: t.common.error,
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!document) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.adjustmentHistoryUi.editTitle}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>{t.adjustmentHistoryUi.colReference}</Label>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t.adjustmentHistoryUi.colBranch}</Label>
            <Input value={document.branchName} disabled />
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t.common.notes}</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>{t.common.product}</TableHead>
              <TableHead className="text-right w-28">{t.common.qty}</TableHead>
              <TableHead className="text-right w-32">{t.stockMovementUi.colUnitCost}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, idx) => (
              <TableRow key={`${line.productId}-${idx}`}>
                <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                <TableCell>{line.productName}</TableCell>
                <TableCell className="text-right">
                  <NumericInput
                    className="h-8 text-right"
                    value={line.quantity}
                    min={0}
                    onValueChange={(v) => {
                      setLines((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, quantity: v } : row)),
                      );
                    }}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <NumericInput
                    className="h-8 text-right"
                    value={line.unitCost}
                    min={0}
                    onValueChange={(v) => {
                      setLines((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, unitCost: v } : row)),
                      );
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <p className="text-sm text-muted-foreground text-right">
          {t.adjustmentHistoryUi.documentTotal}: {totalValue.toLocaleString()}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
