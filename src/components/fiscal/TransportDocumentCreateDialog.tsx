import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';
import { AlertCircle, MapPin, Package, Search, Truck } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { fiscalInvoiceTypeLabel } from '@/lib/fiscalInvoiceType';
import { api } from '@/lib/api/client';
import { mapSaleRow } from '@/hooks/useERP';
import type { Client, Product, Sale, TransportDocument, TransportDocumentItem } from '@/types/erp';

export type TransportCreatePayload = {
  type: TransportDocument['type'];
  originAddress: string;
  originCity: string;
  destinationAddress: string;
  destinationCity: string;
  loadingDate: string;
  loadingTime: string;
  items: TransportDocumentItem[];
  destinationNif?: string;
  destinationName?: string;
  transporterName?: string;
  transporterNif?: string;
  vehiclePlate?: string;
  relatedInvoiceId?: string;
  relatedInvoiceNumber?: string;
  notes?: string;
  includePrices: boolean;
};

type TransportDocumentCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sales: Sale[];
  products: Product[];
  clients: Client[];
  branch?: { id: string; name: string; code: string; address?: string } | null;
  originAddressDefault?: string;
  originCityDefault?: string;
  branchId?: string | null;
  initialSaleId?: string | null;
  submitting?: boolean;
  onSubmit: (payload: TransportCreatePayload) => Promise<void>;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function itemsFromSale(sale: Sale, products: Product[]): TransportDocumentItem[] {
  return (sale.items || []).map((item) => {
    const qty = Number(item.quantity) || 0;
    const lineTotal = Number(item.subtotal) || 0;
    const unitPrice = qty > 0 ? lineTotal / qty : Number(item.unitPrice) || 0;
    const product = products.find((p) => p.id === item.productId);
    return {
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      quantity: qty,
      unit: product?.unit || 'UN',
      unitPrice,
      taxRate: item.taxRate,
      lineTotal,
    };
  }).filter((item) => item.quantity > 0);
}

export function TransportDocumentCreateDialog({
  open,
  onOpenChange,
  sales,
  products,
  clients,
  branch,
  originAddressDefault = '',
  originCityDefault = '',
  branchId,
  initialSaleId,
  submitting = false,
  onSubmit,
}: TransportDocumentCreateDialogProps) {
  const { t, language } = useTranslation();
  const fd = t.fiscalDocumentsUi;
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;

  const [step, setStep] = useState<'invoice' | 'guide'>('invoice');
  const [searchTerm, setSearchTerm] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [pickerSales, setPickerSales] = useState<Sale[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [loadingSaleId, setLoadingSaleId] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  const [transportType, setTransportType] = useState<TransportDocument['type']>('delivery');
  const [originAddress, setOriginAddress] = useState(originAddressDefault);
  const [originCity, setOriginCity] = useState(originCityDefault);
  const [destAddress, setDestAddress] = useState('');
  const [destCity, setDestCity] = useState('');
  const [destNif, setDestNif] = useState('');
  const [destName, setDestName] = useState('');
  const [loadingDate, setLoadingDate] = useState(todayIsoDate());
  const [loadingTime, setLoadingTime] = useState('08:00');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [transporterNif, setTransporterNif] = useState('');
  const [items, setItems] = useState<TransportDocumentItem[]>([]);
  const [notes, setNotes] = useState('');
  const [includePrices, setIncludePrices] = useState(false);
  const appliedInitialRef = useRef<string | null>(null);

  const sourceSales = pickerSales.length > 0 ? pickerSales : sales;
  const completedSales = useMemo(
    () => sourceSales.filter((sale) => sale.status === 'completed'),
    [sourceSales],
  );

  const filteredSales = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return completedSales;
    return completedSales.filter((sale) => {
      const hay = [
        sale.invoiceNumber,
        sale.customerName,
        sale.customerNif,
        ...(sale.items || []).map((item) => item.productName),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [completedSales, searchTerm]);

  const catalogMatches = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    const selected = new Set(items.map((item) => item.productId));
    return products
      .filter((product) => product.isActive !== false)
      .filter((product) => !selected.has(product.id))
      .filter((product) => {
        if (!q) return true;
        return `${product.name} ${product.sku}`.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [products, productSearch, items]);

  const goodsTotal = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.lineTotal) || (Number(item.unitPrice) || 0) * item.quantity), 0),
    [items],
  );

  const resetForm = useCallback(() => {
    setStep(initialSaleId ? 'guide' : 'invoice');
    setSearchTerm('');
    setProductSearch('');
    setLoadingSaleId(null);
    setSelectedSale(null);
    setTransportType('delivery');
    setOriginAddress(originAddressDefault || branch?.address || '');
    setOriginCity(originCityDefault || '');
    setDestAddress('');
    setDestCity('');
    setDestNif('');
    setDestName('');
    setLoadingDate(todayIsoDate());
    setLoadingTime('08:00');
    setVehiclePlate('');
    setTransporterName('');
    setTransporterNif('');
    setItems([]);
    setNotes('');
    setIncludePrices(false);
  }, [branch?.address, initialSaleId, originAddressDefault, originCityDefault]);

  const applySale = useCallback(async (sale: Sale) => {
    setLoadingSaleId(sale.id);
    try {
      let full = sale;
      if (!sale.items?.length) {
        const res = await api.sales.get(sale.id);
        if (res.data) full = mapSaleRow(res.data);
      }
      if (!full.items?.length) return;
      const client = clients.find((c) => c.id === full.clientId);
      setSelectedSale(full);
      setTransportType('delivery');
      setDestName(full.customerName || client?.name || '');
      setDestNif(full.customerNif || client?.nif || '');
      setDestAddress(client?.address || '');
      setDestCity(client?.city || '');
      setItems(itemsFromSale(full, products));
      setStep('guide');
    } finally {
      setLoadingSaleId(null);
    }
  }, [clients, products]);

  useEffect(() => {
    if (!open) {
      setPickerSales([]);
      return;
    }
    let cancelled = false;
    setLoadingSales(true);
    void (async () => {
      try {
        const res = await api.sales.list(branchId || undefined, { limit: 300, light: false });
        if (cancelled) return;
        const rows = Array.isArray(res.data)
          ? res.data
          : (res.data as { items?: unknown[] } | undefined)?.items;
        if (Array.isArray(rows) && rows.length > 0) {
          setPickerSales(rows.map(mapSaleRow));
        }
      } catch (e) {
        console.warn('[Transport] full sales refresh failed:', e);
      } finally {
        if (!cancelled) setLoadingSales(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, branchId]);

  useEffect(() => {
    if (!open) {
      appliedInitialRef.current = null;
      resetForm();
      return;
    }
    if (!initialSaleId || appliedInitialRef.current === initialSaleId) return;
    const sale =
      pickerSales.find((s) => s.id === initialSaleId)
      || sales.find((s) => s.id === initialSaleId);
    if (sale) {
      appliedInitialRef.current = initialSaleId;
      void applySale(sale);
    }
  }, [open, initialSaleId, sales, pickerSales, applySale, resetForm]);

  const addProduct = (product: Product) => {
    if (items.some((item) => item.productId === product.id)) return;
    const unitPrice = Number(product.price) || 0;
    setItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: 1,
        unit: product.unit || 'UN',
        unitPrice,
        taxRate: product.taxRate,
        lineTotal: unitPrice,
      },
    ]);
    setProductSearch('');
  };

  const updateQty = (index: number, quantity: number) => {
    const qty = Math.max(1, quantity);
    setItems((prev) => prev.map((item, i) => {
      if (i !== index) return item;
      const unitPrice = Number(item.unitPrice) || 0;
      return { ...item, quantity: qty, lineTotal: unitPrice * qty };
    }));
  };

  const canIssue = items.length > 0 && destAddress.trim().length > 0 && originAddress.trim().length > 0;

  const handleSubmit = async () => {
    if (!canIssue || submitting) return;
    await onSubmit({
      type: transportType,
      originAddress: originAddress.trim(),
      originCity: originCity.trim(),
      destinationAddress: destAddress.trim(),
      destinationCity: destCity.trim(),
      loadingDate,
      loadingTime,
      items,
      destinationNif: destNif.trim() || undefined,
      destinationName: destName.trim() || undefined,
      transporterName: transporterName.trim() || undefined,
      transporterNif: transporterNif.trim() || undefined,
      vehiclePlate: vehiclePlate.trim() || undefined,
      relatedInvoiceId: selectedSale?.id,
      relatedInvoiceNumber: selectedSale?.invoiceNumber,
      notes: notes.trim() || undefined,
      includePrices,
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
      <DialogContent className="max-w-4xl h-[min(860px,92vh)] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-cyan-700" />
            {fd.newTransportTitle}
          </DialogTitle>
          <DialogDescription>{fd.newTransportSubtitlePro}</DialogDescription>
        </DialogHeader>

        {step === 'invoice' ? (
          <div className="flex-1 min-h-0 flex flex-col px-6 py-4 gap-3 overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{fd.selectInvoiceForTransport}</p>
              <Button variant="outline" size="sm" onClick={() => setStep('guide')}>
                {fd.skipInvoice}
              </Button>
            </div>
            <div className="relative shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={fd.searchInvoicePlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {loadingSales
                ? fd.loadingCreditableInvoices
                : fd.invoicePickerCount.replace('{count}', String(filteredSales.length))}
            </p>
            <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
              {filteredSales.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  <div className="space-y-2">
                    <AlertCircle className="w-8 h-8 mx-auto opacity-50" />
                    <p className="font-medium">
                      {loadingSales ? fd.loadingCreditableInvoices : fd.noCreditableInvoices}
                    </p>
                  </div>
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="divide-y">
                    {filteredSales.map((sale) => {
                      const selecting = loadingSaleId === sale.id;
                      return (
                        <button
                          key={sale.id}
                          type="button"
                          className="w-full p-3 text-left hover:bg-muted/70 transition-colors disabled:opacity-60"
                          disabled={!!loadingSaleId}
                          onClick={() => void applySale(sale)}
                        >
                          <div className="flex justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">{sale.invoiceNumber}</span>
                                <Badge variant="outline" className="text-[10px]">
                                  {fiscalInvoiceTypeLabel(sale.invoiceType || 'FT', t.posUi)}
                                </Badge>
                                {selecting && (
                                  <span className="text-[10px] text-muted-foreground">{fd.loadingSaleLines}</span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground truncate">
                                {sale.customerName || fd.finalConsumer}
                                {sale.customerNif ? ` · ${sale.customerNif}` : ''}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(sale.createdAt), 'dd/MM/yyyy HH:mm', { locale: dfLocale })}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-semibold">{sale.total.toLocaleString(uiLocale)} Kz</p>
                              <p className="text-xs text-muted-foreground">
                                {sale.items?.length || sale.itemsCount || 0} {fd.colItems.toLowerCase()}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
            {selectedSale ? (
              <div className="rounded-lg border bg-muted/40 p-3 flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{fd.relatedInvoice}</p>
                  <p className="font-medium truncate">{selectedSale.invoiceNumber}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {selectedSale.customerName || fd.finalConsumer} · {selectedSale.total.toLocaleString(uiLocale)} Kz
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setSelectedSale(null); setStep('invoice'); }}>
                  {fd.changeInvoice}
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-3 flex justify-between items-center gap-3">
                <p className="text-sm text-muted-foreground">{fd.linkInvoiceOptional}</p>
                <Button variant="outline" size="sm" onClick={() => setStep('invoice')}>
                  {fd.linkInvoiceLabel}
                </Button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{fd.transportTypeLabel}</Label>
                <Select value={transportType} onValueChange={(v) => setTransportType(v as TransportDocument['type'])}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delivery">{fd.transportTypeDeliveryFull}</SelectItem>
                    <SelectItem value="transfer">{fd.transportTypeTransferFull}</SelectItem>
                    <SelectItem value="return">{fd.transportTypeReturnFull}</SelectItem>
                    <SelectItem value="consignment">{fd.transportTypeConsignment}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{fd.vehiclePlateLabel}</Label>
                <Input
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value)}
                  placeholder={fd.vehiclePlatePlaceholder}
                  className="h-9"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-cyan-800 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {fd.originTitle}
                </h4>
                <Input value={originAddress} onChange={(e) => setOriginAddress(e.target.value)} placeholder={fd.addressLabel} />
                <Input value={originCity} onChange={(e) => setOriginCity(e.target.value)} placeholder={fd.cityLabel} />
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-cyan-800 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {fd.destinationTitle}
                </h4>
                <Input value={destName} onChange={(e) => setDestName(e.target.value)} placeholder={fd.nameLabel} />
                <Input value={destAddress} onChange={(e) => setDestAddress(e.target.value)} placeholder={fd.addressLabel} />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={destCity} onChange={(e) => setDestCity(e.target.value)} placeholder={fd.cityLabel} />
                  <Input value={destNif} onChange={(e) => setDestNif(e.target.value)} placeholder={fd.destNifLabel} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{fd.loadingDateLabel}</Label>
                <Input type="date" value={loadingDate} onChange={(e) => setLoadingDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{fd.loadingTimeLabel}</Label>
                <Input type="time" value={loadingTime} onChange={(e) => setLoadingTime(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{fd.transporterLabel}</Label>
                <Input
                  value={transporterName}
                  onChange={(e) => setTransporterName(e.target.value)}
                  placeholder={fd.transporterPlaceholder}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{fd.transporterNifLabel}</Label>
                <Input
                  value={transporterNif}
                  onChange={(e) => setTransporterNif(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Package className="h-4 w-4" />
                    {fd.productsToTransport}
                  </p>
                  <p className="text-xs text-muted-foreground">{fd.includePricesHint}</p>
                </div>
                <label className="flex items-center gap-2 text-sm shrink-0">
                  <Switch checked={includePrices} onCheckedChange={setIncludePrices} />
                  {includePrices ? fd.includePricesOn : fd.includePricesOff}
                </label>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder={fd.productsSearchPlaceholder}
                  className="pl-10 h-9"
                />
              </div>
              {productSearch.trim() && catalogMatches.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {catalogMatches.map((product) => (
                    <Button key={product.id} type="button" variant="outline" size="sm" onClick={() => addProduct(product)}>
                      {product.name}
                    </Button>
                  ))}
                </div>
              )}

              {items.length > 0 ? (
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{fd.colProduct}</TableHead>
                        <TableHead className="w-24 text-right">{fd.colQuantity}</TableHead>
                        {includePrices && <TableHead className="w-28 text-right">{fd.colUnitPrice}</TableHead>}
                        {includePrices && <TableHead className="w-28 text-right">{fd.colTotal}</TableHead>}
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, idx) => (
                        <TableRow key={`${item.productId}-${idx}`}>
                          <TableCell>
                            <div className="font-medium">{item.productName}</div>
                            <div className="text-xs text-muted-foreground">{item.sku}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => updateQty(idx, parseInt(e.target.value, 10) || 1)}
                              className="h-8 w-20 ml-auto text-right"
                            />
                          </TableCell>
                          {includePrices && (
                            <TableCell className="text-right">
                              {(Number(item.unitPrice) || 0).toLocaleString(uiLocale)}
                            </TableCell>
                          )}
                          {includePrices && (
                            <TableCell className="text-right font-medium">
                              {(Number(item.lineTotal) || 0).toLocaleString(uiLocale)}
                            </TableCell>
                          )}
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                              ✕
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{fd.manualItemsHint}</p>
              )}

              {includePrices && items.length > 0 && (
                <p className="text-right text-sm font-semibold">
                  {fd.goodsValue}: {goodsTotal.toLocaleString(uiLocale)} Kz
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{fd.notesLabel}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={fd.additionalNotesPlaceholder}
                rows={2}
              />
            </div>
          </div>
        )}

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          {step === 'guide' && (
            <Button onClick={() => void handleSubmit()} disabled={!canIssue || submitting}>
              {fd.issueTransport}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
