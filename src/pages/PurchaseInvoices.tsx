import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { cn, generateId } from '@/lib/utils';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import QRCode from 'qrcode';
import { useProducts, useSuppliers, useAuth } from '@/hooks/useERP';
import { useBranchContext } from '@/contexts/BranchContext';
import { useBranchScope } from '@/hooks/useBranchScope';
import { api } from '@/lib/api/client';
import { DEFAULT_VAT_RATE } from '@/lib/taxUtils';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  PurchaseInvoice,
  PurchaseInvoiceLine,
  PurchaseInvoiceJournalLine,
  calculateLine,
  calculateInvoiceTotals,
  getPurchaseInvoices,
  getPurchaseInvoiceById,
  savePurchaseInvoice,
  resolveSellingPriceFromPurchaseLine,
  allocatePurchaseInvoiceNumber,
  peekPurchaseInvoiceNumber,
} from '@/lib/purchaseInvoiceStorage';
import {
  PRODUCTS_CHANGED_EVENT,
  SUPPLIERS_CHANGED_EVENT,
  OPEN_ITEMS_CHANGED_EVENT,
} from '@/lib/storage';
import { invalidateInventoryGridCacheForBranches } from '@/lib/inventoryGrid';
import { processTransaction } from '@/lib/transactionEngine';
import { ensureSupplierAccount } from '@/lib/chartOfAccountsEngine';
import { Supplier, Product, PurchaseOrder } from '@/types/erp';
import { ProductDetailDialog } from '@/components/inventory/ProductDetailDialog';
import { InlineLineGrid } from '@/components/purchase/InlineLineGrid';
import { PurchaseReturnsTab } from '@/components/purchase/PurchaseReturnsTab';
import { getSupplierReturns } from '@/lib/supplierReturns';
import {
  subscribeSupplierReturnsChanged,
  syncAllPurchaseInvoiceReturnStatuses,
} from '@/lib/supplierReturnSync';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Search, Plus, Save, X, Trash2, Eye, FileText, BookOpen,
  Package, ArrowLeft, CheckCircle, Printer, AlertCircle,
  ShoppingCart, Filter, Calendar, Download, RotateCcw,
} from 'lucide-react';
import { saveDocument } from '@/lib/documentStorage';
import { markPurchaseOrderReceivedFromInvoiceNumber } from '@/lib/storage';
import type { ERPDocument } from '@/types/documents';
import { usePurchaseOrders } from '@/hooks/useERP';
import { purchaseOrderNeedsApproval } from '@/lib/purchaseOrderApproval';
import { CompanySettings, getCompanySettings } from '@/lib/companySettings';
import {
  writePurchaseCreateIntent,
  readPurchaseCreateIntentPending,
  clearPurchaseCreateIntent,
  NEXOR_PURCHASE_NEW_QUERY_KEY,
  PURCHASE_INVOICES_NEW_PATH,
} from '@/lib/nexorPurchaseCreate';
import { NEXOR_TOOLBAR } from '@/lib/nexorToolbarEvents';
import { setContextMenuResolver } from '@/lib/contextMenuRegistry';

function ivaRateToTaxCode(rate: number): string {
  const r = Number(rate || 0);
  if (Math.abs(r - 14) < 0.0001) return 'IVA14';
  if (Math.abs(r - 7) < 0.0001) return 'IVA7';
  if (Math.abs(r - 5) < 0.0001) return 'IVA5';
  if (Math.abs(r - 0) < 0.0001) return 'IVA0';
  // fallback to a generic IVA code (tax engine allows custom codes)
  return `IVA${String(r).replace('.', '_')}`;
}

function roundMoney(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function withholdingRateToTaxCode(rate: number): string {
  const r = Number(rate || 0);
  if (Math.abs(r - 3.5) < 0.0001) return 'RET3.5';
  if (Math.abs(r - 6.5) < 0.0001) return 'RET6.5';
  if (r <= 0) return '';
  return `RET${String(r).replace('.', '_')}`;
}

function buildBarcodePattern(value: string): Array<{ x: number; width: number }> {
  const normalized = String(value || 'NEXOR').replace(/\s+/g, '');
  const bars: Array<{ x: number; width: number }> = [];
  let x = 2;

  // Start guard
  [2, 1, 2].forEach((width) => {
    bars.push({ x, width });
    x += width + 1;
  });

  Array.from(normalized).forEach((char, index) => {
    const code = char.charCodeAt(0) + index * 7;
    const sequence = [
      (code % 4) + 1,
      ((code >> 2) % 3) + 1,
      ((code >> 4) % 4) + 1,
      ((code >> 1) % 2) + 1,
    ];
    sequence.forEach((width) => {
      bars.push({ x, width });
      x += width + 1;
    });
    x += 1;
  });

  // End guard
  [2, 1, 2].forEach((width) => {
    bars.push({ x, width });
    x += width + 1;
  });

  return bars;
}

function buildBarcodeSvgMarkup(value: string): string {
  const bars = buildBarcodePattern(value);
  const width = Math.max(120, (bars.at(-1)?.x || 0) + 6);
  const rects = bars.map(bar => `<rect x="${bar.x}" y="0" width="${bar.width}" height="42" fill="#000"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 42" preserveAspectRatio="none" role="img" aria-label="Barcode">${rects}</svg>`;
}

function buildPurchaseInvoiceQRCodeString(invoice: PurchaseInvoice, company: CompanySettings): string {
  const issueDate = new Date(invoice.date || invoice.createdAt || Date.now());
  const companyName = company.tradeName || company.name || 'NEXOR ERP';
  const fields = [
    `A:${company.nif || ''}`,
    `B:${companyName}`,
    `C:${invoice.supplierNif || ''}`,
    `D:FC`,
    `E:${invoice.supplierInvoiceNo || invoice.invoiceNumber}`,
    `F:${issueDate.toISOString().slice(0, 10).replace(/-/g, '')}`,
    `G:${invoice.invoiceNumber}`,
    `H:${Number(invoice.subtotal || 0).toFixed(2)}`,
    `I:${Number(invoice.ivaTotal || 0).toFixed(2)}`,
    `J:${Number(invoice.total || 0).toFixed(2)}`,
    `K:${company.agtCertificateNumber || 'N/A'}`,
  ];
  return fields.join('*');
}

const getPurchaseInvoiceStatusBadge = (
  t: any,
  status?: string
) => {
  const labels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    confirmed: { label: t.purchaseInvoicesUi.statusConfirmed, variant: 'default' },
    cancelled: { label: t.purchaseInvoicesUi.statusCancelled, variant: 'destructive' },
    draft: { label: t.purchaseInvoicesUi.statusDraft, variant: 'outline' },
    pending: { label: t.purchaseInvoicesUi.statusPending, variant: 'secondary' },
  };
  if (!status) return { label: t.purchaseInvoicesUi.statusDraft, variant: 'outline' as const };
  return labels[status] || { label: status, variant: 'outline' as const };
};

const getPurchaseOrderStatusBadge = (
  t: any,
  status?: string
) => {
  const labels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    draft: { label: t.purchaseInvoicesUi.poStatusDraft, variant: 'outline' },
    pending: { label: t.purchaseInvoicesUi.poStatusPending, variant: 'secondary' },
    approved: { label: t.purchaseInvoicesUi.poStatusApproved, variant: 'default' },
    awaiting_approval: { label: t.purchaseInvoicesUi.poStatusAwaitingApproval, variant: 'secondary' },
    received: { label: t.purchaseInvoicesUi.poStatusReceived, variant: 'default' },
    partial: { label: t.purchaseInvoicesUi.poStatusPartial, variant: 'secondary' },
    cancelled: { label: t.purchaseInvoicesUi.poStatusCancelled, variant: 'destructive' },
  };
  if (!status) return { label: t.purchaseInvoicesUi.poStatusDraft, variant: 'outline' as const };
  return labels[status] || { label: status, variant: 'outline' as const };
};

// ─────────── Supplier Picker Dialog ───────────
function SupplierPickerDialog({
  open, onClose, suppliers, onSelect, onCreateNew, onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  suppliers: Supplier[];
  onSelect: (s: Supplier) => void;
  onCreateNew?: () => void;
  onRefresh?: () => void;
}) {
  const { t } = useTranslation();
  // Auto-refresh when dialog opens
  useEffect(() => {
    if (open && onRefresh) onRefresh();
  }, [open, onRefresh]);
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.nif?.toLowerCase().includes(q) ||
      s.phone?.toLowerCase().includes(q)
    );
  }, [suppliers, search]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{t.purchaseInvoicesUi.supplierAccountsTitle}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder={t.purchaseInvoicesUi.searchSupplierPlaceholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
        {onCreateNew && (
          <Button variant="outline" size="sm" className="w-full gap-1" onClick={onCreateNew}>
            <Plus className="h-4 w-4" /> {t.purchaseInvoicesUi.createNewSupplier}
          </Button>
        )}
        <ScrollArea className="h-[400px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conta</TableHead>
                <TableHead>Nome de Conta</TableHead>
                <TableHead>NIF</TableHead>
                <TableHead>Tel</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(s => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => { onSelect(s); onClose(); }}
                >
                  <TableCell className="font-mono text-xs">{s.nif || '—'}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-xs">{s.nif || 'Desconhecido'}</TableCell>
                  <TableCell className="text-xs">{s.phone || '—'}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    {t.purchaseInvoicesUi.noSuppliersFound}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

type NewSupplierFormState = {
  name: string;
  nif: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  contactPerson: string;
  notes: string;
};

function emptyNewSupplierForm(): NewSupplierFormState {
  return {
    name: '', nif: '', email: '', phone: '', address: '', city: '',
    country: 'Angola', contactPerson: '', notes: '',
  };
}

function CreateSupplierDialog({
  open,
  onOpenChange,
  form,
  setForm,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: NewSupplierFormState;
  setForm: React.Dispatch<React.SetStateAction<NewSupplierFormState>>;
  onSave: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.purchaseInvoicesUi.newSupplierDialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{t.purchaseInvoicesUi.labelName}</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t.purchaseInvoicesUi.supplierNamePlaceholder} />
          </div>
          <div>
            <Label>{t.purchaseInvoicesUi.labelVatId}</Label>
            <Input value={form.nif} onChange={e => setForm(f => ({ ...f, nif: e.target.value }))} placeholder={t.purchaseInvoicesUi.placeholderTaxId} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{t.purchaseInvoicesUi.labelEmail}</Label>
              <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder={t.purchaseInvoicesUi.labelEmail} />
            </div>
            <div>
              <Label>{t.purchaseInvoicesUi.labelPhone}</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder={t.purchaseInvoicesUi.labelPhone} />
            </div>
          </div>
          <div>
            <Label>{t.purchaseInvoicesUi.labelAddress}</Label>
            <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder={t.purchaseInvoicesUi.labelAddress} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{t.purchaseInvoicesUi.labelCity}</Label>
              <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder={t.purchaseInvoicesUi.labelCity} />
            </div>
            <div>
              <Label>{t.purchaseInvoicesUi.labelCountry}</Label>
              <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          <Button
            disabled={!form.name.trim() || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave();
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save className="h-4 w-4 mr-1" /> {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function syncPurchaseInvoiceDocument(
  invoice: PurchaseInvoice,
  /** Same as `supplierInvoiceNoStripPrefix` in i18n — stored on the document for round-trip import. */
  supplierInvoiceInternalPrefix: string,
) {
  const lines = invoice.lines.map(line => {
    const gross = line.totalQty * line.unitPrice;
    const discountAmount = Math.max(gross - line.total, 0);
    const discount = gross > 0 ? (discountAmount / gross) * 100 : 0;

    return {
      id: line.id,
      productId: line.productId || undefined,
      productSku: line.productCode,
      description: line.description,
      quantity: line.totalQty,
      unit: line.unit,
      unitPrice: line.unitPrice,
      discount: Math.round(discount * 100) / 100,
      discountAmount: Math.round(discountAmount * 100) / 100,
      taxRate: line.ivaRate,
      taxAmount: line.ivaAmount,
      lineTotal: line.totalWithIva,
      accountCode: invoice.purchaseAccountCode,
    };
  });

  const document: ERPDocument = {
    id: invoice.id,
    documentType: 'fatura_compra',
    documentNumber: invoice.invoiceNumber,
    branchId: invoice.branchId,
    branchName: invoice.branchName,
    entityType: 'supplier',
    entityName: invoice.supplierName,
    entityNif: invoice.supplierNif,
    entityPhone: invoice.supplierPhone,
    entityCode: invoice.supplierAccountCode || undefined,
    paymentCondition: invoice.paymentDate ? `Pagamento até ${invoice.paymentDate}` : undefined,
    lines,
    subtotal: invoice.subtotal,
    totalDiscount: lines.reduce((sum, line) => sum + line.discountAmount, 0),
    totalTax: invoice.ivaTotal,
    total: invoice.total,
    currency: invoice.currency === 'KZ' ? 'AOA' : invoice.currency,
    amountPaid: 0,
    amountDue: invoice.total,
    accountCode: invoice.supplierAccountCode,
    status: 'confirmed',
    issueDate: invoice.date,
    issueTime: invoice.createdAt.includes('T') ? invoice.createdAt.split('T')[1].slice(0, 8) : new Date().toTimeString().slice(0, 8),
    dueDate: invoice.paymentDate,
    notes: invoice.extraNote,
    internalNotes: invoice.supplierInvoiceNo
      ? `${supplierInvoiceInternalPrefix}${invoice.supplierInvoiceNo}`
      : undefined,
    createdBy: invoice.createdBy,
    createdByName: invoice.createdByName,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    confirmedBy: invoice.createdBy,
    confirmedAt: invoice.updatedAt,
  };

  await saveDocument(document);
}

// ─────────── Product Picker Dialog ───────────
function ProductPickerDialog({
  open, onClose, products, productsLoading, onSelect, onCreateNew,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  productsLoading?: boolean;
  onSelect: (p: Product) => void;
  onCreateNew: () => void;
}) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return products.slice(0, 100);
    const q = search.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      p.barcode?.toLowerCase().includes(q)
    ).slice(0, 100);
  }, [products, search]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{t.purchaseInvoicesUi.productListTitle}</span>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => { onClose(); onCreateNew(); }}>
              <Plus className="h-4 w-4" /> {t.purchaseInvoicesUi.newProductBtn}
            </Button>
          </DialogTitle>
        </DialogHeader>
        <Input
          placeholder={t.purchaseInvoicesUi.searchProductByNameSkuBarcode}
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
        <ScrollArea className="h-[400px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.purchaseInvoicesUi.gridColCode}</TableHead>
                <TableHead>{t.common.name}</TableHead>
                <TableHead className="text-right">{t.common.price}</TableHead>
                <TableHead className="text-right">{t.purchaseInvoicesUi.gridColStock}</TableHead>
                <TableHead className="text-right">{t.purchaseInvoicesUi.gridColVat}</TableHead>
                <TableHead>{t.purchaseInvoicesUi.gridColUnit}</TableHead>
                <TableHead>{t.purchaseInvoicesUi.productPickerCategory}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(p => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => { onSelect(p); onClose(); }}
                >
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right font-mono">
                    {(p.cost || p.price || 0).toLocaleString(uiLocale)}
                  </TableCell>
                  <TableCell className="text-right">{p.stock}</TableCell>
                  <TableCell className="text-right">{p.taxRate}%</TableCell>
                  <TableCell>{p.unit || 'UN'}</TableCell>
                  <TableCell className="text-xs">{p.category}</TableCell>
                </TableRow>
              ))}
              {productsLoading && products.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {t.common.loading}
                  </TableCell>
                </TableRow>
              )}
              {!productsLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {t.purchaseInvoicesUi.poNoProductsFound}
                    <br />
                    <Button variant="link" size="sm" className="mt-2 gap-1" onClick={() => { onClose(); onCreateNew(); }}>
                      <Plus className="h-4 w-4" /> {t.purchaseInvoicesUi.productPickerCreateNew}
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ─────────── Account Picker Dialog ───────────
function AccountPickerDialog({
  open, onClose, onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (code: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const accounts = useMemo(() => {
    try {
      const data = localStorage.getItem('kwanzaerp_chart_of_accounts');
      const all: Array<{ code: string; name: string; is_active: boolean }> = data ? JSON.parse(data) : [];
      return all.filter(a => a.is_active !== false).sort((a, b) => a.code.localeCompare(b.code));
    } catch { return []; }
  }, []);

  const filtered = useMemo(() => {
    if (!search) return accounts;
    const q = search.toLowerCase();
    return accounts.filter(a =>
      a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[70vh]">
        <DialogHeader>
          <DialogTitle>{t.purchaseInvoicesUi.accountSearchTitle}</DialogTitle>
        </DialogHeader>
        <Input placeholder={t.purchaseInvoicesUi.searchByCodeOrName} value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        <ScrollArea className="h-[350px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. de Conta</TableHead>
                <TableHead>Nome de Conta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(a => (
                <TableRow key={a.code} className="cursor-pointer hover:bg-accent" onClick={() => { onSelect(a.code, a.name); onClose(); }}>
                  <TableCell className="font-mono">{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function buildPurchaseInvoiceJournalLines({
  documentId,
  invoiceNumber,
  currency,
  purchaseAccountCode,
  ivaAccountCode,
  supplierAccountCode,
  supplierName,
  subtotal,
  ivaTotal,
  supplierTotal,
  withholdingAmount,
  withholdingAccountCode,
  stampAmount,
  stampAccountCode,
  landingCosts,
  freightSourceAccount,
  freightSourceName,
  manualLines,
  labelFreightLine,
  labelDeductibleVat,
}: {
  documentId: string;
  invoiceNumber: string;
  currency: string;
  purchaseAccountCode: string;
  ivaAccountCode: string;
  supplierAccountCode: string;
  supplierName: string;
  subtotal: number;
  ivaTotal: number;
  supplierTotal: number;
  withholdingAmount?: number;
  withholdingAccountCode?: string;
  stampAmount?: number;
  stampAccountCode?: string;
  landingCosts: number;
  freightSourceAccount: string;
  freightSourceName: string;
  manualLines: PurchaseInvoiceJournalLine[];
  /** Display names — must not rely on `t` from React scope (this helper is module-level). */
  labelFreightLine: string;
  labelDeductibleVat: string;
}): PurchaseInvoiceJournalLine[] {
  const postedLines: PurchaseInvoiceJournalLine[] = [];
  let autoIndex = 0;
  const nextId = (suffix: string) => `${documentId}_${suffix}_${++autoIndex}`;

  const wht = roundMoney(withholdingAmount || 0);
  const whtAcc = (withholdingAccountCode || '3.4.1').trim() || '3.4.1';
  const isTax = roundMoney(stampAmount || 0);
  const isAcc = (stampAccountCode || '3.5.1').trim() || '3.5.1';

  if (subtotal > 0) {
    postedLines.push({
      id: nextId('purchase'),
      accountCode: purchaseAccountCode || '2.1.1',
      accountName: 'Compra de Mercadorias',
      currency,
      note: `Mercadoria - FC ${invoiceNumber}`,
      debit: subtotal,
      credit: 0,
    });
  }

  // Imposto de Selo (IS): treat as acquisition cost + tax payable (Angola)
  if (isTax > 0) {
    postedLines.push({
      id: nextId('stamp_debit'),
      accountCode: purchaseAccountCode || '2.1.1',
      accountName: 'Compra de Mercadorias',
      currency,
      note: `Imposto de Selo - FC ${invoiceNumber}`,
      debit: isTax,
      credit: 0,
    });
  }

  if (landingCosts > 0) {
    postedLines.push({
      id: nextId('freight_debit'),
      accountCode: '6.2.6',
      accountName: labelFreightLine,
      currency,
      note: `Frete / Transporte - FC ${invoiceNumber}`,
      debit: landingCosts,
      credit: 0,
    });
  }

  if (ivaTotal > 0) {
    postedLines.push({
      id: nextId('iva'),
      accountCode: ivaAccountCode || '3.3.1',
      accountName: labelDeductibleVat,
      currency,
      note: `IVA - FC ${invoiceNumber}`,
      debit: ivaTotal,
      credit: 0,
    });
  }

  // Retenção na Fonte: reduce supplier payable; create tax payable
  if (wht > 0) {
    postedLines.push({
      id: nextId('withholding'),
      accountCode: whtAcc,
      accountName: 'Retenção na Fonte a Pagar',
      currency,
      note: `Retenção na Fonte - FC ${invoiceNumber}`,
      debit: 0,
      credit: wht,
    });
  }

  postedLines.push({
    id: nextId('supplier'),
    accountCode: supplierAccountCode,
    accountName: supplierName,
    currency,
    note: `FC ${invoiceNumber}`,
    debit: 0,
    credit: Math.max(roundMoney(supplierTotal) - wht, 0),
  });

  // Imposto de Selo payable
  if (isTax > 0) {
    postedLines.push({
      id: nextId('stamp_credit'),
      accountCode: isAcc,
      accountName: 'Imposto de Selo a Pagar',
      currency,
      note: `Imposto de Selo - FC ${invoiceNumber}`,
      debit: 0,
      credit: isTax,
    });
  }

  if (landingCosts > 0) {
    postedLines.push({
      id: nextId('freight_credit'),
      accountCode: freightSourceAccount,
      accountName: freightSourceName,
      currency,
      note: `Saída de caixa/banco - Frete FC ${invoiceNumber}`,
      debit: 0,
      credit: landingCosts,
    });
  }

  return [
    ...postedLines,
    ...manualLines.map((line, index) => ({
      ...line,
      id: line.id || nextId(`manual_${index + 1}`),
    })),
  ];
}

// ─────────── Invoice View Dialog ───────────
function InvoiceViewDialog({
  open, onClose, invoice, onCreateReturn,
}: {
  open: boolean;
  onClose: () => void;
  invoice: PurchaseInvoice | null;
  onCreateReturn?: (invoice: PurchaseInvoice) => void;
}) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const [previewQrCodeUrl, setPreviewQrCodeUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!invoice) {
      setPreviewQrCodeUrl(null);
      return;
    }

    let active = true;
    const companySettings = getCompanySettings();
    QRCode.toDataURL(buildPurchaseInvoiceQRCodeString(invoice, companySettings), {
      width: 120,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setPreviewQrCodeUrl(url);
      })
      .catch(() => {
        if (active) setPreviewQrCodeUrl(null);
      });

    return () => {
      active = false;
    };
  }, [invoice]);

  if (!invoice) return null;

  const company = getCompanySettings();
  const companyName = company.tradeName || company.name || 'NEXOR ERP';
  const companyLocation = [company.city, company.province, company.country].filter(Boolean).join(' - ');
  const previewMoney = (value: number) => Number(value || 0).toLocaleString(uiLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const previewQty = (value: number) => Number(value || 0).toLocaleString(uiLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const previewIssueDate = new Date(invoice.date || invoice.createdAt || Date.now());
  const previewDueDate = new Date(invoice.paymentDate || invoice.date || Date.now());
  const previewBarcodeValue = invoice.supplierInvoiceNo || invoice.invoiceNumber;
  const previewBarcodeBars = buildBarcodePattern(previewBarcodeValue);
  const previewBarcodeWidth = Math.max(120, (previewBarcodeBars.at(-1)?.x || 0) + 6);
  const previewTaxRate = invoice.ivaTotal > 0 && invoice.subtotal > 0 ? (invoice.ivaTotal / invoice.subtotal) * 100 : 0;
  const previewGross = invoice.subtotal + invoice.ivaTotal;
  const previewDiscount = invoice.lines.reduce((s, l) => s + ((l.totalQty * l.unitPrice) - l.total), 0);

  const handlePrint = async () => {
    const escapeHtml = (value: unknown) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    const money = (value: number) => Number(value || 0).toLocaleString(uiLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const qty = (value: number) => Number(value || 0).toLocaleString(uiLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const barcodeValue = invoice.supplierInvoiceNo || invoice.invoiceNumber;
    const barcodeBars = buildBarcodeSvgMarkup(barcodeValue);
    let qrCodeSvg = '<div class="qr-placeholder">QR</div>';
    try {
      qrCodeSvg = await QRCode.toString(buildPurchaseInvoiceQRCodeString(invoice, company), {
        type: 'svg',
        width: 94,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
    } catch {
      qrCodeSvg = '<div class="qr-placeholder">QR</div>';
    }
    const issueDate = new Date(invoice.date || invoice.createdAt || Date.now());
    const dueDate = new Date(invoice.paymentDate || invoice.date || Date.now());
    const subtotalWithTax = invoice.subtotal + invoice.ivaTotal;
    const lines = invoice.lines.map(l => `
      <tr>
        <td class="mono">${escapeHtml(l.productCode || l.barcode || '')}</td>
        <td>${escapeHtml(l.description)}</td>
        <td class="num">${qty(l.totalQty)}</td>
        <td class="center">${escapeHtml(l.unit || 'UND')}</td>
        <td class="num">${money(l.unitPrice)}</td>
        <td class="num">${money(l.discountPct || 0)}</td>
        <td class="num">${money(l.ivaRate)}</td>
        <td class="num">${money(l.totalWithIva)}</td>
        <td class="num">${money(l.ivaAmount)}</td>
      </tr>
    `).join('');
    const html = `<html><head><title>FC ${invoice.invoiceNumber}</title>
      <style>
        @page{size:A4;margin:10mm}
        *{box-sizing:border-box}
        body{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#111;margin:0;background:#fff}
        .page{width:190mm;min-height:277mm;margin:0 auto;padding:4mm 2mm;position:relative}
        .header{display:grid;grid-template-columns:30mm 1fr 58mm;gap:8mm;align-items:start}
        .logo{width:27mm;height:22mm;border:1px solid #bbb;display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:900;font-size:20px;color:#8b1d1d;letter-spacing:-1px;text-align:center}
        .logo img{max-width:100%;max-height:100%;object-fit:contain}
        .supplier h1{font-size:14px;margin:0 0 2px 0;line-height:1.05;text-transform:uppercase}
        .supplier div,.meta div,.customer div{line-height:1.28}
        .meta{text-align:center;font-size:9.5px}
        .meta .copy{font-weight:700;margin-bottom:5px}
        .meta .docno{font-weight:700}
        .barcode{height:16mm;margin:7px auto 2px;max-width:52mm;background:#fff}
        .barcode svg{width:100%;height:100%;display:block}
        .barcode-label{font-family:"Courier New",monospace;font-size:8px;letter-spacing:1px}
        .qr-code{width:23mm;height:23mm;margin:3mm auto 0;border:1px solid #111;padding:1mm;background:#fff}
        .qr-code svg{width:100%;height:100%;display:block}
        .qr-placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:700;border:1px dashed #777}
        .qr-label{font-size:7.5px;font-weight:700;margin-top:1px}
        .rule{border-top:1px solid #333;margin:5px 0}
        .small-label{font-size:9px;font-weight:700;text-transform:uppercase}
        .customer-box{display:grid;grid-template-columns:1fr 45mm;gap:8mm;align-items:end;margin-top:3mm}
        .customer{text-align:left}
        .date-grid{display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center;font-size:9.5px}
        .date-grid strong{display:block;border-bottom:1px solid #777;margin-bottom:2px}
        .ref-row{display:grid;grid-template-columns:40mm 1fr;border-top:1px solid #333;border-bottom:1px solid #333;margin-top:5mm;padding:2px 0;font-size:9px;font-weight:700}
        table{width:100%;border-collapse:collapse}
        .items{margin-top:1mm}
        .items th{font-size:9px;text-align:left;border-bottom:1px solid #333;padding:3px 4px}
        .items td{font-size:9.5px;padding:4px 4px;vertical-align:top}
        .items tbody tr{height:8mm}
        .mono{font-family:"Courier New",monospace}
        .num{text-align:right;font-family:"Courier New",monospace;white-space:nowrap}
        .center{text-align:center}
        .bottom{position:absolute;left:2mm;right:2mm;bottom:11mm}
        .tax-and-total{display:grid;grid-template-columns:1fr 66mm;gap:18mm;align-items:start}
        .tax-title{font-size:9px;font-weight:700;border-bottom:1px solid #333;margin-bottom:2px}
        .tax th,.tax td{border:1px solid #333;padding:3px 4px;font-size:9px}
        .tax th{font-weight:700;text-align:left}
        .totals td{border:1px solid #333;padding:4px 6px;font-size:10px}
        .totals .label{font-weight:700;text-transform:uppercase}
        .totals .value{text-align:right;font-family:"Courier New",monospace;font-weight:700}
        .grand td{font-size:14px;font-weight:900}
        .note-line{margin-top:12mm;border-bottom:1px solid #333;width:92mm;font-size:9px;font-weight:700}
        .operator{margin-top:8mm;border:1px solid #333;padding:4px 6px;width:64mm;margin-left:auto;font-size:10px}
        .bank{margin-top:7mm;font-weight:700}
        .footer-msg{text-align:center;margin-top:11mm;font-weight:700;font-size:10px}
        .page-no{text-align:right;margin-top:5mm;font-size:9px;font-weight:700}
        @media print{body{margin:0}.page{margin:0;min-height:277mm}}
      </style>
    </head><body>
      <div class="page">
        <div class="header">
          <div class="logo">${company.logo ? `<img src="${escapeHtml(company.logo)}" alt="${escapeHtml(companyName)}">` : escapeHtml(companyName.slice(0, 2).toUpperCase())}</div>
          <div class="supplier">
            <h1>${escapeHtml(companyName)}</h1>
            <div><strong>Tel:</strong> ${escapeHtml(company.phone || 'Desconhecido')}</div>
            <div><strong>Email:</strong> ${escapeHtml(company.email || '')}</div>
            <div><strong>NIF:</strong> ${escapeHtml(company.nif || 'Desconhecido')}</div>
            <div>${escapeHtml(company.address || '')}</div>
            <div>${escapeHtml(companyLocation)}</div>
          </div>
          <div class="meta">
            <div class="copy">Original</div>
            <div class="docno">Factura Compra Nº : ${escapeHtml(invoice.supplierInvoiceNo || invoice.invoiceNumber)}</div>
            <div class="barcode">${barcodeBars}</div>
            <div class="barcode-label">${escapeHtml(barcodeValue)}</div>
            <div class="qr-code">${qrCodeSvg}</div>
            <div class="qr-label">QR CODE AGT</div>
          </div>
        </div>

        <div class="customer-box">
          <div>
            <div class="small-label">NOTA:</div>
            <div class="rule"></div>
            <div class="small-label">ARMAZEM: ${escapeHtml(invoice.warehouseName || invoice.branchName || '')}</div>
            <div class="small-label" style="margin-top:3mm">CLIENTE V/REF</div>
            <div class="mono">${escapeHtml(invoice.ref || invoice.orderNo || '')}</div>
          </div>
          <div class="customer">
            <div style="font-weight:700;text-align:center">Fornecedor</div>
            <div><strong>${escapeHtml(invoice.supplierName || 'Fornecedor')}</strong></div>
            <div><strong>NIF:</strong> ${escapeHtml(invoice.supplierNif || 'Desconhecido')}</div>
            <div><strong>ENDEREÇO:</strong> ${escapeHtml(invoice.address || 'Desconhecido')}</div>
            <div><strong>TELE:</strong> ${escapeHtml(invoice.supplierPhone || 'Desconhecido')}</div>
            <div><strong>AO</strong></div>
          </div>
        </div>

        <div class="date-grid" style="margin-left:105mm;margin-top:2mm;width:82mm">
          <div><strong>Hora</strong>${escapeHtml(invoice.issueTime || new Date(invoice.createdAt).toLocaleTimeString('pt-AO'))}</div>
          <div><strong>DATA EMISSÃO</strong>${issueDate.toISOString().slice(0, 10)}</div>
          <div><strong>DATA VENCIMENTO</strong>${dueDate.toISOString().slice(0, 10)}</div>
        </div>

        <div class="ref-row">
          <div>REFERENCIA</div>
          <div>DESCRICAO</div>
        </div>

        <table class="items">
          <thead>
            <tr>
              <th style="width:25mm">REFERENCIA</th>
              <th>DESCRICAO</th>
              <th class="num" style="width:18mm">QTD.</th>
              <th class="center" style="width:13mm">UNI</th>
              <th class="num" style="width:20mm">P.Unit(S/IMP.)</th>
              <th class="num" style="width:15mm">DESC.%</th>
              <th class="num" style="width:14mm">TAXA%</th>
              <th class="num" style="width:23mm">TOTAL</th>
              <th class="num" style="width:23mm">IVA VALOR</th>
            </tr>
          </thead>
          <tbody>${lines}</tbody>
        </table>

        <div class="bottom">
          <div style="font-size:8px;margin-bottom:2mm">D/IM. Processado por programa validado 396/AGT/2023 - ${escapeHtml(companyName)}</div>
          <div class="tax-and-total">
            <div>
              <div class="tax-title">RESUMO DE IMPOSTOS</div>
              <table class="tax">
                <thead>
                  <tr><th>DESIGNAÇÃO</th><th>TAXA%</th><th>INCIDENCIA</th><th>IMPOSTO</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>NORMAL IVA</td>
                    <td class="center">${money(invoice.ivaTotal > 0 && invoice.subtotal > 0 ? (invoice.ivaTotal / invoice.subtotal) * 100 : 0).replace(',00', '')}</td>
                    <td class="num">${money(invoice.subtotal)}</td>
                    <td class="num">${money(invoice.ivaTotal)}</td>
                  </tr>
                </tbody>
              </table>
              <div class="note-line">Motivo de Isencao</div>
              <div class="bank">${escapeHtml(company.bankName || 'Banco')}&nbsp;&nbsp;-&nbsp;&nbsp;${escapeHtml(company.iban || '')}</div>
            </div>
            <div>
              <table class="totals">
                <tbody>
                  <tr><td class="label">VALOR</td><td class="value">${money(subtotalWithTax)}</td></tr>
                  <tr><td class="label">DESCONTO</td><td class="value">${money(invoice.lines.reduce((s, l) => s + ((l.totalQty * l.unitPrice) - l.total), 0))}</td></tr>
                  <tr><td class="label">SUB TOTAL</td><td class="value">${money(subtotalWithTax)}</td></tr>
                  <tr><td class="label">IMPOSTO</td><td class="value">${money(invoice.ivaTotal)}</td></tr>
                  <tr class="grand"><td class="label">TOTAL</td><td class="value">${escapeHtml(invoice.currency)} ${money(invoice.total)}</td></tr>
                </tbody>
              </table>
              <div class="operator">Operador: ${escapeHtml(invoice.createdByName || 'Sistema')}</div>
            </div>
          </div>
          <div class="footer-msg">Os Bens/Serviços foram colocados a disposicao do adquirente na data de factura</div>
          <div class="page-no">Pagina Nº 1 de 1</div>
        </div>
      </div>
    </body></html>`;

    const { printHtml } = await import('@/lib/printHtml');
    await printHtml(html);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[92vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-orange-600 font-bold">{t.purchaseInvoicesUi.editorTitle}</span>
            <span>{invoice.invoiceNumber}</span>
            <Badge variant={getPurchaseInvoiceStatusBadge(t, invoice.status).variant}>
              {getPurchaseInvoiceStatusBadge(t, invoice.status).label}
            </Badge>
            {invoice.status === 'confirmed' && invoice.purchaseReturnsStatus !== 'full' && onCreateReturn && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => {
                  onCreateReturn(invoice);
                  onClose();
                }}
              >
                <RotateCcw className="h-4 w-4" /> {t.purchaseInvoicesUi.returnFromInvoice}
              </Button>
            )}
            <Button variant="outline" size="sm" className="ml-auto gap-1" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> {t.purchaseInvoicesUi.poPrint}
            </Button>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[78vh] bg-muted/40 rounded-md">
          <div className="mx-auto my-4 bg-white text-black shadow-xl border p-6 text-[10px]" style={{ width: '210mm', minHeight: '297mm' }}>
            <div className="grid grid-cols-[32mm_1fr_62mm] gap-6 items-start">
              <div className="w-[28mm] h-[23mm] border border-zinc-400 flex items-center justify-center overflow-hidden text-2xl font-black text-red-900 tracking-tighter text-center">
                {company.logo ? (
                  <img src={company.logo} alt={companyName} className="max-h-full max-w-full object-contain" />
                ) : (
                  companyName.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="leading-tight">
                <h2 className="text-[15px] font-black uppercase leading-none mb-1">{companyName}</h2>
                <div><strong>Tel:</strong> {company.phone || 'Desconhecido'}</div>
                <div><strong>Email:</strong> {company.email || ''}</div>
                <div><strong>NIF:</strong> {company.nif || 'Desconhecido'}</div>
                <div>{company.address || ''}</div>
                <div>{companyLocation}</div>
              </div>
              <div className="text-center text-[9px] leading-tight">
                <div className="font-bold mb-2">Original</div>
                <div className="font-bold">Factura Compra Nº : {invoice.supplierInvoiceNo || invoice.invoiceNumber}</div>
                <svg
                  viewBox={`0 0 ${previewBarcodeWidth} 42`}
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Barcode"
                  className="w-full h-12 mt-2 mb-1 bg-white"
                >
                  {previewBarcodeBars.map((bar, index) => (
                    <rect key={index} x={bar.x} y="0" width={bar.width} height="42" fill="#000" />
                  ))}
                </svg>
                <div className="font-mono tracking-widest text-[8px]">{previewBarcodeValue}</div>
                <div className="mx-auto mt-3 h-[23mm] w-[23mm] border border-black bg-white p-1">
                  {previewQrCodeUrl ? (
                    <img src={previewQrCodeUrl} alt="QR Code AGT" className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center border border-dashed border-zinc-500 font-bold">
                      QR
                    </div>
                  )}
                </div>
                <div className="mt-1 text-[7.5px] font-bold">QR CODE AGT</div>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_55mm] gap-8 mt-5 items-end">
              <div>
                <div className="font-bold text-[9px]">NOTA:</div>
                <div className="border-t border-black mt-3" />
                <div className="font-bold mt-4">ARMAZEM: {invoice.warehouseName || invoice.branchName || ''}</div>
                <div className="font-bold mt-4">CLIENTE V/REF</div>
                <div className="font-mono">{invoice.ref || invoice.orderNo || ''}</div>
              </div>
              <div className="leading-tight">
                <div className="font-bold text-center">Fornecedor</div>
                <div><strong>{invoice.supplierName || 'Fornecedor'}</strong></div>
                <div><strong>NIF:</strong> {invoice.supplierNif || 'Desconhecido'}</div>
                <div><strong>ENDEREÇO:</strong> {invoice.address || 'Desconhecido'}</div>
                <div><strong>TELE:</strong> {invoice.supplierPhone || 'Desconhecido'}</div>
                <div><strong>AO</strong></div>
              </div>
            </div>

            <div className="grid grid-cols-3 text-center text-[9px] ml-auto mt-3 w-[86mm]">
              <div><div className="font-bold border-b border-zinc-600">Hora</div>{invoice.issueTime || format(new Date(invoice.createdAt), 'HH:mm:ss')}</div>
              <div><div className="font-bold border-b border-zinc-600">DATA EMISSÃO</div>{previewIssueDate.toISOString().slice(0, 10)}</div>
              <div><div className="font-bold border-b border-zinc-600">DATA VENCIMENTO</div>{previewDueDate.toISOString().slice(0, 10)}</div>
            </div>

            <div className="grid grid-cols-[38mm_1fr] border-y border-black mt-5 py-1 font-bold text-[9px]">
              <div>REFERENCIA</div>
              <div>DESCRICAO</div>
            </div>

            <table className="w-full border-collapse mt-1">
              <thead>
                <tr className="border-b border-black text-[9px]">
                  <th className="text-left py-1 w-[25mm]">REFERENCIA</th>
                  <th className="text-left py-1">DESCRICAO</th>
                  <th className="text-right py-1 w-[18mm]">QTD.</th>
                  <th className="text-center py-1 w-[13mm]">UNI</th>
                  <th className="text-right py-1 w-[22mm]">P.Unit(S/IMP.)</th>
                  <th className="text-right py-1 w-[15mm]">DESC.%</th>
                  <th className="text-right py-1 w-[14mm]">TAXA%</th>
                  <th className="text-right py-1 w-[24mm]">TOTAL</th>
                  <th className="text-right py-1 w-[24mm]">IVA VALOR</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map(l => (
                  <tr key={l.id} className="h-8 align-top text-[9.5px]">
                    <td className="font-mono py-1">{l.productCode || l.barcode || ''}</td>
                    <td className="py-1 font-semibold">{l.description}</td>
                    <td className="text-right py-1 font-mono">{previewQty(l.totalQty)}</td>
                    <td className="text-center py-1">{l.unit || 'UND'}</td>
                    <td className="text-right py-1 font-mono">{previewMoney(l.unitPrice)}</td>
                    <td className="text-right py-1 font-mono">{previewMoney(l.discountPct || 0)}</td>
                    <td className="text-right py-1 font-mono">{previewMoney(l.ivaRate)}</td>
                    <td className="text-right py-1 font-mono">{previewMoney(l.totalWithIva)}</td>
                    <td className="text-right py-1 font-mono">{previewMoney(l.ivaAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-[96mm]">
              <div className="text-[8px] mb-1">D/IM. Processado por programa validado 396/AGT/2023 - {companyName}</div>
              <div className="grid grid-cols-[1fr_66mm] gap-16">
                <div>
                  <div className="font-bold border-b border-black mb-1">RESUMO DE IMPOSTOS</div>
                  <table className="w-full border-collapse text-[9px]">
                    <thead>
                      <tr>
                        <th className="border border-black p-1 text-left">DESIGNAÇÃO</th>
                        <th className="border border-black p-1 text-left">TAXA%</th>
                        <th className="border border-black p-1 text-left">INCIDENCIA</th>
                        <th className="border border-black p-1 text-left">IMPOSTO</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border border-black p-1">NORMAL IVA</td>
                        <td className="border border-black p-1 text-center">{previewMoney(previewTaxRate).replace(',00', '')}</td>
                        <td className="border border-black p-1 text-right font-mono">{previewMoney(invoice.subtotal)}</td>
                        <td className="border border-black p-1 text-right font-mono">{previewMoney(invoice.ivaTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="border-b border-black w-[92mm] mt-12 font-bold">Motivo de Isencao</div>
                  <div className="font-bold mt-8">{company.bankName || 'Banco'}&nbsp;&nbsp;-&nbsp;&nbsp;{company.iban || ''}</div>
                </div>
                <div>
                  <table className="w-full border-collapse text-[10px]">
                    <tbody>
                      <tr><td className="border border-black p-1 font-bold">VALOR</td><td className="border border-black p-1 text-right font-mono font-bold">{previewMoney(previewGross)}</td></tr>
                      <tr><td className="border border-black p-1 font-bold">DESCONTO</td><td className="border border-black p-1 text-right font-mono font-bold">{previewMoney(previewDiscount)}</td></tr>
                      <tr><td className="border border-black p-1 font-bold">SUB TOTAL</td><td className="border border-black p-1 text-right font-mono font-bold">{previewMoney(previewGross)}</td></tr>
                      <tr><td className="border border-black p-1 font-bold">IMPOSTO</td><td className="border border-black p-1 text-right font-mono font-bold">{previewMoney(invoice.ivaTotal)}</td></tr>
                      <tr><td className="border border-black p-2 font-black text-lg">TOTAL</td><td className="border border-black p-2 text-right font-mono font-black text-lg">{invoice.currency} {previewMoney(invoice.total)}</td></tr>
                    </tbody>
                  </table>
                  <div className="border border-black mt-8 p-1">Operador: {invoice.createdByName || 'Sistema'}</div>
                </div>
              </div>
              <div className="text-center font-bold mt-12">Os Bens/Serviços foram colocados a disposicao do adquirente na data de factura</div>
              <div className="text-right font-bold mt-5">Pagina Nº 1 de 1</div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function readModeParamFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi < 0) return null;
  try {
    return new URLSearchParams(hash.slice(qi + 1)).get('mode');
  } catch {
    return null;
  }
}

function readNexorPiNewFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi < 0) return null;
  try {
    return new URLSearchParams(hash.slice(qi + 1)).get(NEXOR_PURCHASE_NEW_QUERY_KEY);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════
export default function PurchaseInvoices() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { user } = useAuth();
  const { currentBranch, branches } = useBranchContext();
  const { apiBranchId } = useBranchScope();
  const { suppliers, refreshSuppliers, createSupplier } = useSuppliers();
  const { toast } = useToast();
  const navigate = useNavigate();
  /** Prevents repeated startCreate+navigate while session intent stays hot (fixes render thrash / frozen UI). */
  const urlCreateAppliedRef = useRef(false);
  /** Reuse the same FC id/number when the user retries after a save error (prevents duplicates). */
  const createInvoiceSessionRef = useRef<{ id: string; invoiceNumber: string } | null>(null);
  /** Blocks a second click before React re-renders with savingPurchase=true. */
  const savingPurchaseRef = useRef(false);
  /** When set, save updates the existing invoice without re-posting stock/accounting. */
  const editingInvoiceRef = useRef<PurchaseInvoice | null>(null);

   // State
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accountPickerTarget, setAccountPickerTarget] = useState<'journal' | null>(null);
  const [editingJournalIdx, setEditingJournalIdx] = useState<number | null>(null);
  const [viewInvoice, setViewInvoice] = useState<PurchaseInvoice | null>(null);
  const [activeTab, setActiveTab] = useState('fatura');
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const [newSupplierForm, setNewSupplierForm] = useState({ name: '', nif: '', email: '', phone: '', address: '', city: '', country: 'Angola', contactPerson: '', notes: '' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [nextFcPreview, setNextFcPreview] = useState<string | null>(null);
  const [openReturnCreateSignal, setOpenReturnCreateSignal] = useState(0);
  const [returnPreselectInvoiceId, setReturnPreselectInvoiceId] = useState<string | null>(null);
  // List mode state
  const [listTab, setListTab] = useState<'faturas' | 'encomendas' | 'devolucoes'>('faturas');
  const [returnCount, setReturnCount] = useState(0);
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [selectedListInvoiceId, setSelectedListInvoiceId] = useState<string | null>(null);
  const [gridFocusCell, setGridFocusCell] = useState<{ row: number; field: 'quantity' } | null>(null);
  // Form state
  const [form, setForm] = useState<Partial<PurchaseInvoice>>({});
  const [lines, setLines] = useState<PurchaseInvoiceLine[]>([]);
  const [journalLines, setJournalLines] = useState<PurchaseInvoiceJournalLine[]>([]);
  /** Warehouse on the FC drives stock, costs (último custo), and FC numbering — not the global top-nav branch alone. */
  const purchaseWarehouseId = useMemo(
    () =>
      String(form.warehouseId ?? '').trim() ||
      String(currentBranch?.id ?? '').trim() ||
      String(apiBranchId ?? '').trim(),
    [form.warehouseId, currentBranch?.id, apiBranchId],
  );
  // Freight / Transport cost
  const [freightCost, setFreightCost] = useState(0);
  const [freightOtherCosts, setFreightOtherCosts] = useState(0);
  const [freightSourceAccount, setFreightSourceAccount] = useState('4.1.1'); // default Cash
  const [freightSourceName, setFreightSourceName] = useState('Cash');

  const numberingBranchId = useMemo(() => {
    const wh = String(form.warehouseId ?? '').trim();
    return wh || String(currentBranch?.id ?? '').trim() || String(apiBranchId ?? '').trim();
  }, [form.warehouseId, currentBranch?.id, apiBranchId]);

  useEffect(() => {
    if (mode !== 'create' || !numberingBranchId) {
      setNextFcPreview(null);
      return;
    }
    let cancelled = false;
    peekPurchaseInvoiceNumber(numberingBranchId).then((n) => {
      if (!cancelled) setNextFcPreview(n);
    });
    return () => { cancelled = true; };
  }, [mode, invoices.length, numberingBranchId]);
  const [freightPickerOpen, setFreightPickerOpen] = useState(false);
  /** Purchase invoice create: optional PO to pre-fill lines for the selected supplier. */
  const [fillFromPoId, setFillFromPoId] = useState('');
  const [discardCloseOpen, setDiscardCloseOpen] = useState(false);
  // PO inline state
  const [poCreateOpen, setPoCreateOpen] = useState(false);
  const [poViewOrder, setPoViewOrder] = useState<any | null>(null);
  const [poReceiveOrder, setPoReceiveOrder] = useState<any | null>(null);
  const [poReceivedQtys, setPoReceivedQtys] = useState<Record<string, number>>({});
  const [poForm, setPoForm] = useState({ supplierId: '', branchId: currentBranch?.id || '', notes: '', expectedDeliveryDate: '', items: [] as { productId: string; quantity: number; unitCost: number }[] });
  const [poNewItem, setPoNewItem] = useState({ productId: '', quantity: 1, unitCost: 0 });
  const [poProductPickerOpen, setPoProductPickerOpen] = useState(false);
  const [poProductSearch, setPoProductSearch] = useState('');
  const [poProductDropdownOpen, setPoProductDropdownOpen] = useState(false);

  const productsBranchId = useMemo(() => {
    if (poCreateOpen) {
      const poBranch = String(poForm.branchId || '').trim();
      if (poBranch) return poBranch;
    }
    const wh = String(purchaseWarehouseId || '').trim();
    if (wh) return wh;
    const scope = String(apiBranchId || '').trim();
    if (scope) return scope;
    return String(currentBranch?.id || '').trim() || undefined;
  }, [poCreateOpen, poForm.branchId, purchaseWarehouseId, apiBranchId, currentBranch?.id]);

  const { products, productsLoading, addProduct: addProductToStock, refreshProducts } = useProducts(
    productsBranchId,
    { light: true },
  );

  // Purchase orders
  const { orders, createOrder, approveOrder, receiveOrder, cancelOrder, refreshOrders } = usePurchaseOrders(apiBranchId);

  useEffect(() => {
    if (!poCreateOpen) {
      setPoProductDropdownOpen(false);
      setPoProductSearch('');
    }
  }, [poCreateOpen]);

  const poProductSearchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!poProductDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (poProductSearchRef.current && !poProductSearchRef.current.contains(e.target as Node)) {
        setPoProductDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [poProductDropdownOpen]);

  const totalLandingCosts = freightCost + freightOtherCosts;

  // Freight allocation per product (proportional to value)
  const freightAllocations = useMemo(() => {
    const itemsTotal = lines.reduce((s, l) => s + l.total, 0);
    if (itemsTotal === 0 || totalLandingCosts === 0) return {} as Record<string, number>;
    const alloc: Record<string, number> = {};
    lines.forEach(l => {
      if (!l.productId || l.totalQty <= 0) return;
      const proportion = l.total / itemsTotal;
      alloc[l.productId] = (totalLandingCosts * proportion) / l.totalQty;
    });
    return alloc;
  }, [lines, totalLandingCosts]);

  const activeSuppliers = useMemo(() => suppliers.filter(s => s.isActive), [suppliers]);

  const supplierPurchaseOrders = useMemo(() => {
    const sid = ((form as { supplierId?: string }).supplierId || '').trim();
    if (!sid) return [];
    const wid = ((form.warehouseId || currentBranch?.id || '') as string).trim();
    let list = orders.filter(
      (o) =>
        o.supplierId === sid &&
        o.status !== 'cancelled' &&
        Array.isArray(o.items) &&
        o.items.length > 0,
    );
    if (wid) {
      const sameBranch = list.filter((o) => o.branchId === wid);
      if (sameBranch.length > 0) list = sameBranch;
    }
    return [...list].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [orders, (form as { supplierId?: string }).supplierId, form.warehouseId, currentBranch?.id]);

  useEffect(() => {
    if (!fillFromPoId) return;
    if (!supplierPurchaseOrders.some((o) => o.id === fillFromPoId)) setFillFromPoId('');
  }, [fillFromPoId, supplierPurchaseOrders]);

  const loadInvoiceList = useCallback(async () => {
    const piInvoices = await getPurchaseInvoices(apiBranchId, branches);
    setInvoices(piInvoices);
  }, [apiBranchId, branches]);

  const refreshReturnMetrics = useCallback(async () => {
    try {
      await syncAllPurchaseInvoiceReturnStatuses(apiBranchId);
      const returns = await getSupplierReturns(apiBranchId);
      setReturnCount(returns.length);
      await loadInvoiceList();
      await refreshProducts();
      refreshSuppliers();
    } catch {
      setReturnCount(0);
    }
  }, [apiBranchId, loadInvoiceList, refreshProducts, refreshSuppliers]);

  const openReturnFromInvoice = useCallback((invoiceId?: string) => {
    setReturnPreselectInvoiceId(invoiceId ?? null);
    setListTab('devolucoes');
    setOpenReturnCreateSignal((s) => s + 1);
  }, []);

  useEffect(() => {
    const init = async () => {
      await syncAllPurchaseInvoiceReturnStatuses(apiBranchId);
      await loadInvoiceList();
      try {
        const returns = await getSupplierReturns(apiBranchId);
        setReturnCount(returns.length);
      } catch {
        setReturnCount(0);
      }
    };
    init();
  }, [apiBranchId, loadInvoiceList]);

  useEffect(() => subscribeSupplierReturnsChanged(refreshReturnMetrics), [refreshReturnMetrics]);

  useEffect(() => {
    const nav = location.state as { openReturns?: boolean; returnInvoiceId?: string } | null;
    if (!nav?.openReturns) return;
    openReturnFromInvoice(nav.returnInvoiceId);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate, openReturnFromInvoice]);

  // Filtered list with date range and supplier filters
  const filtered = useMemo(() => {
    let result = invoices;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(i =>
        i.invoiceNumber.toLowerCase().includes(q) ||
        i.supplierName.toLowerCase().includes(q) ||
        (i.supplierInvoiceNo && i.supplierInvoiceNo.toLowerCase().includes(q))
      );
    }
    if (filterSupplier && filterSupplier !== '__all__') {
      const q = filterSupplier.toLowerCase();
      result = result.filter(i => i.supplierName.toLowerCase().includes(q));
    }
    if (filterDateFrom) {
      result = result.filter(i => i.date >= filterDateFrom);
    }
    if (filterDateTo) {
      result = result.filter(i => i.date <= filterDateTo);
    }
    return result;
  }, [invoices, searchTerm, filterSupplier, filterDateFrom, filterDateTo]);

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return products.slice(0, 300);
    const q = searchTerm.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      p.barcode?.toLowerCase().includes(q)
    ).slice(0, 300);
  }, [products, searchTerm]);

  // ─────── Create mode ───────
  const resetCreateFormState = useCallback(() => {
    const now = new Date().toISOString();
    const defaultBranch = branches.find((b) => b.id === currentBranch?.id) || branches[0];
    const wid = defaultBranch?.id || currentBranch?.id || '';
    const wname = defaultBranch?.name || currentBranch?.name || '';
    setSaveError(null);
    createInvoiceSessionRef.current = null;
    editingInvoiceRef.current = null;
    setNextFcPreview(null);
    setForm({
      date: now.split('T')[0],
      paymentDate: now.split('T')[0],
      currency: 'KZ',
      warehouseId: wid,
      warehouseName: wname,
      priceType: 'last_price',
      purchaseAccountCode: '2.1.1',
      ivaAccountCode: '3.3.1',
      transactionType: 'ALL',
      currencyRate: 1,
      taxRate2: 0,
      surchargePercent: 0,
      changePrice: true,
      isPending: false,
      supplierId: undefined,
      supplierName: undefined,
      supplierAccountCode: undefined,
      supplierNif: undefined,
      supplierPhone: undefined,
      supplierBalance: undefined,
      supplierInvoiceNo: undefined,
      ref: undefined,
      ref2: undefined,
      contact: undefined,
      department: undefined,
      orderNo: undefined,
      extraNote: undefined,
    });
    setLines([]);
    setJournalLines([]);
    setFreightCost(0);
    setFreightOtherCosts(0);
    setFreightSourceAccount('4.1.1');
    setFreightSourceName('Caixa');
    setFillFromPoId('');
    setActiveTab('fatura');
  }, [currentBranch, branches]);

  const startCreate = useCallback(() => {
    resetCreateFormState();
    setMode('create');
  }, [resetCreateFormState]);

  const formatInvoiceDateField = (value?: string) => {
    if (!value) return '';
    return value.includes('T') ? value.split('T')[0] : value;
  };

  const startEditInvoice = useCallback(async (inv: PurchaseInvoice) => {
    const full = (await getPurchaseInvoiceById(inv.id)) || inv;
    editingInvoiceRef.current = full;
    createInvoiceSessionRef.current = {
      id: full.id,
      invoiceNumber: full.invoiceNumber,
    };
    setNextFcPreview(full.invoiceNumber);
    setForm({
      date: formatInvoiceDateField(full.date),
      paymentDate: formatInvoiceDateField(full.paymentDate),
      currency: full.currency || 'KZ',
      warehouseId: full.warehouseId,
      warehouseName: full.warehouseName,
      priceType: full.priceType || 'last_price',
      purchaseAccountCode: full.purchaseAccountCode || '2.1.1',
      ivaAccountCode: full.ivaAccountCode || '3.3.1',
      transactionType: full.transactionType || 'ALL',
      currencyRate: full.currencyRate ?? 1,
      taxRate2: full.taxRate2 ?? 0,
      surchargePercent: full.surchargePercent ?? 0,
      changePrice: full.changePrice ?? false,
      isPending: full.isPending ?? false,
      supplierId: full.supplierId,
      supplierName: full.supplierName,
      supplierAccountCode: full.supplierAccountCode,
      supplierNif: full.supplierNif,
      supplierPhone: full.supplierPhone,
      supplierBalance: full.supplierBalance,
      supplierInvoiceNo: full.supplierInvoiceNo,
      ref: full.ref,
      ref2: full.ref2,
      contact: full.contact,
      department: full.department,
      orderNo: full.orderNo,
      extraNote: full.extraNote,
      address: full.address,
      project: full.project,
    });
    setLines(full.lines || []);
    setJournalLines(full.journalLines || []);
    setFreightCost(0);
    setFreightOtherCosts(0);
    setFillFromPoId('');
    setActiveTab('fatura');
    setSaveError(null);
    setSelectedListInvoiceId(full.id);
    setMode('create');
  }, []);

  const handleMarkAsPaid = useCallback(async (inv: PurchaseInvoice) => {
    if (!inv.isPending) return;
    try {
      const now = new Date().toISOString();
      const updated: PurchaseInvoice = {
        ...inv,
        isPending: false,
        paymentDate: formatInvoiceDateField(now) || now.split('T')[0],
        updatedAt: now,
      };
      await savePurchaseInvoice(updated, { metadataOnly: true });
      await loadInvoiceList();
      setSelectedListInvoiceId(updated.id);
      toast({
        title: t.purchaseInvoicesUi.markedPaidTitle,
        description: t.purchaseInvoicesUi.markedPaidDesc.replace('{no}', updated.invoiceNumber),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t.purchaseInvoicesUi.unknownError;
      toast({ title: t.common.error, description: message, variant: 'destructive' });
    }
  }, [loadInvoiceList, toast, t]);

  const broadcastPurchaseAccountingSync = useCallback(async (
    warehouseId: string,
    branchId: string,
  ) => {
    invalidateInventoryGridCacheForBranches([warehouseId, branchId].filter(Boolean));
    window.dispatchEvent(
      new CustomEvent(PRODUCTS_CHANGED_EVENT, { detail: { branchId: warehouseId } }),
    );
    window.dispatchEvent(
      new CustomEvent(OPEN_ITEMS_CHANGED_EVENT, { detail: { branchId } }),
    );
    window.dispatchEvent(new CustomEvent(SUPPLIERS_CHANGED_EVENT, { detail: {} }));
    if (warehouseId) {
      try {
        await api.products.repairFilialStock(warehouseId);
      } catch (repairErr) {
        console.warn('[PurchaseInvoices] repairFilialStock:', repairErr);
      }
    }
    await Promise.all([refreshProducts(), refreshSuppliers(), loadInvoiceList()]);
  }, [loadInvoiceList, refreshProducts, refreshSuppliers]);

  const ensurePurchaseAccountingPosted = useCallback(async (
    invoiceId: string,
    txResult: { stockMovementIds?: string[]; openItemId?: string; success?: boolean },
  ) => {
    const stockIds = [...(txResult.stockMovementIds || [])];
    let openItemId = txResult.openItemId;
    const needsRepair = !txResult.success || stockIds.length === 0 || !openItemId;

    if (needsRepair) {
      try {
        const repair = await api.purchaseInvoices.repostAccounting(invoiceId);
        if (repair.data?.stockMovementIds?.length) {
          stockIds.splice(0, stockIds.length, ...repair.data.stockMovementIds);
        }
        if (repair.data?.openItemId) {
          openItemId = repair.data.openItemId;
        }
      } catch (repairErr) {
        console.warn('[PurchaseInvoices] repost-accounting:', repairErr);
      }
    }
    if (!openItemId) {
      try {
        await api.payments.backfillMissingPayables();
      } catch (backfillErr) {
        console.warn('[PurchaseInvoices] backfill payables:', backfillErr);
      }
    }
    return { stockMovementIds: stockIds, openItemId };
  }, []);

  const handleRepostAccounting = useCallback(async (inv: PurchaseInvoice) => {
    try {
      const warehouseId = String(inv.warehouseId || inv.branchId || '').trim();
      const branchId = String(inv.branchId || inv.warehouseId || '').trim();
      const posted = await ensurePurchaseAccountingPosted(inv.id, {});
      await broadcastPurchaseAccountingSync(warehouseId, branchId);
      setSelectedListInvoiceId(inv.id);
      const hasStock = (posted.stockMovementIds?.length ?? 0) > 0;
      const hasPayable = !!posted.openItemId;
      if (hasStock && hasPayable) {
        toast({
          title: t.purchaseInvoicesUi.repostStockPayableDoneTitle,
          description: t.purchaseInvoicesUi.repostStockPayableDoneDesc.replace('{no}', inv.invoiceNumber),
        });
      } else {
        toast({
          title: t.purchaseInvoicesUi.transactionEngineFailureTitle,
          description: t.purchaseInvoicesUi.purchaseSavedPartialSync,
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t.purchaseInvoicesUi.unknownError;
      toast({ title: t.common.error, description: message, variant: 'destructive' });
    }
  }, [broadcastPurchaseAccountingSync, ensurePurchaseAccountingPosted, toast, t]);

  /** Leaving `/purchase-invoices/new` avoids staying on a route that always re-triggers create on mount. */
  const goToPurchaseListRoute = useCallback(() => {
    if (location.pathname === PURCHASE_INVOICES_NEW_PATH) {
      navigate('/purchase-invoices', { replace: true });
    }
  }, [location.pathname, navigate]);

  // Keep warehouse value valid when branches load after opening create (avoid orphan ids / type mismatch).
  useEffect(() => {
    if (mode !== 'create') return;
    if (!branches.length) return;
    const id = form.warehouseId != null && form.warehouseId !== '' ? String(form.warehouseId) : '';
    const ok = id.length > 0 && branches.some((b) => b.id != null && String(b.id) === id);
    if (!ok) {
      const b =
        branches.find((x) => x.id != null && String(x.id) === String(currentBranch?.id)) || branches[0];
      if (b?.id != null && b.id !== '') {
        setForm((p) => ({ ...p, warehouseId: b.id, warehouseName: b.name }));
      }
    }
  }, [mode, branches, currentBranch?.id, form.warehouseId]);

  useLayoutEffect(() => {
    const fromRouter = searchParams.get('mode');
    const fromHash = readModeParamFromHash();
    const urlMode = fromRouter ?? fromHash;
    const nexorToolbarNew =
      searchParams.get(NEXOR_PURCHASE_NEW_QUERY_KEY) ?? readNexorPiNewFromHash();

    if (mode === 'create') {
      clearPurchaseCreateIntent();
      urlCreateAppliedRef.current = false;
      return;
    }

    if (location.pathname === PURCHASE_INVOICES_NEW_PATH) {
      urlCreateAppliedRef.current = false;
      startCreate();
      return;
    }

    if (urlMode === 'product-picker') {
      setProductPickerOpen(true);
      const next = new URLSearchParams(searchParams.toString());
      next.delete('mode');
      next.delete('standalone');
      next.delete(NEXOR_PURCHASE_NEW_QUERY_KEY);
      const qs = next.toString();
      navigate(
        { pathname: location.pathname, search: qs ? `?${qs}` : '' },
        { replace: true },
      );
      return;
    }

    if (urlMode === 'create') {
      writePurchaseCreateIntent();
    }

    let shouldEnterCreate = urlMode === 'create' || !!nexorToolbarNew;
    if (!shouldEnterCreate) {
      shouldEnterCreate = readPurchaseCreateIntentPending();
    }

    if (!shouldEnterCreate) return;
    if (urlCreateAppliedRef.current) return;

    urlCreateAppliedRef.current = true;

    startCreate();

    const next = new URLSearchParams(searchParams.toString());
    next.delete('mode');
    next.delete('standalone');
    next.delete(NEXOR_PURCHASE_NEW_QUERY_KEY);
    const qs = next.toString();
    navigate(
      { pathname: location.pathname, search: qs ? `?${qs}` : '' },
      { replace: true },
    );
  }, [searchParams, mode, startCreate, navigate, location.pathname, location.search]);

  // Main process still injects intent asynchronously via executeJavaScript — defer one tick so we never miss it.
  useEffect(() => {
    if (mode !== 'list') return;
    const tid = window.setTimeout(() => {
      if (urlCreateAppliedRef.current) return;
      if (!readPurchaseCreateIntentPending()) return;
      urlCreateAppliedRef.current = true;
      startCreate();
      clearPurchaseCreateIntent();
      const next = new URLSearchParams(searchParams.toString());
      next.delete('mode');
      next.delete('standalone');
      next.delete(NEXOR_PURCHASE_NEW_QUERY_KEY);
      const qs = next.toString();
      navigate(
        { pathname: location.pathname, search: qs ? `?${qs}` : '' },
        { replace: true },
      );
    }, 0);
    return () => window.clearTimeout(tid);
  }, [mode, startCreate, navigate, location.pathname, searchParams]);

   // Select supplier — auto-create CoA sub-account under 3.2 Fornecedores
  const handleSelectSupplier = useCallback(async (s: Supplier) => {
    setFillFromPoId('');
    const accountCode = await ensureSupplierAccount(s.id, s.name, s.nif);
    // Fetch real supplier balance from open items
    let balance = 0;
    try {
      const balRes = await api.payments.balance('supplier', s.id);
      balance = parseFloat((balRes.data as any)?.balance) || 0;
    } catch { /* balance stays 0 */ }
    setForm(prev => ({
      ...prev,
      supplierAccountCode: accountCode,
      supplierId: s.id,
      supplierName: s.name,
      supplierNif: s.nif,
      supplierPhone: s.phone,
      supplierBalance: balance,
    }));
  }, []);

  const saveNewSupplier = useCallback(async () => {
    if (!newSupplierForm.name.trim()) {
      throw new Error(t.purchaseInvoicesUi.supplierNamePlaceholder || 'Nome obrigatório');
    }
    const created = await createSupplier({
      name: newSupplierForm.name.trim(),
      nif: newSupplierForm.nif.trim() || '',
      email: newSupplierForm.email.trim(),
      phone: newSupplierForm.phone.trim(),
      address: newSupplierForm.address.trim(),
      city: newSupplierForm.city.trim(),
      country: newSupplierForm.country.trim() || 'Angola',
      contactPerson: newSupplierForm.contactPerson.trim(),
      notes: newSupplierForm.notes.trim(),
      isActive: true,
      balance: 0,
      paymentTerms: '30_days',
    } as Supplier);
    setShowCreateSupplier(false);
    await refreshSuppliers();
    if (mode === 'create') {
      await handleSelectSupplier(created);
    }
    toast({
      title: t.purchaseInvoicesUi.supplierCreatedTitle,
      description: t.purchaseInvoicesUi.supplierCreatedDesc.replace('{name}', created.name),
    });
  }, [createSupplier, newSupplierForm, refreshSuppliers, mode, handleSelectSupplier, toast, t]);

  // Add product line
  const handleAddProduct = useCallback((p: Product) => {
    const newLine = calculateLine({
      productId: p.id,
      productCode: p.sku,
      description: p.name,
      quantity: 1,
      packaging: 1,
      unitPrice: p.lastCost || p.cost || 0,
      discountPct: 0,
      discountPct2: 0,
      ivaRate: p.taxRate ?? DEFAULT_VAT_RATE,
      warehouseId: form.warehouseId || currentBranch?.id || '',
      warehouseName: form.warehouseName || currentBranch?.name || '',
      currentStock: p.stock,
      unit: p.unit || 'UN',
      barcode: p.barcode,
      price1: p.price || 0,
      price2: p.price2 || 0,
      price3: p.price3 || 0,
      price4: p.price4 || 0,
      lastCost: p.lastCost || p.cost || 0,
      avgCost: p.avgCost || p.cost || 0,
    });
    setLines((prev) => {
      setGridFocusCell({ row: prev.length, field: 'quantity' });
      return [...prev, newLine];
    });
  }, [form.warehouseId, form.warehouseName, currentBranch]);

  const applyLinesFromPurchaseOrder = useCallback(
    (order: PurchaseOrder) => {
      const wid = (form.warehouseId || currentBranch?.id || '').trim();
      const wname = form.warehouseName || currentBranch?.name || '';
      const rows: PurchaseInvoiceLine[] = [];
      for (const it of order.items || []) {
        const qty = Number(it.quantity || 0);
        if (qty <= 0) continue;
        const unitCost = Number(it.unitCost || 0);
        const product = products.find((p) => p.id === it.productId);
        const ivaRate =
          product?.taxRate != null && product.taxRate > 0
            ? product.taxRate
            : it.taxRate != null && it.taxRate > 0
              ? it.taxRate
              : 14;
        rows.push(
          calculateLine({
            productId: it.productId,
            productCode: product?.sku || it.sku || '',
            description: product?.name || it.productName || '',
            quantity: qty,
            packaging: 1,
            unitPrice: unitCost,
            discountPct: 0,
            discountPct2: 0,
            ivaRate,
            warehouseId: wid,
            warehouseName: wname,
            currentStock: product?.stock ?? 0,
            unit: product?.unit || 'UN',
            barcode: product?.barcode,
            price1: product?.price || 0,
            price2: product?.price2 || 0,
            price3: product?.price3 || 0,
            price4: product?.price4 || 0,
            lastCost: product?.lastCost || product?.cost || 0,
            avgCost: product?.avgCost || product?.cost || 0,
          }),
        );
      }
      if (rows.length === 0) {
        toast({
          title: t.common.error,
          description: t.purchaseInvoicesUi.fillFromOrderNoLines,
          variant: 'destructive',
        });
        return;
      }
      setLines(rows);
      setForm((prev) => ({
        ...prev,
        orderNo: order.orderNumber,
      }));
      const fc = Number(order.freightCost || 0);
      const oc = Number(order.otherCosts || 0);
      if (fc > 0) setFreightCost(fc);
      if (oc > 0) setFreightOtherCosts(oc);
      toast({
        title: t.purchaseInvoicesUi.fillFromOrderToastTitle,
        description: t.purchaseInvoicesUi.fillFromOrderToastDesc.replace('{orderNo}', order.orderNumber),
      });
    },
    [form.warehouseId, form.warehouseName, currentBranch, products, toast, t],
  );

  const handleOpenProductPicker = useCallback(() => {
    setProductPickerOpen(true);
  }, []);

  useEffect(() => {
    if (mode !== 'list') return;

    const selected = selectedListInvoiceId
      ? invoices.find((i) => i.id === selectedListInvoiceId)
      : undefined;

    const onEdit = () => {
      if (selected) {
        void startEditInvoice(selected);
      } else {
        toast({
          title: t.common.error,
          description: t.purchaseInvoicesUi.selectInvoiceToEdit,
          variant: 'destructive',
        });
      }
    };
    const onAll = () => setSelectedListInvoiceId(null);

    const handlers: Record<string, () => void> = {
      [NEXOR_TOOLBAR.EDIT]: onEdit,
      [NEXOR_TOOLBAR.ALL]: onAll,
    };
    for (const [event, handler] of Object.entries(handlers)) {
      window.addEventListener(event, handler);
    }
    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        window.removeEventListener(event, handler);
      }
    };
  }, [mode, selectedListInvoiceId, invoices, startEditInvoice, toast, t]);

  useEffect(() => {
    if (mode !== 'list' || listTab !== 'faturas') {
      setContextMenuResolver(null);
      return;
    }

    setContextMenuResolver((target) => {
      const row = target.closest('[data-nexor-context="purchase-invoice-row"]');
      if (!row) return [];
      const invoiceId = row.getAttribute('data-nexor-id');
      const inv = invoices.find((i) => i.id === invoiceId);
      if (!inv) return [];

      const items = [
        {
          id: 'pi-edit',
          label: t.interaction.openEdit,
          onSelect: () => {
            setSelectedListInvoiceId(inv.id);
            void startEditInvoice(inv);
          },
        },
      ];
      if (inv.isPending) {
        items.push({
          id: 'pi-mark-paid',
          label: t.purchaseInvoicesUi.markAsPaid,
          onSelect: () => {
            setSelectedListInvoiceId(inv.id);
            void handleMarkAsPaid(inv);
          },
        });
      }
      items.push({
        id: 'pi-repost',
        label: t.purchaseInvoicesUi.repostStockPayable,
        onSelect: () => {
          setSelectedListInvoiceId(inv.id);
          void handleRepostAccounting(inv);
        },
      });
      return items;
    });

    return () => setContextMenuResolver(null);
  }, [mode, listTab, invoices, startEditInvoice, handleMarkAsPaid, handleRepostAccounting, t]);

  const isCreateDirty = useMemo(() => {
    if (lines.length > 0) return true;
    if (String(form.supplierId ?? '').trim() || String(form.supplierName ?? '').trim()) return true;
    if (String(form.supplierInvoiceNo ?? '').trim()) return true;
    if (String(form.ref ?? '').trim() || String(form.ref2 ?? '').trim()) return true;
    if (Number(freightCost) > 0 || Number(freightOtherCosts) > 0) return true;
    if (journalLines.length > 0) return true;
    return false;
  }, [lines.length, form, freightCost, freightOtherCosts, journalLines.length]);

  const handleCloseCreate = useCallback(() => {
    resetCreateFormState();
    clearPurchaseCreateIntent();
    urlCreateAppliedRef.current = false;
    setDiscardCloseOpen(false);
    setMode("list");
    goToPurchaseListRoute();
  }, [goToPurchaseListRoute, resetCreateFormState]);

  const requestCloseCreate = useCallback(() => {
    if (savingPurchaseRef.current || savingPurchase) return;
    if (isCreateDirty) {
      setDiscardCloseOpen(true);
      return;
    }
    handleCloseCreate();
  }, [isCreateDirty, handleCloseCreate, savingPurchase]);

  const openSupplierPicker = useCallback(async () => {
    await refreshSuppliers();
    setSupplierPickerOpen(true);
  }, [refreshSuppliers]);

  // Update line field
  const updateLineField = useCallback((idx: number, field: keyof PurchaseInvoiceLine, value: number | string) => {
    setLines(prev => {
      const updated = [...prev];
      const line = { ...updated[idx], [field]: value };
      updated[idx] = calculateLine(line);
      return updated;
    });
  }, []);

  // Remove line
  const removeLine = useCallback((idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // Totals
  const totals = useMemo(() => calculateInvoiceTotals(lines), [lines]);

  // Angola purchase taxes (document-level)
  const withholdingRate = Number(form.taxRate2 || 0); // Retenção na Fonte (%)
  const stampRate = Number(form.surchargePercent || 0); // Imposto de Selo (%)
  const taxBaseSubtotalPlusFreight = useMemo(
    () => roundMoney(totals.subtotal + totalLandingCosts),
    [totals.subtotal, totalLandingCosts]
  );
  const withholdingAmount = useMemo(
    () => roundMoney(taxBaseSubtotalPlusFreight * (withholdingRate / 100)),
    [taxBaseSubtotalPlusFreight, withholdingRate]
  );
  const stampAmount = useMemo(
    () => roundMoney(taxBaseSubtotalPlusFreight * (stampRate / 100)),
    [taxBaseSubtotalPlusFreight, stampRate]
  );
  const supplierGrossTotal = totals.total;
  const supplierNetPayable = Math.max(roundMoney(supplierGrossTotal - withholdingAmount), 0);

  const postedJournalPreview = useMemo(() => buildPurchaseInvoiceJournalLines({
    documentId: 'preview',
    invoiceNumber: nextFcPreview || form.supplierInvoiceNo || form.ref || t.purchaseInvoicesUi.previewInvoiceNumber,
    currency: form.currency || 'KZ',
    purchaseAccountCode: form.purchaseAccountCode || '2.1.1',
    ivaAccountCode: form.ivaAccountCode || '3.3.1',
    supplierAccountCode: form.supplierAccountCode || '',
    supplierName: form.supplierName || 'Fornecedor',
    subtotal: totals.subtotal,
    ivaTotal: totals.ivaTotal,
    supplierTotal: totals.total,
    withholdingAmount,
    stampAmount,
    landingCosts: totalLandingCosts,
    freightSourceAccount,
    freightSourceName,
    manualLines: journalLines,
    labelFreightLine: t.purchaseInvoicesUi.transportOnPurchases,
    labelDeductibleVat: t.purchaseInvoicesUi.deductibleVat,
  }), [
    nextFcPreview,
    t.purchaseInvoicesUi.previewInvoiceNumber,
    t.purchaseInvoicesUi.transportOnPurchases,
    t.purchaseInvoicesUi.deductibleVat,
    form.currency,
    form.ivaAccountCode,
    form.purchaseAccountCode,
    form.ref,
    form.supplierAccountCode,
    form.supplierInvoiceNo,
    form.supplierName,
    freightSourceAccount,
    freightSourceName,
    journalLines,
    stampAmount,
    totals.ivaTotal,
    totals.subtotal,
    totals.total,
    totalLandingCosts,
    withholdingAmount,
  ]);

  const postedJournalTotals = useMemo(() => {
    const debit = postedJournalPreview.reduce((sum, line) => sum + (line.debit || 0), 0);
    const credit = postedJournalPreview.reduce((sum, line) => sum + (line.credit || 0), 0);
    return {
      debit,
      credit,
      difference: debit - credit,
    };
  }, [postedJournalPreview]);

  // Add journal line
  const addJournalLine = useCallback(() => {
    setJournalLines(prev => [...prev, {
      id: `jl_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      accountCode: '',
      accountName: '',
      currency: form.currency || 'KZ',
      note: '',
      debit: 0,
      credit: 0,
    }]);
  }, [form.currency]);

  const updateJournalLine = useCallback((idx: number, field: keyof PurchaseInvoiceJournalLine, value: string | number) => {
    setJournalLines(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  }, []);

  const removeJournalLine = useCallback((idx: number) => {
    setJournalLines(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // Open account picker for a journal line
  const openAccountPicker = useCallback((idx: number) => {
    setEditingJournalIdx(idx);
    setAccountPickerTarget('journal');
    setAccountPickerOpen(true);
  }, []);

  const handleAccountSelect = useCallback((code: string, name: string) => {
    if (freightPickerOpen) {
      setFreightSourceAccount(code);
      setFreightSourceName(name);
      setFreightPickerOpen(false);
    } else if (accountPickerTarget === 'journal' && editingJournalIdx !== null) {
      updateJournalLine(editingJournalIdx, 'accountCode', code);
      updateJournalLine(editingJournalIdx, 'accountName', name);
    }
    setAccountPickerTarget(null);
    setEditingJournalIdx(null);
  }, [accountPickerTarget, editingJournalIdx, updateJournalLine, freightPickerOpen]);

  // ─────── SAVE (all phases) ───────
  const handleSave = useCallback(async () => {
    if (savingPurchaseRef.current || savingPurchase) return;
    savingPurchaseRef.current = true;
    setSavingPurchase(true);
    try {
    setSaveError(null);
    console.log('[PurchaseInvoices] === SAVE START ===');
    console.log('[PurchaseInvoices] form.supplierName:', form.supplierName);
    console.log('[PurchaseInvoices] form.supplierAccountCode:', form.supplierAccountCode);
    console.log('[PurchaseInvoices] lines count:', lines.length);
    console.log('[PurchaseInvoices] activeSuppliers count:', activeSuppliers.length);

    // Validate supplier FIRST before any async work
    if (!form.supplierName) {
      setSaveError(t.purchaseInvoicesUi.selectSupplierBeforeSave);
      console.warn('[PurchaseInvoices] BLOCKED: No supplier name');
      toast({ title: t.common.error, description: t.purchaseInvoicesUi.selectSupplier, variant: 'destructive' });
      return;
    }

    const formWithSupplier = form as Partial<PurchaseInvoice> & { supplierId?: string; supplierInvoiceNo?: string };
    console.log('[PurchaseInvoices] formWithSupplier.supplierId:', formWithSupplier.supplierId);

    const matchedSupplier = activeSuppliers.find(s =>
      s.id === formWithSupplier.supplierId ||
      (!!form.supplierNif && s.nif === form.supplierNif) ||
      (!!form.supplierName && s.name.trim().toLowerCase() === form.supplierName.trim().toLowerCase())
    );
    console.log('[PurchaseInvoices] matchedSupplier:', matchedSupplier ? `${matchedSupplier.id} — ${matchedSupplier.name}` : 'NOT FOUND');

    const resolvedSupplierId = matchedSupplier?.id || formWithSupplier.supplierId;

    if (!resolvedSupplierId) {
      setSaveError(t.purchaseInvoicesUi.invalidSupplierLinkSelectAgain);
      console.warn('[PurchaseInvoices] BLOCKED: No resolved supplier ID');
      toast({
        title: t.common.error,
        description: t.purchaseInvoicesUi.invalidSupplierLinkCreateOrSelect,
        variant: 'destructive',
      });
      return;
    }

    // ERP validation: block duplicate supplier invoice number (same supplier + same supplier invoice no)
    const supplierInvoiceNo = String(formWithSupplier.supplierInvoiceNo || '').trim();
    if (supplierInvoiceNo) {
      const noLower = supplierInvoiceNo.toLowerCase();
      const retryInvoiceId = createInvoiceSessionRef.current?.id;
      const localDup = invoices.find((inv) => {
        if (retryInvoiceId && inv.id === retryInvoiceId) return false;
        if (!inv.supplierInvoiceNo?.trim()) return false;
        if (inv.supplierInvoiceNo.trim().toLowerCase() !== noLower) return false;
        if (inv.supplierId && resolvedSupplierId) {
          return inv.supplierId === resolvedSupplierId;
        }
        return (
          (inv.supplierNif && form.supplierNif && inv.supplierNif === form.supplierNif) ||
          (inv.supplierName && form.supplierName &&
            inv.supplierName.trim().toLowerCase() === form.supplierName.trim().toLowerCase())
        );
      });

      if (localDup) {
        setSaveError(t.purchaseInvoicesUi.duplicateSupplierInvoiceNo);
        toast({
          title: t.common.error,
          description: t.purchaseInvoicesUi.duplicateSupplierInvoiceNo,
          variant: 'destructive',
        });
        return;
      }

      try {
        const dupRes = await api.purchaseInvoices.checkDuplicate({
          supplierId: resolvedSupplierId,
          supplierInvoiceNo,
          excludeId: retryInvoiceId,
        });
        if (dupRes.data?.duplicate) {
          setSaveError(t.purchaseInvoicesUi.duplicateSupplierInvoiceNo);
          toast({
            title: t.common.error,
            description: t.purchaseInvoicesUi.duplicateSupplierInvoiceNo,
            variant: 'destructive',
          });
          return;
        }
      } catch {
        // Non-blocking if API unavailable; local list check above still applies.
      }
    }

    // Resolve supplier account code — with explicit error handling
    let resolvedSupplierAccountCode = form.supplierAccountCode || '';
    console.log('[PurchaseInvoices] Initial supplierAccountCode:', resolvedSupplierAccountCode);

    if (!resolvedSupplierAccountCode && matchedSupplier) {
      try {
        resolvedSupplierAccountCode = await ensureSupplierAccount(matchedSupplier.id, matchedSupplier.name, matchedSupplier.nif);
        console.log(`[PurchaseInvoices] Resolved supplier account: ${resolvedSupplierAccountCode} for ${matchedSupplier.name}`);
      } catch (err: any) {
        setSaveError(
          t.purchaseInvoicesUi.cannotResolveSupplierAccount
            .replace('{message}', err?.message || t.purchaseInvoicesUi.unknownError)
        );
        console.error('[PurchaseInvoices] Failed to resolve supplier account:', err);
        toast({
          title: t.purchaseInvoicesUi.supplierAccountErrorTitle,
          description: t.purchaseInvoicesUi.cannotResolveSupplierAccountShort
            .replace('{message}', err?.message || t.purchaseInvoicesUi.unknownError),
          variant: 'destructive',
        });
        return;
      }
    }
    if (!resolvedSupplierAccountCode) {
      setSaveError(t.purchaseInvoicesUi.supplierNoValidSubaccount);
      console.warn('[PurchaseInvoices] BLOCKED: No supplier account code resolved');
      toast({
        title: t.common.error,
        description: t.purchaseInvoicesUi.supplierNoValidSubaccount,
        variant: 'destructive',
      });
      return;
    }
    if (lines.length === 0) {
      setSaveError(t.purchaseInvoicesUi.addAtLeastOneProductBeforeSave);
      console.warn('[PurchaseInvoices] BLOCKED: No lines');
      toast({ title: t.common.error, description: t.purchaseInvoicesUi.addAtLeastOneProduct, variant: 'destructive' });
      return;
    }

    // Warehouse = stock location, document branch, FC sequence, and accounting branch for this FC.
    const resolvedWarehouseId =
      String(form.warehouseId ?? '').trim() || String(currentBranch?.id ?? '').trim() || '';
    const whMeta = branches.find((b) => String(b.id) === String(resolvedWarehouseId));
    const resolvedWarehouseName =
      String(form.warehouseName ?? '').trim() || whMeta?.name || currentBranch?.name || '';

    const resolvedBranchId = String(resolvedWarehouseId).trim();
    const resolvedBranchName = resolvedWarehouseName || whMeta?.name || '';

    if (!resolvedBranchId) {
      setSaveError(t.purchaseInvoicesUi.noActiveBranchSelectWarehouse);
      toast({
        title: t.common.error,
        description: t.purchaseInvoicesUi.noActiveBranchSelectWarehouse,
        variant: 'destructive',
      });
      return;
    }

    if (!resolvedWarehouseId) {
      setSaveError(t.purchaseInvoicesUi.selectWarehouseBeforeSave);
      toast({
        title: t.common.error,
        description: t.purchaseInvoicesUi.selectWarehouseBeforeSave,
        variant: 'destructive',
      });
      return;
    }

    console.log('[PurchaseInvoices] All validations passed, building invoice...');

    const editingOriginal = editingInvoiceRef.current;
    if (editingOriginal) {
      const now = new Date().toISOString();
      const manualJournalLines = journalLines;
      const updatedInvoice: PurchaseInvoice = {
        ...editingOriginal,
        supplierAccountCode: resolvedSupplierAccountCode,
        supplierName: matchedSupplier?.name || form.supplierName || '',
        supplierId: resolvedSupplierId,
        supplierNif: matchedSupplier?.nif || form.supplierNif,
        supplierPhone: matchedSupplier?.phone || form.supplierPhone,
        supplierBalance: form.supplierBalance || 0,
        ref: form.ref,
        supplierInvoiceNo: formWithSupplier.supplierInvoiceNo,
        contact: form.contact,
        department: form.department,
        ref2: form.ref2,
        date: form.date || editingOriginal.date,
        paymentDate: form.paymentDate || editingOriginal.paymentDate,
        project: form.project,
        currency: form.currency || 'KZ',
        warehouseId: resolvedWarehouseId,
        warehouseName: resolvedWarehouseName,
        priceType: form.priceType || 'last_price',
        address: form.address,
        purchaseAccountCode: form.purchaseAccountCode || '2.1.1',
        ivaAccountCode: form.ivaAccountCode || '3.3.1',
        transactionType: form.transactionType || 'ALL',
        currencyRate: form.currencyRate || 1,
        taxRate2: Number(form.taxRate2 || 0),
        orderNo: form.orderNo,
        surchargePercent: Number(form.surchargePercent || 0),
        changePrice: form.changePrice || false,
        isPending: form.isPending || false,
        extraNote: form.extraNote,
        lines,
        journalLines: [],
        subtotal: totals.subtotal,
        ivaTotal: totals.ivaTotal,
        total: supplierNetPayable,
        branchId: resolvedBranchId,
        branchName: resolvedBranchName,
        updatedAt: now,
      };
      updatedInvoice.journalLines = buildPurchaseInvoiceJournalLines({
        documentId: updatedInvoice.id,
        invoiceNumber: updatedInvoice.invoiceNumber,
        currency: updatedInvoice.currency,
        purchaseAccountCode: updatedInvoice.purchaseAccountCode || '2.1.1',
        ivaAccountCode: updatedInvoice.ivaAccountCode || '3.3.1',
        supplierAccountCode: updatedInvoice.supplierAccountCode,
        supplierName: updatedInvoice.supplierName,
        subtotal: updatedInvoice.subtotal,
        ivaTotal: updatedInvoice.ivaTotal,
        supplierTotal: supplierGrossTotal,
        withholdingAmount,
        stampAmount,
        landingCosts: totalLandingCosts,
        freightSourceAccount,
        freightSourceName,
        manualLines: manualJournalLines,
        labelFreightLine: t.purchaseInvoicesUi.transportOnPurchases,
        labelDeductibleVat: t.purchaseInvoicesUi.deductibleVat,
      });
      await savePurchaseInvoice(updatedInvoice, { metadataOnly: true });
      await syncPurchaseInvoiceDocument(updatedInvoice, t.purchaseInvoicesUi.supplierInvoiceNoStripPrefix);
      toast({
        title: t.purchaseInvoicesUi.purchaseInvoiceUpdatedTitle,
        description: `${updatedInvoice.invoiceNumber} — ${updatedInvoice.supplierName}`,
      });
      await loadInvoiceList();
      editingInvoiceRef.current = null;
      resetCreateFormState();
      clearPurchaseCreateIntent();
      setMode('list');
      goToPurchaseListRoute();
      return;
    }

    let allocatedInvoiceNumber: string;
    const session = createInvoiceSessionRef.current;
    if (session?.id && session.invoiceNumber) {
      allocatedInvoiceNumber = session.invoiceNumber;
    } else {
      try {
        allocatedInvoiceNumber = await allocatePurchaseInvoiceNumber(resolvedWarehouseId);
      } catch (allocErr: unknown) {
        const msg = allocErr instanceof Error ? allocErr.message : t.purchaseInvoicesUi.unknownError;
        setSaveError(msg);
        toast({ title: t.common.error, description: msg, variant: 'destructive' });
        return;
      }
    }

    const now = new Date().toISOString();

    const manualJournalLines = journalLines;

    let invoice: PurchaseInvoice = {
      id: session?.id || generateId(),
      invoiceNumber: allocatedInvoiceNumber,
      supplierAccountCode: resolvedSupplierAccountCode,
      supplierName: matchedSupplier?.name || form.supplierName || '',
      supplierId: resolvedSupplierId,
      supplierNif: matchedSupplier?.nif || form.supplierNif,
      supplierPhone: matchedSupplier?.phone || form.supplierPhone,
      supplierBalance: form.supplierBalance || 0,
      ref: form.ref,
      supplierInvoiceNo: formWithSupplier.supplierInvoiceNo,
      contact: form.contact,
      department: form.department,
      ref2: form.ref2,
      date: form.date || now,
      paymentDate: form.paymentDate || now,
      project: form.project,
      currency: form.currency || 'KZ',
      warehouseId: resolvedWarehouseId,
      warehouseName: resolvedWarehouseName,
      priceType: form.priceType || 'last_price',
      address: form.address,
      purchaseAccountCode: form.purchaseAccountCode || '2.1.1',
      ivaAccountCode: form.ivaAccountCode || '3.3.1',
      transactionType: form.transactionType || 'ALL',
      currencyRate: form.currencyRate || 1,
      // Angola: Retenção na Fonte (%)
      taxRate2: Number(form.taxRate2 || 0),
      orderNo: form.orderNo,
      // Angola: Imposto de Selo (%)
      surchargePercent: Number(form.surchargePercent || 0),
      changePrice: form.changePrice || false,
      isPending: form.isPending || false,
      extraNote: form.extraNote,
      lines,
      journalLines: [],
      subtotal: totals.subtotal,
      ivaTotal: totals.ivaTotal,
      // Net payable to supplier (gross - withholding). Stamp tax is booked separately as tax payable.
      total: supplierNetPayable,
      status: 'confirmed',
      branchId: resolvedBranchId,
      branchName: resolvedBranchName,
      createdBy: user?.id || '',
      createdByName: user?.name || '',
      createdAt: now,
      updatedAt: now,
    };

    invoice.journalLines = buildPurchaseInvoiceJournalLines({
      documentId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      currency: invoice.currency,
      purchaseAccountCode: invoice.purchaseAccountCode || '2.1.1',
      ivaAccountCode: invoice.ivaAccountCode || '3.3.1',
      supplierAccountCode: invoice.supplierAccountCode,
      supplierName: invoice.supplierName,
      subtotal: invoice.subtotal,
      ivaTotal: invoice.ivaTotal,
      supplierTotal: supplierGrossTotal,
      withholdingAmount,
      stampAmount,
      landingCosts: totalLandingCosts,
      freightSourceAccount,
      freightSourceName,
      manualLines: manualJournalLines,
      labelFreightLine: t.purchaseInvoicesUi.transportOnPurchases,
      labelDeductibleVat: t.purchaseInvoicesUi.deductibleVat,
    });

    createInvoiceSessionRef.current = {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
    };

      const saveResult = await savePurchaseInvoice(invoice);
      invoice = saveResult.invoice;
      await syncPurchaseInvoiceDocument(invoice, t.purchaseInvoicesUi.supplierInvoiceNoStripPrefix);

      let txResult: Awaited<ReturnType<typeof processTransaction>> = {
        success: false,
        errors: [],
        stockMovementIds: saveResult.accounting?.stockMovementIds || [],
        openItemId: saveResult.accounting?.openItemId || undefined,
        journalEntryId: saveResult.accounting?.journalEntryId || undefined,
        documentLinkIds: [],
      };
      if (saveResult.accounting?.success && (txResult.stockMovementIds?.length ?? 0) > 0) {
        txResult.success = true;
        console.log('[PurchaseInvoices] Stock posted by server on save:', txResult.stockMovementIds?.length);
      } else {
      console.log('[PurchaseInvoices] Server save did not post stock — calling processTransaction...', {
        type: 'purchase_invoice',
        docId: invoice.id,
        docNumber: invoice.invoiceNumber,
        branchId: invoice.branchId,
        supplierId: resolvedSupplierId,
        supplierAccountCode: resolvedSupplierAccountCode,
        linesCount: invoice.lines.length,
        total: invoice.total,
      });
      txResult = await processTransaction({
        transactionType: 'purchase_invoice',
        documentId: invoice.id,
        documentNumber: invoice.invoiceNumber,
        branchId: invoice.branchId,
        branchName: invoice.branchName,
        userId: user?.id || '',
        userName: user?.name || '',
        date: invoice.date,
        currency: invoice.currency,
        description: `Fatura de Compra ${invoice.invoiceNumber} — ${invoice.supplierName}`,
        amount: invoice.total,
        linkedPurchaseOrderNumber: String(invoice.orderNo || form.orderNo || form.ref || '').trim() || undefined,
        offlineSyncPayload: { invoiceData: invoice as unknown as Record<string, unknown> },

        // Angola Tax Engine: persist IVA (input) lines for IVA return + audit
        taxLines: [
          ...invoice.lines
            .map((l, idx) => ({
              lineNumber: idx + 1,
              taxCode: ivaRateToTaxCode(l.ivaRate),
              taxRate: l.ivaRate,
              baseAmount: l.total,
              taxAmount: l.ivaAmount,
              isInclusive: false,
            }))
            .filter((tl) => Number(tl.baseAmount || 0) !== 0 || Number(tl.taxAmount || 0) !== 0),
          ...(withholdingAmount > 0
            ? [{
                lineNumber: 10000,
                taxCode: withholdingRateToTaxCode(withholdingRate),
                taxRate: withholdingRate,
                baseAmount: taxBaseSubtotalPlusFreight,
                taxAmount: withholdingAmount,
                isInclusive: false,
              }]
            : []),
          ...(stampAmount > 0
            ? [{
                lineNumber: 10001,
                taxCode: 'IS',
                taxRate: stampRate,
                baseAmount: taxBaseSubtotalPlusFreight,
                taxAmount: stampAmount,
                isInclusive: false,
              }]
            : []),
        ].filter((tl) => !!tl.taxCode),

        // Phase 1: Stock entries — scoped to the selected warehouse
        stockEntries: invoice.lines
          .filter(l => l.productId && (l.totalQty || l.quantity) > 0)
          .map(l => ({
            productId: l.productId,
            productName: l.description,
            productSku: l.productCode,
            quantity: l.totalQty || l.quantity,
            unitCost: l.unitPrice + (freightAllocations[l.productId] || 0),
            direction: 'IN' as const,
            warehouseId: invoice.warehouseId,
          })),

        changePrice: invoice.changePrice,
        // Phase 2: Cost (WAC) + optional selling price when "Alterar preço" is checked
        priceUpdates: invoice.lines
          .filter(l => l.productId && (l.totalQty || l.quantity) > 0)
          .map(l => {
            const lineQty = l.totalQty || l.quantity;
            const landed = l.unitPrice + (freightAllocations[l.productId] || 0);
            const sellingPrice = resolveSellingPriceFromPurchaseLine(
              l,
              { price: l.price1 },
              invoice.priceType,
              landed,
              landed,
            );
            const applySelling =
              invoice.changePrice || (Number(l.price1) > 0 && sellingPrice > 0);
            return {
              productId: l.productId,
              newUnitCost: landed,
              quantityReceived: lineQty,
              updateAvgCost: true,
              ...(applySelling && sellingPrice > 0 ? { sellingPrice } : {}),
            };
          }),

        // Phase 3: Journal entries
        journalLines: invoice.journalLines.map((line) => ({
          accountCode: line.accountCode,
          accountName: line.accountName,
          debit: line.debit,
          credit: line.credit,
          note: line.note,
        })),

        // Phase 4: Open item (payable to supplier) — use REAL supplier ID
        openItem: {
          entityType: 'supplier',
          entityId: resolvedSupplierId,
          entityName: invoice.supplierName,
          documentType: 'invoice',
          originalAmount: invoice.total,
          isDebit: true,
          dueDate: invoice.paymentDate,
          currency: invoice.currency === 'KZ' ? 'AOA' : invoice.currency,
        },

        // Phase 6: Update supplier balance — use REAL supplier ID
        entityBalanceUpdate: {
          entityType: 'supplier',
          entityId: resolvedSupplierId,
          entityName: invoice.supplierName,
          entityNif: invoice.supplierNif,
          amount: invoice.total,
        },
      });

      console.log('[PurchaseInvoices] Transaction result:', JSON.stringify(txResult));
      }

      if (txResult.pendingSync) {
        toast({
          title: t.purchaseInvoicesUi.purchaseInvoiceSavedTitle,
          description: `${invoice.invoiceNumber} — ${t.clientSyncUi.pendingLabel}`,
        });
        await loadInvoiceList();
        resetCreateFormState();
        clearPurchaseCreateIntent();
        setMode('list');
        goToPurchaseListRoute();
        return;
      }

      if (!txResult.success) {
        console.error('[PurchaseInvoices] Transaction engine errors:', txResult.errors);
      }

      const resolvedIds = txResult.resolvedProductIds;
      if (resolvedIds && Object.keys(resolvedIds).length > 0) {
        invoice.lines = invoice.lines.map((line) => {
          const mapped = line.productId ? resolvedIds[line.productId] : undefined;
          return mapped && mapped !== line.productId ? { ...line, productId: mapped } : line;
        });
        await savePurchaseInvoice(invoice, { metadataOnly: true });
      }

      const posted = await ensurePurchaseAccountingPosted(invoice.id, txResult);
      await broadcastPurchaseAccountingSync(resolvedWarehouseId, resolvedBranchId);

      const orderNoRef = String(invoice.orderNo || form.orderNo || form.ref || '').trim();
      if (orderNoRef && resolvedSupplierId) {
        void (async () => {
          try {
            const linkRes = await api.purchaseOrders.markReceivedFromInvoice({
              orderNumber: orderNoRef,
              supplierId: resolvedSupplierId,
              receivedBy: user?.id || '',
            });
            if (linkRes.data?.success || linkRes.data?.skipped) {
              await refreshOrders();
            } else {
              const ok = await markPurchaseOrderReceivedFromInvoiceNumber(
                orderNoRef,
                resolvedSupplierId,
                user?.id || '',
              );
              if (ok) await refreshOrders();
            }
          } catch (poErr) {
            console.warn('[PurchaseInvoices] PO link after save:', poErr);
          }
        })();
      }

      const stillNoStock = (posted.stockMovementIds?.length ?? 0) === 0;
      const stillNoPayable = !posted.openItemId;
      const txError = txResult.errors.join('; ');
      toast({
        title: stillNoStock || stillNoPayable
          ? t.purchaseInvoicesUi.transactionEngineFailureTitle
          : t.purchaseInvoicesUi.purchaseInvoiceSavedTitle,
        description: stillNoStock || stillNoPayable
          ? (txError || t.purchaseInvoicesUi.purchaseSavedPartialSync)
          : `${invoice.invoiceNumber} — ${invoice.supplierName} — ${invoice.total.toLocaleString(uiLocale)} ${invoice.currency}`,
        variant: stillNoStock || stillNoPayable ? 'destructive' : undefined,
      });
      if (stillNoStock || stillNoPayable) {
        setSaveError(txError || t.purchaseInvoicesUi.purchaseSavedPartialSync);
      }

      resetCreateFormState();
      clearPurchaseCreateIntent();
      urlCreateAppliedRef.current = false;
      setViewInvoice(invoice);
      setMode('list');
      goToPurchaseListRoute();
    } catch (error: any) {
      console.error('[PurchaseInvoices] Failed to save purchase invoice:', error);
      setSaveError(error?.message || t.purchaseInvoicesUi.notSyncedWithStockSupplier);
      toast({
        title: t.purchaseInvoicesUi.savePurchaseInvoiceErrorTitle,
        description: error?.message || t.purchaseInvoicesUi.notSyncedWithStockSupplier,
        variant: 'destructive',
      });
    } finally {
      savingPurchaseRef.current = false;
      setSavingPurchase(false);
    }
  }, [activeSuppliers, form, lines, journalLines, totals, currentBranch, user, toast, refreshProducts, refreshSuppliers, freightAllocations, totalLandingCosts, freightSourceAccount, freightSourceName, freightCost, freightOtherCosts, goToPurchaseListRoute, refreshOrders, savingPurchase, branches, invoices, t, resetCreateFormState, loadInvoiceList, ensurePurchaseAccountingPosted, broadcastPurchaseAccountingSync]);

  // ═══════════════ RENDER ═══════════════


  // ─── LIST MODE ───
  if (mode === 'list') {
    const filteredOrders = orders.filter(order =>
      (order.orderNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.supplierName || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const invoiceTotals = {
      count: filtered.length,
      subtotal: filtered.reduce((s, i) => s + (i.subtotal || 0), 0),
      iva: filtered.reduce((s, i) => s + (i.ivaTotal || 0), 0),
      total: filtered.reduce((s, i) => s + (i.total || 0), 0),
    };

    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{t.purchaseInvoicesUi.listTitle}</h1>
              <p className="text-sm text-muted-foreground">{t.purchaseInvoicesUi.listSubtitle}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {listTab === 'encomendas' && (
              <Button variant="outline" className="gap-2" onClick={() => {
                setPoForm({ supplierId: '', branchId: currentBranch?.id || '', notes: '', expectedDeliveryDate: '', items: [] });
                setPoNewItem({ productId: '', quantity: 1, unitCost: 0 });
                setPoCreateOpen(true);
              }}>
                <Plus className="h-4 w-4" /> {t.purchaseInvoicesUi.newOrder}
              </Button>
            )}
            <Button onClick={() => startCreate()} className="gap-2">
              <Plus className="h-4 w-4" /> {t.purchaseInvoicesUi.newPurchaseInvoiceBtn}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => openReturnFromInvoice()}
            >
              <RotateCcw className="h-4 w-4" /> {t.purchaseInvoicesUi.returnAction}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setNewSupplierForm(emptyNewSupplierForm());
                setShowCreateSupplier(true);
              }}
            >
              <Plus className="h-4 w-4" /> {t.purchaseInvoicesUi.addSupplier}
            </Button>
          </div>
        </div>

        {/* Tabs: Faturas / Encomendas */}
        <Tabs value={listTab} onValueChange={v => setListTab(v as any)}>
          <TabsList>
            <TabsTrigger value="faturas" className="gap-1">
              <FileText className="h-4 w-4" /> {t.purchaseInvoicesUi.tabPurchaseInvoices}
              <Badge variant="secondary" className="ml-1 text-[10px]">{invoices.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="encomendas" className="gap-1">
              <ShoppingCart className="h-4 w-4" /> {t.purchaseInvoicesUi.tabOrders}
              <Badge variant="secondary" className="ml-1 text-[10px]">{orders.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="devolucoes" className="gap-1">
              <RotateCcw className="h-4 w-4" /> {t.purchaseInvoicesUi.tabReturns}
              <Badge variant="secondary" className="ml-1 text-[10px]">{returnCount}</Badge>
            </TabsTrigger>
          </TabsList>

          {/* ═══ FATURAS TAB ═══ */}
          <TabsContent value="faturas" className="space-y-3 mt-2">
            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder={t.purchaseInvoicesUi.searchInvoiceOrSupplierPlaceholder} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t.purchaseInvoicesUi.filterSupplier}</Label>
                <Select value={filterSupplier} onValueChange={setFilterSupplier}>
                  <SelectTrigger className="w-48 h-9">
                    <SelectValue placeholder={t.purchaseInvoicesUi.allSuppliersPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t.common.all}</SelectItem>
                    {[...new Set(invoices.map(i => i.supplierName).filter(Boolean))].sort().map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t.purchaseInvoicesUi.filterFrom}</Label>
                <Input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="h-9 w-36" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t.purchaseInvoicesUi.filterTo}</Label>
                <Input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="h-9 w-36" />
              </div>
              {(filterSupplier && filterSupplier !== '__all__' || filterDateFrom || filterDateTo) && (
                <Button variant="ghost" size="sm" onClick={() => { setFilterSupplier('__all__'); setFilterDateFrom(''); setFilterDateTo(''); }}>
                  <X className="h-4 w-4 mr-1" /> {t.purchaseInvoicesUi.clearFilters}
                </Button>
              )}
            </div>

            {/* Summary Bar */}
            <div className="flex gap-4 text-xs items-center px-3 py-2 rounded-md bg-muted/50 border border-border/50">
              <span className="text-muted-foreground font-medium">{t.purchaseInvoicesUi.summaryInvoiceCount.replace('{count}', String(invoiceTotals.count))}</span>
              <div className="h-4 w-px bg-border" />
              <span>Sub Total: <strong className="font-mono text-sm">{invoiceTotals.subtotal.toLocaleString(uiLocale)}</strong></span>
              <span className="text-destructive">IVA: <strong className="font-mono text-sm">{invoiceTotals.iva.toLocaleString(uiLocale)}</strong></span>
              <span>Total: <strong className="font-mono text-sm font-bold">{invoiceTotals.total.toLocaleString(uiLocale)} Kz</strong></span>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px]">
                      <TableHead className="py-2">{t.purchaseInvoicesUi.colInvoiceNo}</TableHead>
                      <TableHead className="py-2">{t.purchaseInvoicesUi.colSupplierInvNo}</TableHead>
                      <TableHead className="py-2">{t.purchaseInvoicesUi.colSupplier}</TableHead>
                      <TableHead className="py-2">{t.purchaseInvoicesUi.colDate}</TableHead>
                      <TableHead className="py-2">{t.purchaseInvoicesUi.colWarehouse}</TableHead>
                      <TableHead className="py-2 text-right">{t.purchaseInvoicesUi.colSubtotal}</TableHead>
                      <TableHead className="py-2 text-right">{t.purchaseInvoicesUi.colVat}</TableHead>
                      <TableHead className="py-2 text-right">{t.purchaseInvoicesUi.colNet}</TableHead>
                      <TableHead className="py-2">{t.purchaseInvoicesUi.colStatus}</TableHead>
                      <TableHead className="py-2 text-right">{t.purchaseInvoicesUi.colActions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(inv => (
                      <TableRow
                        key={inv.id}
                        data-nexor-context="purchase-invoice-row"
                        data-nexor-id={inv.id}
                        className={cn(
                          'cursor-pointer hover:bg-accent/50 h-8 transition-colors duration-100',
                          selectedListInvoiceId === inv.id && 'bg-primary/10 hover:bg-primary/15',
                        )}
                        onClick={() => setSelectedListInvoiceId(inv.id)}
                        onDoubleClick={() => setViewInvoice(inv)}
                      >
                        <TableCell className="font-mono text-[11px] font-medium py-1">{inv.invoiceNumber}</TableCell>
                        <TableCell className="text-[11px] py-1">{inv.supplierInvoiceNo || '—'}</TableCell>
                        <TableCell className="text-[11px] py-1 font-medium">{inv.supplierName}</TableCell>
                        <TableCell className="text-[11px] py-1">{format(new Date(inv.date), 'dd/MM/yyyy')}</TableCell>
                        <TableCell className="text-[11px] py-1">{inv.warehouseName}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] py-1">{inv.subtotal.toLocaleString(uiLocale)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] py-1 text-destructive">{inv.ivaTotal.toLocaleString(uiLocale)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] py-1 font-bold">{inv.total.toLocaleString(uiLocale)}</TableCell>
                        <TableCell className="py-1">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={getPurchaseInvoiceStatusBadge(t, inv.status).variant} className="text-[9px] px-1.5 py-0">
                              {getPurchaseInvoiceStatusBadge(t, inv.status).label}
                            </Badge>
                            {inv.purchaseReturnsStatus === 'partial' && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-700 border-amber-600">
                                {t.purchaseInvoicesUi.returnStatusPartial}
                              </Badge>
                            )}
                            {inv.purchaseReturnsStatus === 'full' && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-green-700 border-green-600">
                                {t.purchaseInvoicesUi.returnStatusFull}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right py-1">
                          <div className="flex gap-0.5 justify-end">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); setViewInvoice(inv); }}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); setViewInvoice(inv); }}>
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            {inv.status === 'confirmed' && inv.purchaseReturnsStatus !== 'full' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-primary"
                                title={t.purchaseInvoicesUi.returnFromInvoice}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openReturnFromInvoice(inv.id);
                                }}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                          <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          {t.purchaseInvoicesUi.emptyNoInvoices}
                          <br />
                          <Button variant="link" size="sm" className="mt-2" onClick={() => startCreate()}>
                            <Plus className="h-4 w-4 mr-1" /> {t.purchaseInvoicesUi.emptyCreateInvoice}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ ENCOMENDAS TAB ═══ */}
          <TabsContent value="encomendas" className="space-y-3 mt-2">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.purchaseInvoicesUi.colOrderNo}</TableHead>
                      <TableHead>{t.purchaseInvoicesUi.colSupplier}</TableHead>
                      <TableHead>{t.purchaseInvoicesUi.colBranch}</TableHead>
                      <TableHead>{t.purchaseInvoicesUi.colDate}</TableHead>
                      <TableHead className="text-right">{t.purchaseInvoicesUi.colTotal}</TableHead>
                      <TableHead>{t.purchaseInvoicesUi.colStatus}</TableHead>
                      <TableHead className="text-right">{t.purchaseInvoicesUi.colActions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map(order => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono">{order.orderNumber}</TableCell>
                        <TableCell>{order.supplierName}</TableCell>
                        <TableCell>{order.branchName}</TableCell>
                        <TableCell>{order.createdAt ? format(new Date(order.createdAt), 'dd/MM/yyyy') : '—'}</TableCell>
                        <TableCell className="text-right font-medium font-mono">{(order.total || 0).toLocaleString(uiLocale)} Kz</TableCell>
                        <TableCell>
                          <Badge variant={getPurchaseOrderStatusBadge(t, order.status).variant}>
                            {getPurchaseOrderStatusBadge(t, order.status).label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPoViewOrder(order)} title={t.purchaseInvoicesUi.titleViewPrint}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPoViewOrder(order)} title={t.purchaseInvoicesUi.titlePrint}>
                              <Printer className="h-4 w-4" />
                            </Button>
                            {purchaseOrderNeedsApproval(order.status) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 text-xs text-foreground hover:bg-muted"
                                title={t.purchaseInvoicesUi.titleApprove}
                                onClick={async () => {
                                  try {
                                    await approveOrder(order.id, user?.id || '');
                                    toast({ title: t.purchaseInvoicesUi.toastOrderApproved, description: order.orderNumber });
                                  } catch (err: unknown) {
                                    const message = err instanceof Error ? err.message : t.purchaseInvoicesUi.approveFailedDesc;
                                    toast({ title: t.purchaseInvoicesUi.approveFailedTitle, description: message, variant: 'destructive' });
                                  }
                                }}
                              >
                                <CheckCircle className="h-3.5 w-3.5" />
                                {t.purchaseInvoicesUi.titleApprove}
                              </Button>
                            )}
                            {['approved', 'partial'].includes(order.status) && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                                setPoReceiveOrder(order);
                                const qtys: Record<string, number> = {};
                                order.items.forEach((item: any) => { qtys[item.productId] = item.quantity; });
                                setPoReceivedQtys(qtys);
                              }} title={t.purchaseInvoicesUi.titleReceiveGoods}>
                                <Package className="h-4 w-4 text-primary" />
                              </Button>
                            )}
                            {(order.status === 'draft' || order.status === 'pending') && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                                cancelOrder(order.id);
                                toast({ title: t.purchaseInvoicesUi.toastOrderCancelled, description: order.orderNumber });
                              }} title={t.purchaseInvoicesUi.titleCancel}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredOrders.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                          <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          {t.purchaseInvoicesUi.emptyNoOrders}
                          <br />
                          <Button variant="link" size="sm" className="mt-2" onClick={() => {
                            setPoForm({ supplierId: '', branchId: currentBranch?.id || '', notes: '', expectedDeliveryDate: '', items: [] });
                            setPoCreateOpen(true);
                          }}>
                            <Plus className="h-4 w-4 mr-1" /> {t.purchaseInvoicesUi.emptyCreateOrder}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ DEVOLUÇÕES TAB ═══ */}
          <TabsContent value="devolucoes" className="space-y-3 mt-2">
            <PurchaseReturnsTab
              openCreateSignal={openReturnCreateSignal}
              preselectInvoiceId={returnPreselectInvoiceId}
              onReturnsChanged={refreshReturnMetrics}
            />
          </TabsContent>
        </Tabs>

        <InvoiceViewDialog
          open={!!viewInvoice}
          onClose={() => setViewInvoice(null)}
          invoice={viewInvoice}
          onCreateReturn={(inv) => openReturnFromInvoice(inv.id)}
        />

        {/* ═══ PO CREATE DIALOG ═══ */}
        <Dialog open={poCreateOpen} onOpenChange={setPoCreateOpen}>
          <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
            <DialogHeader className="px-6 pt-6 pb-2 pr-12">
              <DialogTitle>{t.purchaseInvoicesUi.poNewTitle}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 pb-2 space-y-4 min-h-0">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t.purchaseInvoicesUi.poSupplierStar}</Label>
                  <Select value={poForm.supplierId} onValueChange={v => setPoForm(p => ({ ...p, supplierId: v }))}>
                    <SelectTrigger><SelectValue placeholder={t.purchaseInvoicesUi.selectSupplierPlaceholder} /></SelectTrigger>
                    <SelectContent>
                      {activeSuppliers.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="po-create-branch">{t.purchaseInvoicesUi.poBranchStar}</Label>
                  {branches.filter((b) => b.id != null && String(b.id) !== '').length === 0 ? (
                    <div className="h-10 flex items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                      —
                    </div>
                  ) : (
                    <select
                      id="po-create-branch"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      value={(() => {
                        const valid = branches.filter((b) => b.id != null && String(b.id) !== '');
                        const cur = poForm.branchId ? String(poForm.branchId) : '';
                        return valid.some((b) => String(b.id) === cur) ? cur : String(valid[0]!.id);
                      })()}
                      onChange={(e) => setPoForm((p) => ({ ...p, branchId: e.target.value }))}
                    >
                      {branches
                        .filter((b) => b.id != null && String(b.id) !== '')
                        .map((b) => (
                          <option key={String(b.id)} value={String(b.id)}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                <div>
                  <Label>{t.purchaseInvoicesUi.poExpectedDelivery}</Label>
                  <Input type="date" value={poForm.expectedDeliveryDate} onChange={e => setPoForm(p => ({ ...p, expectedDeliveryDate: e.target.value }))} />
                </div>
                <div>
                  <Label>{t.purchaseInvoicesUi.poNotes}</Label>
                  <Input value={poForm.notes} onChange={e => setPoForm(p => ({ ...p, notes: e.target.value }))} placeholder={t.purchaseInvoicesUi.notesPlaceholder} />
                </div>
              </div>
            </div>

            {/* Add product — outside scroll clip so dropdown receives clicks */}
            <div className="px-6 pb-2 shrink-0">
              <div className="border rounded-lg p-3 space-y-3 overflow-visible relative z-20">
                <Label className="font-medium">{t.purchaseInvoicesUi.poAddProductSection}</Label>
                <div className="grid grid-cols-4 gap-3">
                  <div ref={poProductSearchRef} className="col-span-2 relative">
                    <Input
                      placeholder={t.purchaseInvoicesUi.searchProductByNameSkuOrCode}
                      value={poProductSearch}
                      onChange={e => {
                        setPoProductSearch(e.target.value);
                        setPoProductDropdownOpen(true);
                      }}
                      onFocus={() => setPoProductDropdownOpen(true)}
                    />
                    {poNewItem.productId && !poProductSearch && (
                      <div className="absolute inset-0 flex items-center px-3 pointer-events-none">
                        <span className="text-sm truncate">{products.find(p => p.id === poNewItem.productId)?.name || t.purchaseInvoicesUi.poProductFallback}</span>
                      </div>
                    )}
                    {poProductDropdownOpen && (
                      <div className="absolute z-[200] top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-[220px] overflow-y-auto">
                        {(() => {
                          const q = poProductSearch.toLowerCase();
                          const filtered = products.filter(p =>
                            p.isActive !== false &&
                            (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q))
                          ).slice(0, 80);
                          if (productsLoading && products.length === 0) {
                            return <div className="p-3 text-sm text-muted-foreground text-center">{t.common.loading}</div>;
                          }
                          if (filtered.length === 0) {
                            return <div className="p-3 text-sm text-muted-foreground text-center">{t.purchaseInvoicesUi.poNoProductsFound}</div>;
                          }
                          return filtered.map(p => (
                            <div
                              key={p.id}
                              className="px-3 py-2 text-sm cursor-pointer hover:bg-accent flex justify-between"
                              onClick={() => {
                                setPoNewItem(prev => ({ ...prev, productId: p.id, unitCost: p.cost || 0 }));
                                setPoProductSearch(p.name);
                                setPoProductDropdownOpen(false);
                              }}
                            >
                              <span className="truncate">{p.name}</span>
                              <span className="text-muted-foreground ml-2 shrink-0">{p.sku}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                  <Input type="number" min="1" placeholder={t.purchaseInvoicesUi.poQtyPlaceholder} value={poNewItem.quantity} onChange={e => setPoNewItem(p => ({ ...p, quantity: parseInt(e.target.value) || 1 }))} />
                  <Input type="number" min="0" step="0.01" placeholder={t.purchaseInvoicesUi.poUnitCostPlaceholder} value={poNewItem.unitCost} onChange={e => setPoNewItem(p => ({ ...p, unitCost: parseFloat(e.target.value) || 0 }))} />
                </div>
                <Button variant="secondary" size="sm" onClick={() => {
                  if (!poNewItem.productId || poNewItem.quantity <= 0) return;
                  if (poForm.items.find(i => i.productId === poNewItem.productId)) {
                    toast({ title: t.purchaseInvoicesUi.productAlreadyInList, variant: 'destructive' });
                    return;
                  }
                  setPoForm(p => ({ ...p, items: [...p.items, { ...poNewItem }] }));
                  setPoNewItem({ productId: '', quantity: 1, unitCost: 0 });
                  setPoProductSearch('');
                }}>
                  <Plus className="h-4 w-4 mr-1" /> {t.purchaseInvoicesUi.poAddLineBtn}
                </Button>
              </div>
              </div>

              {/* Items list */}
              <div className="flex-1 overflow-y-auto px-6 pb-4 min-h-0">
              {poForm.items.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.purchaseInvoicesUi.poTableProduct}</TableHead>
                      <TableHead className="text-right">{t.purchaseInvoicesUi.poTableQtyShort}</TableHead>
                      <TableHead className="text-right">{t.purchaseInvoicesUi.poTableUnitCost}</TableHead>
                      <TableHead className="text-right">{t.purchaseInvoicesUi.poTableSubtotalShort}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poForm.items.map(item => {
                      const prod = products.find(p => p.id === item.productId);
                      return (
                        <TableRow key={item.productId}>
                          <TableCell>{prod?.name || item.productId}</TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right font-mono">{item.unitCost.toLocaleString(uiLocale)} Kz</TableCell>
                          <TableCell className="text-right font-mono font-medium">{(item.quantity * item.unitCost).toLocaleString(uiLocale)} Kz</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPoForm(p => ({ ...p, items: p.items.filter(i => i.productId !== item.productId) }))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={3} className="text-right font-medium">{t.purchaseInvoicesUi.poTotalRow}</TableCell>
                      <TableCell className="text-right font-mono font-bold">{poForm.items.reduce((s, i) => s + i.quantity * i.unitCost, 0).toLocaleString(uiLocale)} Kz</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
              </div>
            <DialogFooter className="px-6 py-4 border-t shrink-0">
              <Button variant="outline" onClick={() => setPoCreateOpen(false)}>{t.common.cancel}</Button>
              <Button disabled={!poForm.supplierId || !poForm.branchId || poForm.items.length === 0} onClick={() => {
                const items = poForm.items.map(item => {
                  const prod = products.find(p => p.id === item.productId);
                  const subtotal = item.quantity * item.unitCost;
                  return {
                    productId: item.productId,
                    productName: prod?.name || '',
                    sku: prod?.sku || '',
                    quantity: item.quantity,
                    unitCost: item.unitCost,
                    taxRate: prod?.taxRate ?? DEFAULT_VAT_RATE,
                    subtotal,
                  };
                });
                createOrder(poForm.supplierId, poForm.branchId, items as any, user?.id || '', poForm.notes || undefined, poForm.expectedDeliveryDate || undefined)
                  .then(() => {
                    toast({ title: t.purchaseInvoicesUi.poCreatedToast });
                    setPoCreateOpen(false);
                  })
                  .catch((error) => {
                    toast({
                      title: t.purchaseInvoicesUi.poCreateErrorTitle,
                      description: error?.message || t.purchaseInvoicesUi.poCreateErrorDesc,
                      variant: 'destructive',
                    });
                  });
              }}>
                <Save className="h-4 w-4 mr-1" /> {t.purchaseInvoicesUi.poCreateBtn}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ═══ PO VIEW DIALOG ═══ */}
        <Dialog open={!!poViewOrder} onOpenChange={() => setPoViewOrder(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t.purchaseInvoicesUi.poDialogTitle.replace('{no}', poViewOrder?.orderNumber || '')}</DialogTitle>
            </DialogHeader>
            {poViewOrder && (
              <div className="space-y-4" id="po-print-area">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">{t.purchaseInvoicesUi.poOrderNumberLabel}</span><p className="font-bold font-mono text-lg">{poViewOrder.orderNumber}</p></div>
                  <div><span className="text-muted-foreground">{t.purchaseInvoicesUi.printSupplier}</span><p className="font-medium">{poViewOrder.supplierName}</p></div>
                  <div><span className="text-muted-foreground">{t.purchaseInvoicesUi.printBranch}</span><p className="font-medium">{poViewOrder.branchName}</p></div>
                  <div><span className="text-muted-foreground">{t.purchaseInvoicesUi.printDate}</span><p className="font-medium">{poViewOrder.createdAt ? format(new Date(poViewOrder.createdAt), 'dd/MM/yyyy HH:mm', { locale: pt }) : '—'}</p></div>
                  {poViewOrder.expectedDeliveryDate && (
                    <div><span className="text-muted-foreground">{t.purchaseInvoicesUi.printExpectedDelivery}</span><p className="font-medium">{format(new Date(poViewOrder.expectedDeliveryDate), 'dd/MM/yyyy')}</p></div>
                  )}
                  <div><span className="text-muted-foreground">{t.purchaseInvoicesUi.printStatus}</span>
                    <Badge variant={getPurchaseOrderStatusBadge(t, poViewOrder.status).variant} className="ml-2">
                      {getPurchaseOrderStatusBadge(t, poViewOrder.status).label}
                    </Badge>
                  </div>
                  {poViewOrder.notes && (
                    <div className="col-span-2"><span className="text-muted-foreground">{t.purchaseInvoicesUi.printNotes}</span><p className="font-medium">{poViewOrder.notes}</p></div>
                  )}
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>#</TableHead><TableHead>{t.purchaseInvoicesUi.poTableProduct}</TableHead><TableHead className="text-right">{t.purchaseInvoicesUi.poTableQtyShort}</TableHead><TableHead className="text-right">{t.purchaseInvoicesUi.poTableUnitCost}</TableHead><TableHead className="text-right">{t.purchaseInvoicesUi.poTableSubtotalShort}</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {poViewOrder.items.map((item: any, idx: number) => (
                      <TableRow key={item.productId || idx}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell><p className="font-medium">{item.productName || item.product_name}</p><p className="text-xs text-muted-foreground">{item.sku}</p></TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">{(item.unitCost || item.unit_cost || 0).toLocaleString(uiLocale)} Kz</TableCell>
                        <TableCell className="text-right">{(item.subtotal || 0).toLocaleString(uiLocale)} Kz</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="border-t pt-2 space-y-1 text-sm text-right">
                  <p>{t.purchaseInvoicesUi.poViewSubtotal} <span className="font-mono font-medium">{(poViewOrder.subtotal || 0).toLocaleString(uiLocale)} Kz</span></p>
                  <p>{t.purchaseInvoicesUi.poViewVat} <span className="font-mono font-medium">{(poViewOrder.taxAmount || poViewOrder.tax_amount || 0).toLocaleString(uiLocale)} Kz</span></p>
                  <p className="text-lg font-bold">{t.purchaseInvoicesUi.poViewTotal} {(poViewOrder.total || 0).toLocaleString(uiLocale)} Kz</p>
                </div>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" className="gap-1" onClick={() => {
                const area = document.getElementById('po-print-area');
                if (!area) return;
                const printWindow = window.open('', '_blank', 'width=800,height=600');
                if (!printWindow) return;
                const poStatusLabel = poViewOrder ? getPurchaseOrderStatusBadge(t, poViewOrder.status).label : '';
                printWindow.document.write(`<!DOCTYPE html><html><head><title>${t.purchaseInvoicesUi.poDialogTitle.replace('{no}', String(poViewOrder?.orderNumber || ''))}</title><style>
                  body { font-family: Arial, sans-serif; padding: 30px; color: #111; }
                  h1 { font-size: 22px; margin-bottom: 5px; }
                  h2 { font-size: 14px; color: #666; margin-bottom: 20px; }
                  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; font-size: 13px; }
                  .info .label { color: #888; }
                  .info .value { font-weight: 600; }
                  table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
                  th { background: #f5f5f5; font-weight: 600; }
                  .right { text-align: right; }
                  .totals { text-align: right; font-size: 13px; margin-top: 10px; }
                  .totals .grand { font-size: 16px; font-weight: bold; }
                  @media print { body { padding: 10px; } }
                </style></head><body>
                  <h1>${t.purchaseInvoicesUi.poPrintHeading}</h1>
                  <h2>${poViewOrder?.orderNumber}</h2>
                  <div class="info">
                    <div><span class="label">${t.purchaseInvoicesUi.printSupplier}</span><br/><span class="value">${poViewOrder?.supplierName}</span></div>
                    <div><span class="label">${t.purchaseInvoicesUi.printBranch}</span><br/><span class="value">${poViewOrder?.branchName}</span></div>
                    <div><span class="label">${t.purchaseInvoicesUi.printDate}</span><br/><span class="value">${poViewOrder ? format(new Date(poViewOrder.createdAt), 'dd/MM/yyyy HH:mm') : ''}</span></div>
                    <div><span class="label">${t.purchaseInvoicesUi.printStatus}</span><br/><span class="value">${poStatusLabel}</span></div>
                    ${poViewOrder?.expectedDeliveryDate ? `<div><span class="label">${t.purchaseInvoicesUi.printExpectedDelivery}</span><br/><span class="value">${format(new Date(poViewOrder.expectedDeliveryDate), 'dd/MM/yyyy')}</span></div>` : ''}
                    ${poViewOrder?.notes ? `<div class="col-span-2"><span class="label">${t.purchaseInvoicesUi.printNotes}</span><br/><span class="value">${poViewOrder.notes}</span></div>` : ''}
                  </div>
                  <table>
                    <thead><tr><th>#</th><th>${t.purchaseInvoicesUi.printProduct}</th><th>${t.purchaseInvoicesUi.printSku}</th><th class="right">${t.purchaseInvoicesUi.printQty}</th><th class="right">${t.purchaseInvoicesUi.printUnitCost}</th><th class="right">${t.purchaseInvoicesUi.printSubtotalLine}</th></tr></thead>
                    <tbody>${(poViewOrder?.items || []).map((item: any, i: number) => 
                      `<tr><td>${i+1}</td><td>${item.productName || item.product_name || ''}</td><td>${item.sku || ''}</td><td class="right">${item.quantity}</td><td class="right">${(item.unitCost || item.unit_cost || 0).toLocaleString(uiLocale)} Kz</td><td class="right">${(item.subtotal || 0).toLocaleString(uiLocale)} Kz</td></tr>`
                    ).join('')}</tbody>
                  </table>
                  <div class="totals">
                    <p>${t.purchaseInvoicesUi.poViewSubtotal} ${(poViewOrder?.subtotal || 0).toLocaleString(uiLocale)} Kz</p>
                    <p>${t.purchaseInvoicesUi.poViewVat} ${(poViewOrder?.taxAmount || poViewOrder?.tax_amount || 0).toLocaleString(uiLocale)} Kz</p>
                    <p class="grand">${t.purchaseInvoicesUi.poViewTotal} ${(poViewOrder?.total || 0).toLocaleString(uiLocale)} Kz</p>
                  </div>
                </body></html>`);
                printWindow.document.close();
                setTimeout(() => { printWindow.print(); }, 300);
              }}>
                <Printer className="h-4 w-4" /> {t.purchaseInvoicesUi.poPrint}
              </Button>
              <Button variant="outline" onClick={() => setPoViewOrder(null)}>{t.purchaseInvoicesUi.poClose}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ═══ PO RECEIVE DIALOG ═══ */}
        <Dialog open={!!poReceiveOrder} onOpenChange={() => setPoReceiveOrder(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t.purchaseInvoicesUi.poReceiveTitle.replace('{no}', poReceiveOrder?.orderNumber || '')}</DialogTitle>
            </DialogHeader>
            {poReceiveOrder && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t.purchaseInvoicesUi.poReceiveHint}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.purchaseInvoicesUi.poColProduct}</TableHead>
                      <TableHead className="text-right">{t.purchaseInvoicesUi.poColOrdered}</TableHead>
                      <TableHead className="text-right">{t.purchaseInvoicesUi.poColReceived}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poReceiveOrder.items.map((item: any) => (
                      <TableRow key={item.productId}>
                        <TableCell><p className="font-medium">{item.productName}</p></TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          <Input type="number" min="0" max={item.quantity} className="w-20 ml-auto h-8 text-center"
                            value={poReceivedQtys[item.productId] || 0}
                            onChange={e => setPoReceivedQtys(prev => ({ ...prev, [item.productId]: parseInt(e.target.value) || 0 }))} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPoReceiveOrder(null)}>{t.common.cancel}</Button>
              <Button onClick={() => {
                if (!poReceiveOrder) return;
                receiveOrder(poReceiveOrder.id, user?.id || '', poReceivedQtys);
                toast({
                  title: t.purchaseInvoicesUi.poReceiveToast,
                  description: t.purchaseInvoicesUi.poReceiveToastDesc.replace('{no}', poReceiveOrder.orderNumber),
                });
                setPoReceiveOrder(null);
              }}>
                <CheckCircle className="h-4 w-4 mr-1" /> {t.purchaseInvoicesUi.poReceiveConfirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <CreateSupplierDialog
          open={showCreateSupplier}
          onOpenChange={setShowCreateSupplier}
          form={newSupplierForm}
          setForm={setNewSupplierForm}
          onSave={async () => {
            try {
              await saveNewSupplier();
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t.purchaseInvoicesUi.createSupplierFailed;
              toast({ title: t.common.error, description: message, variant: 'destructive' });
              throw err;
            }
          }}
        />
      </div>
    );
  }

  // ─── CREATE MODE ─── Smart ERP Dense Layout
  return (
    <div
      className={`flex flex-col min-h-0 flex-1 h-full overflow-hidden text-xs animate-fade-in${savingPurchase ? ' pointer-events-none opacity-75' : ''}`}
      aria-busy={savingPurchase}
    >
      {/* ═══ TOP BAR ═══ */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={requestCloseCreate} disabled={savingPurchase}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <button
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/60 transition-colors duration-150"
            onClick={() => void openSupplierPicker()}
          >
            <span className="font-mono text-[11px] text-muted-foreground">{form.supplierAccountCode || '---'}</span>
            <span className="font-semibold text-sm">{form.supplierName || t.purchaseInvoicesUi.selectSupplierInline}</span>
            <Search className="h-3 w-3 text-muted-foreground" />
          </button>
          {/* Supplier balance badge — always visible when supplier selected */}
          {form.supplierName && (
            <div className="flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded bg-accent/40 border border-border/50 transition-all duration-200">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{t.purchaseInvoicesUi.balanceLabel}</span>
              <span className={`font-mono text-sm font-bold ${(form.supplierBalance || 0) > 0 ? 'text-destructive' : (form.supplierBalance || 0) < 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                {(form.supplierBalance || 0).toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[9px] text-muted-foreground">{form.currency || 'KZ'}</span>
            </div>
          )}
          {form.supplierName && supplierPurchaseOrders.length > 0 && (
            <div className="flex items-center gap-2 ml-1 min-w-0">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">
                {t.purchaseInvoicesUi.fillFromOrderLabel}
              </span>
              <Select
                value={fillFromPoId || '__none__'}
                onValueChange={(v) => {
                  if (v === '__none__') {
                    setFillFromPoId('');
                    return;
                  }
                  setFillFromPoId(v);
                  const o = supplierPurchaseOrders.find((x) => x.id === v);
                  if (o) applyLinesFromPurchaseOrder(o);
                }}
              >
                <SelectTrigger className="h-7 min-w-[200px] max-w-[min(100vw-12rem,28rem)] text-xs">
                  <SelectValue placeholder={t.purchaseInvoicesUi.fillFromOrderPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t.purchaseInvoicesUi.fillFromOrderNone}</SelectItem>
                  {supplierPurchaseOrders.map((o) => {
                    const st = getPurchaseOrderStatusBadge(t, o.status);
                    const d = o.createdAt ? format(new Date(o.createdAt), 'dd/MM/yyyy') : '';
                    return (
                      <SelectItem key={o.id} value={o.id}>
                        {o.orderNumber}
                        {d ? ` · ${d}` : ''}
                        {' · '}
                        {st.label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-black tracking-tight text-destructive">{t.purchaseInvoicesUi.editorTitle}</h2>
          {nextFcPreview && (
            <span className="text-xs font-mono text-muted-foreground">{nextFcPreview}</span>
          )}
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={requestCloseCreate} disabled={savingPurchase}>
            <X className="h-3 w-3" /> {t.common.cancel}
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={handleSave}
            disabled={savingPurchase}
            aria-disabled={savingPurchase}
          >
            <Save className="h-3 w-3" /> {savingPurchase ? t.common.saving : t.common.save}
          </Button>
        </div>
      </div>

      {/* ═══ DENSE FORM BAR ═══ */}
      <div className="grid grid-cols-12 gap-x-2 gap-y-0.5 px-3 py-1.5 bg-card border-b border-border shrink-0 items-end">
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">{t.purchaseInvoicesUi.fieldNo}</label>
          <Input value={form.ref || ''} onChange={e => setForm(p => ({ ...p, ref: e.target.value }))} placeholder={t.purchaseInvoicesUi.autoPlaceholder} className="h-7 text-xs px-1.5" />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-muted-foreground leading-none">{t.purchaseInvoicesUi.fieldSupplierInvoiceNo}</label>
          <Input value={(form as any).supplierInvoiceNo || ''} onChange={e => setForm(p => ({ ...p, supplierInvoiceNo: e.target.value }))} className="h-7 text-xs px-1.5" />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">{t.purchaseInvoicesUi.fieldRef}</label>
          <Input value={form.ref2 || ''} onChange={e => setForm(p => ({ ...p, ref2: e.target.value }))} className="h-7 text-xs px-1.5" />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">{t.purchaseInvoicesUi.fieldDate}</label>
          <Input type="date" value={form.date || ''} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className="h-7 text-xs px-1" />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">{t.purchaseInvoicesUi.fieldPayment}</label>
          <Input type="date" value={form.paymentDate || ''} onChange={e => setForm(p => ({ ...p, paymentDate: e.target.value }))} className="h-7 text-xs px-1" />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">{t.purchaseInvoicesUi.fieldCurrency}</label>
          <Select value={form.currency || 'KZ'} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="KZ">KZ</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-muted-foreground leading-none" htmlFor="purchase-create-warehouse">
            {t.purchaseInvoicesUi.fieldWarehouse}
          </label>
          {branches.filter((b) => b.id != null && String(b.id) !== '').length === 0 ? (
            <div className="h-7 flex items-center rounded-md border border-input bg-muted/40 px-2 text-[10px] text-muted-foreground">
              —
            </div>
          ) : (
            <select
              id="purchase-create-warehouse"
              className="flex h-7 w-full rounded-md border border-input bg-background px-2 py-0 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
              value={(() => {
                const withIds = branches.filter((b) => b.id != null && String(b.id) !== '');
                const ids = withIds.map((b) => String(b.id));
                const cur = form.warehouseId != null && form.warehouseId !== '' ? String(form.warehouseId) : '';
                return ids.includes(cur) ? cur : String(withIds[0]!.id);
              })()}
              onChange={(e) => {
                const v = e.target.value;
                const br = branches.find((b) => String(b.id) === v);
                setForm((p) => ({
                  ...p,
                  warehouseId: br?.id ?? v,
                  warehouseName: br?.name ?? '',
                }));
              }}
            >
              {branches
                .filter((b) => b.id != null && String(b.id) !== '')
                .map((b) => (
                  <option key={String(b.id)} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
            </select>
          )}
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">{t.purchaseInvoicesUi.fieldPriceType}</label>
          <Select value={form.priceType} onValueChange={v => setForm(p => ({ ...p, priceType: v as any }))}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="last_price">{t.purchaseInvoicesUi.priceTypeLast}</SelectItem>
              <SelectItem value="average_price">{t.purchaseInvoicesUi.priceTypeAvg}</SelectItem>
              <SelectItem value="manual">{t.purchaseInvoicesUi.priceTypeManual}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 flex items-end gap-1">
          <div className="flex items-center gap-1">
            <Checkbox id="cp" checked={form.changePrice} onCheckedChange={v => setForm(p => ({ ...p, changePrice: !!v }))} className="h-3.5 w-3.5" />
            <label htmlFor="cp" className="text-[10px]">{t.purchaseInvoicesUi.labelChangePrice}</label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox id="pend" checked={form.isPending} onCheckedChange={v => setForm(p => ({ ...p, isPending: !!v }))} className="h-3.5 w-3.5" />
            <label htmlFor="pend" className="text-[10px]">{t.purchaseInvoicesUi.labelPending}</label>
          </div>
        </div>
      </div>

      {/* ═══ ACCOUNTING ROW (compact) ═══ */}
      <div className="flex items-center gap-3 px-3 py-1 bg-muted/30 border-b border-border shrink-0 text-[10px]">
        <span className="text-muted-foreground">{t.purchaseInvoicesUi.labelPurchaseAccount}</span>
        <Input value={form.purchaseAccountCode || ''} onChange={e => setForm(p => ({ ...p, purchaseAccountCode: e.target.value }))} className="h-6 w-16 text-[10px] font-mono px-1" />
        <span className="text-muted-foreground">{t.purchaseInvoicesUi.labelVatAcct}</span>
        <Input value={form.ivaAccountCode || ''} onChange={e => setForm(p => ({ ...p, ivaAccountCode: e.target.value }))} className="h-6 w-16 text-[10px] font-mono px-1" />
        <span className="text-muted-foreground">{t.purchaseInvoicesUi.labelTx}</span>
        <Input value={form.transactionType || ''} onChange={e => setForm(p => ({ ...p, transactionType: e.target.value }))} className="h-6 w-14 text-[10px] font-mono px-1" />
        <span className="text-muted-foreground">{t.purchaseInvoicesUi.labelFx}</span>
        <Input type="number" value={form.currencyRate || 1} onChange={e => setForm(p => ({ ...p, currencyRate: parseFloat(e.target.value) || 1 }))} className="h-6 w-16 text-[10px] font-mono px-1" />
        <span className="text-muted-foreground">{t.purchaseInvoicesUi.labelStampPct}</span>
        <Input type="number" value={form.surchargePercent || 0} onChange={e => setForm(p => ({ ...p, surchargePercent: parseFloat(e.target.value) || 0 }))} className="h-6 w-16 text-[10px] font-mono px-1" />
        <span className="text-muted-foreground">{t.purchaseInvoicesUi.labelOrderNo}</span>
        <Input value={form.orderNo || ''} onChange={e => setForm(p => ({ ...p, orderNo: e.target.value }))} className="h-6 w-20 text-[10px] font-mono px-1" />
        {/* Freight inline */}
        <div className="ml-auto flex items-center gap-2 border-l border-border pl-3">
          <span className="text-amber-600 dark:text-amber-400 font-semibold">🚚 {t.purchaseInvoicesUi.labelFreight}</span>
          <Input type="number" min="0" step="0.01" value={freightCost || ''} onChange={e => setFreightCost(parseFloat(e.target.value) || 0)} className="h-6 w-20 text-[10px] font-mono px-1" placeholder="0" />
          <span className="text-muted-foreground">{t.purchaseInvoicesUi.labelOtherCosts}</span>
          <Input type="number" min="0" step="0.01" value={freightOtherCosts || ''} onChange={e => setFreightOtherCosts(parseFloat(e.target.value) || 0)} className="h-6 w-20 text-[10px] font-mono px-1" placeholder="0" />
          <span className="text-muted-foreground">{t.purchaseInvoicesUi.labelSourceOut}</span>
          <div className="flex items-center gap-0.5">
            <Input value={freightSourceAccount} onChange={e => setFreightSourceAccount(e.target.value)} className="h-6 w-14 text-[10px] font-mono px-1" />
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setFreightPickerOpen(true); setAccountPickerOpen(true); }}>
              <Search className="h-2.5 w-2.5" />
            </Button>
          </div>
          {totalLandingCosts > 0 && (
            <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
              = {totalLandingCosts.toLocaleString(uiLocale)} Kz
            </span>
          )}
        </div>
      </div>

      {/* ═══ TABS: Fatura / Diário ═══ */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <div className="px-3 pt-1 shrink-0">
          <TabsList className="h-7">
            <TabsTrigger value="fatura" className="text-xs h-6 gap-1 px-3"><FileText className="h-3 w-3" /> {t.purchaseInvoicesUi.tabInvoice}</TabsTrigger>
            <TabsTrigger value="diario" className="text-xs h-6 gap-1 px-3"><BookOpen className="h-3 w-3" /> {t.purchaseInvoicesUi.tabJournal}</TabsTrigger>
          </TabsList>
        </div>

        {/* ──── FATURA TAB ──── */}
        <TabsContent value="fatura" className="flex-1 min-h-0 overflow-auto px-3 pb-1 mt-1">
          {/* Save error */}
          {saveError && (
            <Alert variant="destructive" className="mb-2">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t.purchaseInvoicesUi.errorLabel}</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          {/* Inline Editable Grid */}
          <InlineLineGrid
            lines={lines}
            onLinesChange={setLines}
            onOpenProductPicker={handleOpenProductPicker}
            onTabPastLastCell={handleOpenProductPicker}
            focusCell={gridFocusCell}
            onFocusCellConsumed={() => setGridFocusCell(null)}
            onRemoveLine={removeLine}
            freightAllocations={freightAllocations}
            warehouseName={form.warehouseName || currentBranch?.name || ''}
          />

          {/* Freight allocation preview */}
          {totalLandingCosts > 0 && lines.length > 0 && (
            <div className="border rounded px-2 py-1 bg-muted/30 mt-1">
              <p className="text-[10px] font-medium text-muted-foreground mb-0.5">{t.purchaseInvoicesUi.freightAllocation}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0">
                {lines.filter(l => l.productId && l.totalQty > 0).map(l => {
                  const perUnit = freightAllocations[l.productId] || 0;
                  const effectiveCost = l.unitPrice + perUnit;
                  return (
                    <div key={l.productId} className="flex justify-between text-[10px]">
                      <span className="truncate max-w-[120px]">{l.description}</span>
                      <span className="font-mono text-muted-foreground ml-1">
                        {l.unitPrice.toLocaleString(uiLocale)}+{perUnit.toFixed(2)}=<strong className="text-foreground">{effectiveCost.toFixed(2)}</strong>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Extra Note */}
          {form.extraNote !== undefined && form.extraNote !== '' && (
            <div className="mt-1">
              <Textarea
                value={form.extraNote || ''}
                onChange={e => setForm(p => ({ ...p, extraNote: e.target.value }))}
                className="text-xs h-10 resize-none"
                placeholder={t.purchaseInvoicesUi.placeholderExtraNote}
              />
            </div>
          )}
        </TabsContent>

        {/* ──── DIÁRIO TAB ──── */}
        <TabsContent value="diario" className="flex-1 min-h-0 overflow-auto px-3 pb-1 mt-1 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">{t.purchaseInvoicesUi.journalHeading}</h3>
            <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px]" onClick={addJournalLine}>
              <Plus className="h-3 w-3" /> {t.purchaseInvoicesUi.addLine}
            </Button>
          </div>

          <div className="border border-border rounded overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="text-[10px] h-7">
                  <TableHead className="py-1">{t.purchaseInvoicesUi.jColAccount}</TableHead>
                  <TableHead className="py-1">{t.purchaseInvoicesUi.jColName}</TableHead>
                  <TableHead className="py-1">{t.purchaseInvoicesUi.jColNote}</TableHead>
                  <TableHead className="py-1 w-24 text-right">{t.purchaseInvoicesUi.jColDebit}</TableHead>
                  <TableHead className="py-1 w-24 text-right">{t.purchaseInvoicesUi.jColCredit}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {postedJournalPreview.map((line) => (
                  <TableRow key={line.id} className="text-xs h-7">
                    <TableCell className="font-mono py-0.5">{line.accountCode || '—'}</TableCell>
                    <TableCell className="py-0.5">{line.accountName || '—'}</TableCell>
                    <TableCell className="py-0.5 text-muted-foreground">{line.note || '—'}</TableCell>
                    <TableCell className="text-right font-mono py-0.5">{line.debit > 0 ? line.debit.toLocaleString(uiLocale) : '—'}</TableCell>
                    <TableCell className="text-right font-mono py-0.5">{line.credit > 0 ? line.credit.toLocaleString(uiLocale) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end border-t px-3 py-1.5 text-xs bg-muted/30">
              <div className="flex gap-6">
                <span>{t.purchaseInvoicesUi.jDebitTotal} <strong className="font-mono">{postedJournalTotals.debit.toLocaleString(uiLocale)}</strong></span>
                <span>{t.purchaseInvoicesUi.jCreditTotal} <strong className="font-mono">{postedJournalTotals.credit.toLocaleString(uiLocale)}</strong></span>
                <span className={Math.abs(postedJournalTotals.difference) > 0.01 ? 'text-destructive font-bold' : 'text-green-600'}>
                  {t.purchaseInvoicesUi.jDiff} <strong className="font-mono">{postedJournalTotals.difference.toLocaleString(uiLocale)}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Manual journal lines */}
          {journalLines.length > 0 && (
            <div className="border border-border rounded overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="text-[10px] h-7">
                    <TableHead className="py-1">{t.purchaseInvoicesUi.jColAccount}</TableHead>
                    <TableHead className="py-1">{t.purchaseInvoicesUi.jColName}</TableHead>
                    <TableHead className="py-1">{t.purchaseInvoicesUi.jColCurrency}</TableHead>
                    <TableHead className="py-1 min-w-[120px]">{t.purchaseInvoicesUi.jColNote}</TableHead>
                    <TableHead className="py-1 w-24 text-right">{t.purchaseInvoicesUi.jColDebit}</TableHead>
                    <TableHead className="py-1 w-24 text-right">{t.purchaseInvoicesUi.jColCredit}</TableHead>
                    <TableHead className="py-1 w-6" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journalLines.map((jl, idx) => (
                    <TableRow key={jl.id} className="text-xs h-7">
                      <TableCell className="py-0.5">
                        <div className="flex items-center gap-0.5">
                          <Input value={jl.accountCode} onChange={e => updateJournalLine(idx, 'accountCode', e.target.value)} className="h-6 w-20 text-[10px] font-mono px-1" />
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => openAccountPicker(idx)}>
                            <Search className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="py-0.5">
                        <Input value={jl.accountName} onChange={e => updateJournalLine(idx, 'accountName', e.target.value)} className="h-6 text-[10px] px-1" />
                      </TableCell>
                      <TableCell className="py-0.5">
                        <Select value={jl.currency} onValueChange={v => updateJournalLine(idx, 'currency', v)}>
                          <SelectTrigger className="h-6 w-12 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="KZ">KZ</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="py-0.5">
                        <Input value={jl.note} onChange={e => updateJournalLine(idx, 'note', e.target.value)} className="h-6 text-[10px] px-1" placeholder={t.purchaseInvoicesUi.notePlaceholder} />
                      </TableCell>
                      <TableCell className="py-0.5">
                        <Input type="number" value={jl.debit || ''} onChange={e => updateJournalLine(idx, 'debit', parseFloat(e.target.value) || 0)} className="h-6 w-20 text-[10px] text-right font-mono px-1" />
                      </TableCell>
                      <TableCell className="py-0.5">
                        <Input type="number" value={jl.credit || ''} onChange={e => updateJournalLine(idx, 'credit', parseFloat(e.target.value) || 0)} className="h-6 w-20 text-[10px] text-right font-mono px-1" />
                      </TableCell>
                      <TableCell className="py-0.5">
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeJournalLine(idx)}>
                          <Trash2 className="h-2.5 w-2.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ═══ STICKY FOOTER TOTALS BAR ═══ */}
      <div className="flex items-center justify-between px-4 py-2 bg-card border-t-2 border-primary/30 shrink-0 shadow-[0_-2px_8px_-2px_hsl(var(--primary)/0.1)]">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="bg-muted px-2 py-0.5 rounded-full font-medium">
            {lines.length === 1
              ? t.purchaseInvoicesUi.productsOne.replace('{count}', String(lines.length))
              : t.purchaseInvoicesUi.productsOther.replace('{count}', String(lines.length))}
          </span>
          <span>{t.purchaseInvoicesUi.qtyTotal} <strong className="text-foreground font-mono text-sm">{lines.reduce((s, l) => s + l.totalQty, 0)}</strong></span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="text-right transition-all duration-200">
            <span className="text-[9px] text-muted-foreground block leading-none uppercase tracking-wider">{t.purchaseInvoicesUi.footerSubtotal}</span>
            <span className="font-mono font-semibold">{totals.subtotal.toLocaleString(uiLocale)}</span>
          </div>
          {totalLandingCosts > 0 && (
            <div className="text-right animate-fade-in">
              <span className="text-[9px] text-amber-600 dark:text-amber-400 block leading-none uppercase tracking-wider">{t.purchaseInvoicesUi.footerFreight}</span>
              <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{totalLandingCosts.toLocaleString(uiLocale)}</span>
            </div>
          )}
          {(withholdingAmount > 0 || stampAmount > 0) && (
            <div className="text-right">
              <span className="text-[9px] text-muted-foreground block leading-none uppercase tracking-wider">{t.purchaseInvoicesUi.footerBase}</span>
              <span className="font-mono font-semibold">{taxBaseSubtotalPlusFreight.toLocaleString(uiLocale)}</span>
            </div>
          )}
          <div className="text-right">
            <span className="text-[9px] text-destructive block leading-none uppercase tracking-wider">{t.purchaseInvoicesUi.footerVat}</span>
            <span className="font-mono font-semibold text-destructive">{totals.ivaTotal.toLocaleString(uiLocale)}</span>
          </div>
          {withholdingAmount > 0 && (
            <div className="text-right">
              <span className="text-[9px] text-muted-foreground block leading-none uppercase tracking-wider">{t.purchaseInvoicesUi.footerRetention}</span>
              <span className="font-mono font-semibold">{withholdingAmount.toLocaleString(uiLocale)}</span>
            </div>
          )}
          {stampAmount > 0 && (
            <div className="text-right">
              <span className="text-[9px] text-muted-foreground block leading-none uppercase tracking-wider">{t.purchaseInvoicesUi.footerStamp}</span>
              <span className="font-mono font-semibold">{stampAmount.toLocaleString(uiLocale)}</span>
            </div>
          )}
          <div className="text-right border-l-2 border-primary/20 pl-4">
            <span className="text-[9px] text-muted-foreground block leading-none uppercase tracking-wider">{t.purchaseInvoicesUi.footerNet}</span>
            <span className="font-mono font-bold text-lg tracking-tight">{supplierNetPayable.toLocaleString(uiLocale)}</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-semibold">{form.currency || 'KZ'}</span>
        </div>
      </div>

      {/* ═══ DIALOGS ═══ */}
      <SupplierPickerDialog
        open={supplierPickerOpen}
        onClose={() => setSupplierPickerOpen(false)}
        suppliers={activeSuppliers}
        onSelect={handleSelectSupplier}
        onRefresh={refreshSuppliers}
        onCreateNew={() => {
          setSupplierPickerOpen(false);
          setNewSupplierForm(emptyNewSupplierForm());
          setShowCreateSupplier(true);
        }}
      />
      <ProductPickerDialog
        open={productPickerOpen}
        onClose={() => setProductPickerOpen(false)}
        products={products}
        productsLoading={productsLoading}
        onSelect={handleAddProduct}
        onCreateNew={() => setShowCreateProduct(true)}
      />
      <ProductPickerDialog
        open={poProductPickerOpen}
        onClose={() => setPoProductPickerOpen(false)}
        products={products}
        productsLoading={productsLoading}
        onSelect={(p) => {
          setPoNewItem(prev => ({ ...prev, productId: p.id, unitCost: p.cost || 0 }));
          setPoProductPickerOpen(false);
        }}
        onCreateNew={() => setShowCreateProduct(true)}
      />
      <AccountPickerDialog
        open={accountPickerOpen}
        onClose={() => setAccountPickerOpen(false)}
        onSelect={handleAccountSelect}
      />
      <ProductDetailDialog
        open={showCreateProduct}
        onOpenChange={setShowCreateProduct}
        product={null}
        scopeBranchId={productsBranchId}
        defaultSupplierName={String((form as { supplierName?: string }).supplierName || '')}
        onSave={async (newProduct) => {
          const savedProduct = await addProductToStock(newProduct);
          handleAddProduct(savedProduct);
          toast({
            title: t.purchaseInvoicesUi.productCreatedTitle,
            description: t.purchaseInvoicesUi.productCreatedDesc.replace('{name}', savedProduct.name),
          });
        }}
      />

      <CreateSupplierDialog
        open={showCreateSupplier}
        onOpenChange={setShowCreateSupplier}
        form={newSupplierForm}
        setForm={setNewSupplierForm}
        onSave={async () => {
          try {
            await saveNewSupplier();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t.purchaseInvoicesUi.createSupplierFailed;
            toast({ title: t.common.error, description: message, variant: 'destructive' });
            throw err;
          }
        }}
      />

      <AlertDialog open={discardCloseOpen} onOpenChange={setDiscardCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.common.confirmDiscardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.common.confirmDiscardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.keepEditing}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCloseCreate}>{t.common.discardAndClose}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
