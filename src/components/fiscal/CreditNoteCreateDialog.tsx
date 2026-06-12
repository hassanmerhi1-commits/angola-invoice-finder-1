import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';
import { AlertCircle, Package, RotateCcw, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { fiscalInvoiceTypeLabel } from '@/lib/fiscalInvoiceType';
import { formatTaxLabel, taxRatesFromSaleItems } from '@/lib/taxUtils';
import {
  buildCreditItemsFromContext,
  buildCreditLineAmounts,
  filterCreditableSales,
  getCreditedQtyBySale,
  getSaleCreditContext,
  listCreditableSales,
} from '@/lib/creditNoteUtils';
import type { CreditNote, CreditNoteItem, Sale } from '@/types/erp';

type CreditNoteCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sales: Sale[];
  creditNotes: CreditNote[];
  initialSaleId?: string | null;
  onSubmit: (payload: {
    sale: Sale;
    reason: CreditNote['reason'];
    description: string;
    items: CreditNoteItem[];
    restoreStock: boolean;
  }) => Promise<void>;
  submitting?: boolean;
};

export function CreditNoteCreateDialog({
  open,
  onOpenChange,
  sales,
  creditNotes,
  initialSaleId,
  onSubmit,
  submitting = false,
}: CreditNoteCreateDialogProps) {
  const { t, language } = useTranslation();
  const fd = t.fiscalDocumentsUi;
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [creditReason, setCreditReason] = useState<CreditNote['reason']>('return');
  const [creditDescription, setCreditDescription] = useState('');
  const [creditItems, setCreditItems] = useState<CreditNoteItem[]>([]);
  const [restoreStock, setRestoreStock] = useState(true);

  const creditedQtyBySale = useMemo(() => getCreditedQtyBySale(creditNotes), [creditNotes]);

  const creditableSales = useMemo(
    () => listCreditableSales(sales, creditNotes),
    [sales, creditNotes],
  );

  const filteredEntries = useMemo(
    () => filterCreditableSales(creditableSales, { searchTerm, dateFilter: 'all' }),
    [creditableSales, searchTerm],
  );

  const selectedSaleContext = useMemo(
    () => (selectedSale ? getSaleCreditContext(selectedSale, creditedQtyBySale) : null),
    [selectedSale, creditedQtyBySale],
  );

  const creditPreviewTotals = useMemo(() => {
    const subtotal = creditItems.reduce((sum, item) => sum + item.subtotal, 0);
    const taxAmount = creditItems.reduce((sum, item) => sum + item.taxAmount, 0);
    return { subtotal, taxAmount, total: subtotal + taxAmount };
  }, [creditItems]);

  const resetForm = useCallback(() => {
    setSearchTerm('');
    setSelectedSale(null);
    setCreditReason('return');
    setCreditDescription('');
    setCreditItems([]);
    setRestoreStock(true);
  }, []);

  const applySale = useCallback((sale: Sale) => {
    const ctx = getSaleCreditContext(sale, creditedQtyBySale);
    if (ctx.fullyCredited || sale.status !== 'completed') return;
    setSelectedSale(sale);
    setRestoreStock(true);
    setCreditItems(buildCreditItemsFromContext(ctx));
  }, [creditedQtyBySale]);

  useEffect(() => {
    if (!open) {
      resetForm();
      return;
    }
    if (!initialSaleId) return;
    const sale = sales.find((s) => s.id === initialSaleId);
    if (sale) applySale(sale);
  }, [open, initialSaleId, sales, applySale, resetForm]);

  const paymentMethodLabel = (method: Sale['paymentMethod']) => {
    if (method === 'cash') return t.pos.cash;
    if (method === 'card') return t.pos.card;
    if (method === 'transfer') return t.pos.transfer;
    return method;
  };

  const handleSubmit = async () => {
    if (!selectedSale || creditItems.every((item) => item.quantity === 0)) return;
    await onSubmit({
      sale: selectedSale,
      reason: creditReason,
      description: creditDescription,
      items: creditItems.filter((item) => item.quantity > 0),
      restoreStock,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <DialogContent className="max-w-3xl h-[min(680px,88vh)] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>{fd.newCreditNoteTitle}</DialogTitle>
          <DialogDescription>{fd.newCreditNoteSubtitle}</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-3 border-b bg-muted/40 space-y-2 shrink-0">
          <Label className="text-sm font-semibold">{fd.restoreStockLabel}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={restoreStock ? 'default' : 'outline'}
              className="gap-2 h-auto py-2.5"
              onClick={() => setRestoreStock(true)}
            >
              <RotateCcw className="h-4 w-4" />
              {fd.restoreStockYes}
            </Button>
            <Button
              type="button"
              variant={!restoreStock ? 'secondary' : 'outline'}
              className="h-auto py-2.5"
              onClick={() => setRestoreStock(false)}
            >
              {fd.restoreStockNo}
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-6 py-3 overflow-hidden">
          {!selectedSale ? (
            <div className="flex flex-1 min-h-0 flex-col gap-3">
              <div className="relative shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={fd.searchInvoicePlaceholder}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <p className="text-xs text-muted-foreground shrink-0">
                {fd.invoicePickerCount.replace('{count}', String(filteredEntries.length))}
              </p>
              <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
                {filteredEntries.length === 0 ? (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    <div className="space-y-2">
                      <AlertCircle className="w-8 h-8 mx-auto opacity-50" />
                      <p className="font-medium">{fd.noCreditableInvoices}</p>
                      <p>{fd.noCreditableInvoicesHint}</p>
                    </div>
                  </div>
                ) : (
                  <ScrollArea className="h-full">
                    <div className="divide-y">
                      {filteredEntries.map(({ sale, lines, totalRemaining }) => (
                        <button
                          key={sale.id}
                          type="button"
                          className="w-full p-3 text-left hover:bg-muted/70 transition-colors"
                          onClick={() => applySale(sale)}
                        >
                          <div className="flex justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">{sale.invoiceNumber}</span>
                                <Badge variant="outline" className="text-[10px]">
                                  {fiscalInvoiceTypeLabel(sale.invoiceType || 'FT', t.posUi)}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground truncate">
                                {sale.customerName || fd.finalConsumer}
                                {sale.customerNif ? ` · ${sale.customerNif}` : ''}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(sale.createdAt), 'dd/MM/yyyy HH:mm', { locale: dfLocale })}
                                {' · '}{paymentMethodLabel(sale.paymentMethod)}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-semibold">{sale.total.toLocaleString(uiLocale)} Kz</p>
                              <p className="text-xs text-muted-foreground">
                                {totalRemaining} {fd.colRemainingQty.toLowerCase()}
                              </p>
                            </div>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {lines.filter((l) => l.remainingQty > 0).slice(0, 3).map((line) => (
                              <Badge key={line.item.productId} variant="secondary" className="text-[10px] font-normal">
                                {line.item.productName} × {line.remainingQty}
                              </Badge>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-hidden">
              <div className="shrink-0 p-3 bg-muted rounded-lg flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {fd.invoiceLabel} {selectedSale.invoiceNumber}
                  </p>
                  <p className="text-sm text-muted-foreground truncate">
                    {selectedSale.customerName || fd.finalConsumer} · {selectedSale.total.toLocaleString(uiLocale)} Kz
                  </p>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setSelectedSale(null)}>
                  {fd.changeInvoice}
                </Button>
              </div>

              <div className="shrink-0 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{fd.reasonLabel}</Label>
                  <Select value={creditReason} onValueChange={(v) => setCreditReason(v as CreditNote['reason'])}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="return">{fd.creditReasonReturnFull}</SelectItem>
                      <SelectItem value="discount">{fd.creditReasonDiscountFull}</SelectItem>
                      <SelectItem value="error">{fd.creditReasonErrorFull}</SelectItem>
                      <SelectItem value="other">{fd.other}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t.common.description}</Label>
                  <Input
                    value={creditDescription}
                    onChange={(e) => setCreditDescription(e.target.value)}
                    placeholder={fd.creditNoteReasonPlaceholder}
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
                <Label className="text-xs shrink-0">{fd.itemsToCredit}</Label>
                <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
                  <ScrollArea className="h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{fd.colProduct}</TableHead>
                          <TableHead className="text-right">{fd.colSoldQty}</TableHead>
                          <TableHead className="text-right">{fd.colQty}</TableHead>
                          <TableHead className="text-right">{fd.colTotal}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {creditItems.map((item, idx) => {
                          const meta = selectedSaleContext?.lines.find((line) => line.item.productId === item.productId);
                          const maxQty = meta?.remainingQty ?? item.quantity;
                          return (
                            <TableRow key={item.productId || idx}>
                              <TableCell className="font-medium max-w-[200px] truncate" title={item.productName}>
                                {item.productName}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">{meta?.soldQty ?? '—'}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min="0"
                                  max={maxQty}
                                  value={item.quantity}
                                  onChange={(e) => {
                                    const updated = [...creditItems];
                                    const qty = Math.min(maxQty, Math.max(0, parseInt(e.target.value, 10) || 0));
                                    const sourceItem = selectedSale.items.find((i) => i.productId === item.productId);
                                    const { subtotal, taxAmount } = buildCreditLineAmounts(
                                      qty,
                                      item.unitPrice,
                                      sourceItem?.discount || 0,
                                      item.taxRate,
                                    );
                                    updated[idx] = { ...updated[idx], quantity: qty, subtotal, taxAmount };
                                    setCreditItems(updated);
                                  }}
                                  className="w-16 h-8 text-right ml-auto"
                                />
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {(item.subtotal + item.taxAmount).toLocaleString(uiLocale)} Kz
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </div>

              <div className="shrink-0 flex justify-between items-center text-sm border-t pt-2">
                <span className="text-muted-foreground">
                  {formatTaxLabel(taxRatesFromSaleItems(selectedSale.items), t.pos.tax)}:{' '}
                  {creditPreviewTotals.taxAmount.toLocaleString(uiLocale)} Kz
                </span>
                <span className="font-bold">
                  {fd.creditSummaryTotal}: {creditPreviewTotals.total.toLocaleString(uiLocale)} Kz
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!selectedSale || creditItems.every((item) => item.quantity === 0) || submitting}
          >
            {fd.issueCreditNote}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
