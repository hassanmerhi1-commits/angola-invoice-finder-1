import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';
import { AlertCircle, Plus, Search } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { fiscalInvoiceTypeLabel } from '@/lib/fiscalInvoiceType';
import { formatTaxLabel, taxRatesFromSaleItems } from '@/lib/taxUtils';
import {
  buildCustomDebitLine,
  buildDebitLinesFromSale,
  debitPreviewTotals,
  filterDebitEligibleSales,
  listDebitEligibleSales,
  recalcDebitLine,
  type DebitLineDraft,
} from '@/lib/debitNoteUtils';
import type { DebitNote, DebitNoteItem, Sale } from '@/types/erp';

type DebitNoteCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sales: Sale[];
  debitNotes: DebitNote[];
  initialSaleId?: string | null;
  onSubmit: (payload: {
    sale: Sale;
    reason: DebitNote['reason'];
    description: string;
    items: DebitNoteItem[];
  }) => Promise<void>;
  submitting?: boolean;
};

const TAX_OPTIONS = [0, 7, 14];

export function DebitNoteCreateDialog({
  open,
  onOpenChange,
  sales,
  debitNotes,
  initialSaleId,
  onSubmit,
  submitting = false,
}: DebitNoteCreateDialogProps) {
  const { t, language } = useTranslation();
  const fd = t.fiscalDocumentsUi;
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [debitReason, setDebitReason] = useState<DebitNote['reason']>('additional_charge');
  const [debitDescription, setDebitDescription] = useState('');
  const [debitLines, setDebitLines] = useState<DebitLineDraft[]>([]);

  const eligibleSales = useMemo(
    () => listDebitEligibleSales(sales, debitNotes),
    [sales, debitNotes],
  );

  const filteredEntries = useMemo(
    () => filterDebitEligibleSales(eligibleSales, { searchTerm, dateFilter: 'all' }),
    [eligibleSales, searchTerm],
  );

  const selectedContext = useMemo(
    () => (selectedSale ? eligibleSales.find((ctx) => ctx.sale.id === selectedSale.id) : null),
    [selectedSale, eligibleSales],
  );

  const previewTotals = useMemo(() => debitPreviewTotals(debitLines), [debitLines]);

  const resetForm = useCallback(() => {
    setSearchTerm('');
    setSelectedSale(null);
    setDebitReason('additional_charge');
    setDebitDescription('');
    setDebitLines([]);
  }, []);

  const applySale = useCallback((sale: Sale) => {
    if (sale.status !== 'completed') return;
    setSelectedSale(sale);
    setDebitLines(buildDebitLinesFromSale(sale));
  }, []);

  const applyReasonTemplate = useCallback((reason: DebitNote['reason'], sale: Sale | null) => {
    if (!sale) return;
    if (reason === 'interest' || reason === 'other') {
      setDebitLines([buildCustomDebitLine()]);
      return;
    }
    setDebitLines(buildDebitLinesFromSale(sale));
  }, []);

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

  const updateLine = (index: number, patch: Partial<DebitLineDraft>) => {
    setDebitLines((prev) => {
      const next = [...prev];
      next[index] = recalcDebitLine({ ...next[index], ...patch });
      return next;
    });
  };

  const handleReasonChange = (reason: DebitNote['reason']) => {
    setDebitReason(reason);
    applyReasonTemplate(reason, selectedSale);
  };

  const handleSubmit = async () => {
    if (!selectedSale) return;
    const items = previewTotals.active.map(
      ({ sourceProductId: _s, soldQty: _q, originalUnitPrice: _p, ...item }) => item,
    );
    if (items.length === 0) return;
    await onSubmit({
      sale: selectedSale,
      reason: debitReason,
      description: debitDescription,
      items,
    });
  };

  const useSaleLines = debitReason === 'price_adjustment' || debitReason === 'additional_charge';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <DialogContent className="max-w-3xl h-[min(720px,90vh)] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>{fd.newDebitNoteTitle}</DialogTitle>
          <DialogDescription>{fd.newDebitNoteSubtitle}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col px-6 py-3 overflow-hidden">
          {!selectedSale ? (
            <div className="flex flex-1 min-h-0 flex-col gap-3">
              <p className="text-xs text-muted-foreground shrink-0">{fd.debitRequiresInvoice}</p>
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
                {fd.debitInvoicePickerCount.replace('{count}', String(filteredEntries.length))}
              </p>
              <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
                {filteredEntries.length === 0 ? (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    <div className="space-y-2">
                      <AlertCircle className="w-8 h-8 mx-auto opacity-50" />
                      <p className="font-medium">{fd.noDebitEligibleInvoices}</p>
                      <p>{fd.noDebitEligibleInvoicesHint}</p>
                    </div>
                  </div>
                ) : (
                  <ScrollArea className="h-full">
                    <div className="divide-y">
                      {filteredEntries.map(({ sale, priorDebitCount, priorDebitTotal, lines }) => (
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
                              {priorDebitCount > 0 && (
                                <p className="text-xs text-amber-700">
                                  {fd.priorDebitNotesOnInvoice
                                    .replace('{count}', String(priorDebitCount))
                                    .replace('{total}', priorDebitTotal.toLocaleString(uiLocale))}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {lines.slice(0, 3).map((line) => (
                              <Badge key={line.item.productId} variant="secondary" className="text-[10px] font-normal">
                                {line.item.productName} × {line.soldQty}
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
              <div className="shrink-0 p-3 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {fd.invoiceLabel} {selectedSale.invoiceNumber}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {selectedSale.customerName || fd.finalConsumer}
                      {selectedSale.customerNif ? ` · NIF ${selectedSale.customerNif}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fd.colOriginalInvoice}: {selectedSale.invoiceNumber}
                      {' · '}{selectedSale.total.toLocaleString(uiLocale)} Kz
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => setSelectedSale(null)}>
                    {fd.changeInvoice}
                  </Button>
                </div>
                {selectedContext && selectedContext.priorDebitCount > 0 && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    {fd.priorDebitNotesOnInvoice
                      .replace('{count}', String(selectedContext.priorDebitCount))
                      .replace('{total}', selectedContext.priorDebitTotal.toLocaleString(uiLocale))}
                  </p>
                )}
              </div>

              <div className="shrink-0 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{fd.reasonLabel}</Label>
                  <Select value={debitReason} onValueChange={(v) => handleReasonChange(v as DebitNote['reason'])}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="price_adjustment">{fd.debitReasonPriceAdjustment}</SelectItem>
                      <SelectItem value="additional_charge">{fd.debitReasonAdditionalCharge}</SelectItem>
                      <SelectItem value="interest">{fd.debitReasonInterest}</SelectItem>
                      <SelectItem value="other">{fd.other}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t.common.description}</Label>
                  <Input
                    value={debitDescription}
                    onChange={(e) => setDebitDescription(e.target.value)}
                    placeholder={fd.debitNoteReasonPlaceholder}
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
                <div className="flex items-center justify-between shrink-0">
                  <Label className="text-xs">{useSaleLines ? fd.itemsToDebitFromInvoice : fd.itemsToDebit}</Label>
                  {!useSaleLines && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDebitLines((prev) => [...prev, buildCustomDebitLine()])}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      {fd.addCustomLine}
                    </Button>
                  )}
                </div>
                <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
                  <ScrollArea className="h-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{fd.colProduct}</TableHead>
                          {useSaleLines && (
                            <>
                              <TableHead className="text-right">{fd.colSoldQty}</TableHead>
                              <TableHead className="text-right">{fd.colOriginalPrice}</TableHead>
                            </>
                          )}
                          <TableHead className="text-right">{fd.colQty}</TableHead>
                          <TableHead className="text-right">{fd.colUnitPrice}</TableHead>
                          <TableHead className="text-right">{fd.colTaxRate}</TableHead>
                          <TableHead className="text-right">{fd.colTotal}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {debitLines.map((line, idx) => (
                          <TableRow key={line.sourceProductId || `custom-${idx}`}>
                            <TableCell className="max-w-[180px]">
                              {useSaleLines ? (
                                <span className="truncate block font-medium" title={line.description}>
                                  {line.description}
                                </span>
                              ) : (
                                <Input
                                  value={line.description}
                                  placeholder={fd.interestLinePlaceholder}
                                  onChange={(e) => updateLine(idx, { description: e.target.value })}
                                  className="h-8"
                                />
                              )}
                            </TableCell>
                            {useSaleLines && (
                              <>
                                <TableCell className="text-right text-muted-foreground">{line.soldQty ?? '—'}</TableCell>
                                <TableCell className="text-right text-muted-foreground whitespace-nowrap">
                                  {(line.originalUnitPrice ?? 0).toLocaleString(uiLocale)}
                                </TableCell>
                              </>
                            )}
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.quantity || ''}
                                onChange={(e) => updateLine(idx, { quantity: parseFloat(e.target.value) || 0 })}
                                className="w-16 h-8 text-right ml-auto"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.unitPrice || ''}
                                onChange={(e) => updateLine(idx, { unitPrice: parseFloat(e.target.value) || 0 })}
                                className="w-24 h-8 text-right ml-auto"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Select
                                value={String(line.taxRate)}
                                onValueChange={(v) => updateLine(idx, { taxRate: parseFloat(v) })}
                              >
                                <SelectTrigger className="w-16 h-8 ml-auto">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TAX_OPTIONS.map((rate) => (
                                    <SelectItem key={rate} value={String(rate)}>{rate}%</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap font-medium">
                              {(line.subtotal + line.taxAmount).toLocaleString(uiLocale)} Kz
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </div>

              {debitDescription.trim() === '' && (
                <p className="text-xs text-amber-700 shrink-0">{fd.debitDescriptionRequired}</p>
              )}

              <div className="shrink-0 flex justify-between items-center text-sm border-t pt-2">
                <span className="text-muted-foreground">
                  {selectedSale
                    ? formatTaxLabel(taxRatesFromSaleItems(selectedSale.items), t.pos.tax)
                    : t.pos.tax}
                  : {previewTotals.taxAmount.toLocaleString(uiLocale)} Kz
                </span>
                <span className="font-bold">
                  {fd.debitSummaryTotal}: {previewTotals.total.toLocaleString(uiLocale)} Kz
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
            disabled={
              !selectedSale
              || previewTotals.active.length === 0
              || !debitDescription.trim()
              || submitting
            }
          >
            {fd.issueDebitNote}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
