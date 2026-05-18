// NEXOR ERP Document Creation/Edit Dialog
// Used for all document types: Proforma, Fatura, Recibo, Pagamento, etc.

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Trash2, Search, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DocumentType, DocumentLine, ERPDocument, DOCUMENT_TYPE_CONFIG } from '@/types/documents';
import { calculateLineTotals, calculateDocumentTotals, createDocument, saveDocument } from '@/lib/documentStorage';
import { useProducts, useAuth } from '@/hooks/useERP';
import { useBranchContext } from '@/contexts/BranchContext';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/i18n';

interface DocumentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentType: DocumentType;
  editDocument?: ERPDocument | null;
  prefillFrom?: ERPDocument | null;  // for conversions
  onSaved?: (doc: ERPDocument) => void;
}

export function DocumentFormDialog({ open, onOpenChange, documentType, editDocument, prefillFrom, onSaved }: DocumentFormDialogProps) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { user } = useAuth();
  const { currentBranch } = useBranchContext();
  const { products } = useProducts(currentBranch?.id);
  const config = DOCUMENT_TYPE_CONFIG[documentType];
  const typeUi = (t.documentFormUi.types as Record<DocumentType, { full: string; short: string }>)[documentType];
  const finalConsumerName = t.pos.finalConsumer;
  const fmt = (n: number, opts?: Intl.NumberFormatOptions) =>
    n.toLocaleString(locale, { minimumFractionDigits: opts?.minimumFractionDigits, maximumFractionDigits: opts?.maximumFractionDigits });

  // Form state
  const [entityName, setEntityName] = useState('');
  const [entityNif, setEntityNif] = useState('');
  const [entityAddress, setEntityAddress] = useState('');
  const [entityPhone, setEntityPhone] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [amountPaid, setAmountPaid] = useState(0);
  const [lines, setLines] = useState<DocumentLine[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [activeLineTab, setActiveLineTab] = useState('linhas');

  // Reset form when opening
  useEffect(() => {
    if (open) {
      const source = editDocument || prefillFrom;
      if (source) {
        setEntityName(source.entityName);
        setEntityNif(source.entityNif || '');
        setEntityAddress(source.entityAddress || '');
        setEntityPhone(source.entityPhone || '');
        setDueDate(source.dueDate || '');
        setValidUntil(source.validUntil || '');
        setNotes(source.notes || '');
        setPaymentMethod(source.paymentMethod || 'cash');
        setAmountPaid(source.amountPaid || 0);
        setLines(source.lines.map(l => ({ ...l })));
      } else {
        setEntityName('');
        setEntityNif('');
        setEntityAddress('');
        setEntityPhone('');
        setDueDate('');
        setValidUntil('');
        setNotes('');
        setPaymentMethod('cash');
        setAmountPaid(0);
        setLines([]);
      }
    }
  }, [open, editDocument, prefillFrom]);

  // Filtered products for search
  const filteredProducts = useMemo(() => {
    if (!productSearch) return products.slice(0, 20);
    const q = productSearch.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.barcode && p.barcode.includes(q))
    ).slice(0, 20);
  }, [products, productSearch]);

  // Totals
  const totals = useMemo(() => calculateDocumentTotals(lines), [lines]);

  // IVA summary grouped by rate (AGT requirement)
  const ivaSummary = useMemo(() => {
    const map = new Map<number, { base: number; iva: number; total: number }>();
    for (const line of lines) {
      const base = (line.quantity * line.unitPrice) * (1 - (line.discount || 0) / 100);
      const existing = map.get(line.taxRate) || { base: 0, iva: 0, total: 0 };
      existing.base += base;
      existing.iva += line.taxAmount;
      existing.total += line.lineTotal;
      map.set(line.taxRate, existing);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [lines]);

  const addLine = (productId?: string) => {
    const product = productId ? products.find(p => p.id === productId) : null;
    const newLine = calculateLineTotals({
      description: product ? product.name : '',
      productId: product?.id,
      productSku: product?.sku,
      quantity: 1,
      unitPrice: product?.price || 0,
      discount: 0,
      taxRate: product?.taxRate || 14,
    });
    setLines(prev => [...prev, newLine]);
    setProductSearch('');
  };

  const updateLine = (index: number, field: keyof DocumentLine, value: any) => {
    setLines(prev => {
      const updated = [...prev];
      const line = { ...updated[index], [field]: value };
      updated[index] = calculateLineTotals(line);
      return updated;
    });
  };

  const removeLine = (index: number) => {
    setLines(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async (status: 'draft' | 'confirmed') => {
    if (!entityName && config.entityType === 'customer') {
      setEntityName(finalConsumerName);
    }
    if (lines.length === 0) {
      toast.error(t.documentFormUi.addAtLeastOneLine);
      return;
    }

    try {
      if (editDocument) {
        const updated: ERPDocument = {
          ...editDocument,
          entityName: entityName || finalConsumerName,
          entityNif,
          entityAddress,
          entityPhone,
          lines,
          ...totals,
          paymentMethod: paymentMethod as any,
          amountPaid: config.requiresPayment ? amountPaid : 0,
          amountDue: config.requiresPayment ? totals.total - amountPaid : totals.total,
          dueDate,
          validUntil,
          notes,
          status,
        };
        await saveDocument(updated);
        onSaved?.(updated);
        toast.success(t.documentFormUi.documentUpdatedToast.replace('{short}', typeUi.short));
      } else {
        // For confirmed fatura_venda, route through the backend transaction engine
        // so stock is decremented and journal entries (including branch Caixa) are created
        if (documentType === 'fatura_venda' && status === 'confirmed') {
          const insufficientStock = lines
            .map(line => {
              if (!line.productId) return null;
              const product = products.find(p => p.id === line.productId);
              if (!product) return null;
              return line.quantity > product.stock
                ? t.documentFormUi.stockLineDetail
                    .replace('{name}', line.description)
                    .replace('{available}', String(product.stock))
                    .replace('{requested}', String(line.quantity))
                : null;
            })
            .filter(Boolean);

          if (insufficientStock.length > 0) {
            throw new Error(`${t.documentFormUi.stockInsufficientPrefix} ${insufficientStock.join('; ')}`);
          }

          const saleItems = lines.map(l => ({
            productId: l.productId || `manual-${l.description}`,
            productName: l.description,
            sku: l.productSku || '',
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount || 0,
            taxRate: l.taxRate,
            taxAmount: l.taxAmount,
            subtotal: l.lineTotal - l.taxAmount,
          }));

          const branchId = currentBranch?.id || '';
          const branchCode = currentBranch?.code || 'SEDE';

          // Generate invoice number from backend
          let invoiceNumber = '';
          try {
            const numResult = await api.sales.generateInvoiceNumber(branchCode);
            invoiceNumber = numResult.data?.invoiceNumber || `FT ${branchCode}/${Date.now()}`;
          } catch {
            invoiceNumber = `FT ${branchCode}/${Date.now()}`;
          }

          const saleResult = await api.sales.create({
            invoiceNumber,
            branchId,
            cashierId: user?.id || '',
            cashierName: user?.name || '',
            items: saleItems,
            subtotal: totals.subtotal,
            taxAmount: totals.totalTax,
            discount: totals.totalDiscount,
            total: totals.total,
            paymentMethod: paymentMethod || 'cash',
            amountPaid: config.requiresPayment ? amountPaid : totals.total,
            change: config.requiresPayment ? Math.max(0, amountPaid - totals.total) : 0,
            customerNif: entityNif || undefined,
            customerName: (entityName || finalConsumerName) || undefined,
          });

          if (!saleResult.data) {
            const saleError = saleResult.error || t.documentFormUi.saleServerFailed;
            if (saleError.includes('chk_products_stock_nonneg') || saleError.toLowerCase().includes('stock insuficiente')) {
              throw new Error(t.documentFormUi.insufficientStockToCompleteSaleInvoice);
            }
            throw new Error(saleError);
          }

          // Also save as ERP document for the document list
          const doc = await createDocument(
            documentType,
            branchId,
            branchCode,
            currentBranch?.name || '',
            user?.id || '',
            user?.name || '',
            {
              entityName: entityName || finalConsumerName,
              entityNif,
              entityAddress,
              entityPhone,
              lines,
              ...totals,
              paymentMethod: paymentMethod as any,
              amountPaid: config.requiresPayment ? amountPaid : totals.total,
              amountDue: 0,
              notes,
              status: 'confirmed',
            }
          );
          onSaved?.(doc);
          toast.success(
            t.documentFormUi.documentCreatedWithStockToast
              .replace('{short}', typeUi.short)
              .replace('{number}', doc.documentNumber),
          );
        } else {
          // All other document types (proforma, draft, etc.) — save locally
          const doc = await createDocument(
            documentType,
            currentBranch?.id || '',
            currentBranch?.code || 'SEDE',
            currentBranch?.name || '',
            user?.id || '',
            user?.name || '',
            {
              entityName: entityName || finalConsumerName,
              entityNif,
              entityAddress,
              entityPhone,
              lines,
              ...totals,
              paymentMethod: paymentMethod as any,
              amountPaid: config.requiresPayment ? amountPaid : 0,
              amountDue: config.requiresPayment ? totals.total - amountPaid : totals.total,
              parentDocumentId: prefillFrom?.id,
              parentDocumentNumber: prefillFrom?.documentNumber,
              parentDocumentType: prefillFrom?.documentType,
              dueDate,
              validUntil,
              notes,
              status,
            }
          );
          onSaved?.(doc);
          toast.success(
            t.documentFormUi.documentCreatedToast
              .replace('{short}', typeUi.short)
              .replace('{number}', doc.documentNumber),
          );
        }
      }
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || t.documentFormUi.saveError);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
          <DialogTitle className={cn("text-sm font-bold", config.color)}>
            {editDocument
              ? `${t.documentFormUi.editPrefix} ${typeUi.short} — ${editDocument.documentNumber}`
              : `${t.documentFormUi.newPrefix} ${typeUi.full}`}
            {prefillFrom && (
              <span className="text-muted-foreground font-normal ml-2">
                {t.documentFormUi.fromDocument.replace('{number}', prefillFrom.documentNumber)}
              </span>
            )}
          </DialogTitle>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleSave('draft')}>
              <Save className="w-3 h-3" /> {t.documentFormUi.saveDraft}
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleSave('confirmed')}>
              <Save className="w-3 h-3" /> {t.documentFormUi.confirmSave}
            </Button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Entity info row */}
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{config.entityType === 'customer' ? t.documentFormUi.customer : t.documentFormUi.supplier}</Label>
              <Input value={entityName} onChange={e => setEntityName(e.target.value)} placeholder={finalConsumerName} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.documentFormUi.nif}</Label>
              <Input value={entityNif} onChange={e => setEntityNif(e.target.value)} placeholder="999999999" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.documentFormUi.address}</Label>
              <Input value={entityAddress} onChange={e => setEntityAddress(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.documentFormUi.phone}</Label>
              <Input value={entityPhone} onChange={e => setEntityPhone(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          {/* Dates & payment row */}
          <div className="grid grid-cols-4 gap-3">
            {documentType === 'proforma' && (
              <div className="space-y-1">
                <Label className="text-xs">{t.documentFormUi.validUntil}</Label>
                <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="h-8 text-xs" />
              </div>
            )}
            {(documentType !== 'proforma') && (
              <div className="space-y-1">
                <Label className="text-xs">{t.documentFormUi.dueDate}</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-8 text-xs" />
              </div>
            )}
            {config.requiresPayment && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">{t.documentFormUi.paymentMethod}</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t.paymentsUi.methods.cash}</SelectItem>
                      <SelectItem value="card">{t.paymentsUi.methods.card}</SelectItem>
                      <SelectItem value="transfer">{t.paymentsUi.methods.transfer}</SelectItem>
                      <SelectItem value="cheque">{t.paymentsUi.methods.cheque}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t.documentFormUi.amountPaid}</Label>
                  <Input type="number" value={amountPaid} onChange={e => setAmountPaid(Number(e.target.value))} className="h-8 text-xs" />
                </div>
              </>
            )}
          </div>

          {/* Product search + add */}
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">{t.documentFormUi.addProduct}</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input value={productSearch} onChange={e => setProductSearch(e.target.value)}
                  placeholder={t.documentFormUi.productSearchPlaceholder} className="h-8 text-xs pl-7" />
              </div>
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => addLine()}>
              <Plus className="w-3 h-3" /> {t.documentFormUi.manualLine}
            </Button>
          </div>

          {/* Product search results */}
          {productSearch && filteredProducts.length > 0 && (
            <div className="border rounded max-h-32 overflow-y-auto">
              {filteredProducts.map(p => (
                <button key={p.id} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 flex justify-between"
                  onClick={() => addLine(p.id)}>
                  <span><span className="font-mono text-muted-foreground">{p.sku}</span> {p.name}</span>
                  <span className="font-mono">{p.price.toLocaleString(locale)} Kz</span>
                </button>
              ))}
            </div>
          )}

          {/* Lines tabs */}
          <Tabs value={activeLineTab} onValueChange={setActiveLineTab}>
            <TabsList className="h-7 p-0 bg-muted/30 rounded-none border-b w-full justify-start">
              <TabsTrigger value="linhas" className="text-xs h-7 rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
                {t.documentFormUi.linesCount.replace('{count}', String(lines.length))}
              </TabsTrigger>
              <TabsTrigger value="notas" className="text-xs h-7 rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
                {t.documentFormUi.notesTab}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="linhas" className="mt-0">
              <div className="border rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 border-b">
                    <tr>
                      <th className="px-2 py-1.5 text-left w-8">{t.documentFormUi.colHash}</th>
                      <th className="px-2 py-1.5 text-left w-20">{t.documentFormUi.colCode}</th>
                      <th className="px-2 py-1.5 text-left">{t.documentFormUi.colDescription}</th>
                      <th className="px-2 py-1.5 text-right w-16">{t.documentFormUi.colQty}</th>
                      <th className="px-2 py-1.5 text-right w-24">{t.documentFormUi.colPriceExVat}</th>
                      <th className="px-2 py-1.5 text-right w-16">{t.documentFormUi.colDiscPct}</th>
                      <th className="px-2 py-1.5 text-right w-20">{t.documentFormUi.colTaxableBase}</th>
                      <th className="px-2 py-1.5 text-right w-14">{t.documentFormUi.colVatPct}</th>
                      <th className="px-2 py-1.5 text-right w-24">{t.documentFormUi.colVatAmount}</th>
                      <th className="px-2 py-1.5 text-right w-28">{t.documentFormUi.colTotalIncVat}</th>
                      <th className="px-2 py-1.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {lines.map((line, idx) => (
                      <tr key={line.id} className="hover:bg-accent/30">
                        <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                        <td className="px-2 py-1">
                          <Input value={line.productSku || ''} readOnly className="h-6 text-xs border-0 bg-transparent p-0" />
                        </td>
                        <td className="px-2 py-1">
                          <Input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                            className="h-6 text-xs border-0 bg-transparent p-0 focus:bg-background focus:border" />
                        </td>
                        <td className="px-2 py-1">
                          <NumericInput integer min={0} value={line.quantity} onValueChange={v => updateLine(idx, 'quantity', v)}
                            className="h-6 text-xs text-right border-0 bg-transparent p-0 focus:bg-background focus:border w-full" />
                        </td>
                        <td className="px-2 py-1">
                          <NumericInput min={0} value={line.unitPrice} onValueChange={v => updateLine(idx, 'unitPrice', v)}
                            className="h-6 text-xs text-right border-0 bg-transparent p-0 focus:bg-background focus:border w-full" />
                        </td>
                        <td className="px-2 py-1">
                          <NumericInput min={0} value={line.discount} onValueChange={v => updateLine(idx, 'discount', v)}
                            className="h-6 text-xs text-right border-0 bg-transparent p-0 focus:bg-background focus:border w-full" />
                        </td>
                        <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                          {fmt((line.quantity * line.unitPrice) * (1 - (line.discount || 0) / 100))}
                        </td>
                        <td className="px-2 py-1">
                          <NumericInput min={0} max={100} value={line.taxRate} onValueChange={v => updateLine(idx, 'taxRate', v)}
                            className="h-6 text-xs text-right border-0 bg-transparent p-0 focus:bg-background focus:border w-full" />
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{fmt(line.taxAmount)}</td>
                        <td className="px-2 py-1 text-right font-mono font-medium">{fmt(line.lineTotal)}</td>
                        <td className="px-2 py-1">
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeLine(idx)}>
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {lines.length === 0 && (
                      <tr><td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">{t.documentFormUi.lineEmpty}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="notas" className="mt-2">
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t.documentFormUi.notesPlaceholder} rows={3} className="text-xs" />
            </TabsContent>
          </Tabs>

          {/* IVA Summary Table (AGT Requirement) */}
          {ivaSummary.length > 0 && (
            <div className="border rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">{t.documentFormUi.taxSummaryTitle}</th>
                    <th className="px-3 py-1.5 text-right font-medium">{t.documentFormUi.taxableBase}</th>
                    <th className="px-3 py-1.5 text-right font-medium">{t.documentFormUi.vatRate}</th>
                    <th className="px-3 py-1.5 text-right font-medium">{t.documentFormUi.vatAmount}</th>
                    <th className="px-3 py-1.5 text-right font-medium">{t.documentFormUi.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {ivaSummary.map(([rate, vals]) => (
                    <tr key={rate} className="border-t">
                      <td className="px-3 py-1">{rate === 0 ? t.documentFormUi.exempt : t.documentFormUi.vatAtRate.replace('{rate}', String(rate))}</td>
                      <td className="px-3 py-1 text-right font-mono">{fmt(vals.base, { minimumFractionDigits: 2 })} Kz</td>
                      <td className="px-3 py-1 text-right">{rate}%</td>
                      <td className="px-3 py-1 text-right font-mono">{fmt(vals.iva, { minimumFractionDigits: 2 })} Kz</td>
                      <td className="px-3 py-1 text-right font-mono font-medium">{fmt(vals.total, { minimumFractionDigits: 2 })} Kz</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals panel */}
          <div className="flex justify-end">
            <div className="w-72 space-y-1 text-xs border rounded p-3 bg-muted/30">
              <div className="flex justify-between"><span>{t.documentFormUi.subtotalExVat}</span><span className="font-mono">{fmt(totals.subtotal)} Kz</span></div>
              <div className="flex justify-between text-muted-foreground"><span>{t.documentFormUi.discount}</span><span className="font-mono">-{fmt(totals.totalDiscount)} Kz</span></div>
              <div className="flex justify-between text-muted-foreground"><span>{t.documentFormUi.totalVat}</span><span className="font-mono">{fmt(totals.totalTax)} Kz</span></div>
              <div className="border-t pt-1 flex justify-between font-bold text-sm">
                <span>{t.documentFormUi.totalIncVat}</span><span className="font-mono">{fmt(totals.total)} Kz</span>
              </div>
              {config.requiresPayment && (
                <>
                  <div className="flex justify-between text-green-600"><span>{t.documentFormUi.paid}</span><span className="font-mono">{fmt(amountPaid)} Kz</span></div>
                  <div className="flex justify-between text-destructive font-medium"><span>{t.documentFormUi.outstanding}</span><span className="font-mono">{fmt(totals.total - amountPaid)} Kz</span></div>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
