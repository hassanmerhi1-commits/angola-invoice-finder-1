import { useState, useMemo, useCallback, useEffect } from 'react';
import { generateId } from '@/lib/utils';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { useProducts, useSuppliers, useAuth } from '@/hooks/useERP';
import { useBranchContext } from '@/contexts/BranchContext';
import { api } from '@/lib/api/client';
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
  savePurchaseInvoice,
  generatePurchaseInvoiceNumber,
} from '@/lib/purchaseInvoiceStorage';
import { processTransaction } from '@/lib/transactionEngine';
import { ensureSupplierAccount } from '@/lib/chartOfAccountsEngine';
import { Supplier, Product } from '@/types/erp';
import { ProductDetailDialog } from '@/components/inventory/ProductDetailDialog';
import { InlineLineGrid } from '@/components/purchase/InlineLineGrid';
import { PurchaseReturnsTab } from '@/components/purchase/PurchaseReturnsTab';
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Search, Plus, Save, X, Trash2, Eye, FileText, BookOpen,
  Package, ArrowLeft, CheckCircle, Printer, AlertCircle,
  ShoppingCart, Filter, Calendar, Download, RotateCcw,
} from 'lucide-react';
import { saveDocument, getDocuments } from '@/lib/documentStorage';
import type { ERPDocument } from '@/types/documents';
import { usePurchaseOrders } from '@/hooks/useERP';

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

async function syncPurchaseInvoiceDocument(invoice: PurchaseInvoice) {
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
      ? t.purchaseInvoicesUi.supplierInvoiceNoPrefix.replace('{no}', invoice.supplierInvoiceNo)
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
  open, onClose, products, onSelect, onCreateNew,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  onSelect: (p: Product) => void;
  onCreateNew: () => void;
}) {
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
            <span>Lista de Produtos</span>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => { onClose(); onCreateNew(); }}>
              <Plus className="h-4 w-4" /> Novo Produto
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
                <TableHead>Produto</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Categoria</TableHead>
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
                    {(p.cost || p.price || 0).toLocaleString('pt-AO')}
                  </TableCell>
                  <TableCell className="text-right">{p.stock}</TableCell>
                  <TableCell className="text-right">{p.taxRate}%</TableCell>
                  <TableCell>{p.unit || 'UN'}</TableCell>
                  <TableCell className="text-xs">{p.category}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nenhum produto encontrado
                    <br />
                    <Button variant="link" size="sm" className="mt-2 gap-1" onClick={() => { onClose(); onCreateNew(); }}>
                      <Plus className="h-4 w-4" /> Criar novo produto
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
          <DialogTitle>Pesquisar Conta</DialogTitle>
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
  landingCosts,
  freightSourceAccount,
  freightSourceName,
  manualLines,
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
  landingCosts: number;
  freightSourceAccount: string;
  freightSourceName: string;
  manualLines: PurchaseInvoiceJournalLine[];
}): PurchaseInvoiceJournalLine[] {
  const postedLines: PurchaseInvoiceJournalLine[] = [];
  let autoIndex = 0;
  const nextId = (suffix: string) => `${documentId}_${suffix}_${++autoIndex}`;

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

  if (landingCosts > 0) {
    postedLines.push({
      id: nextId('freight_debit'),
      accountCode: '6.2.6',
      accountName: t.purchaseInvoicesUi.transportOnPurchases,
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
      accountName: t.purchaseInvoicesUi.deductibleVat,
      currency,
      note: `IVA - FC ${invoiceNumber}`,
      debit: ivaTotal,
      credit: 0,
    });
  }

  postedLines.push({
    id: nextId('supplier'),
    accountCode: supplierAccountCode,
    accountName: supplierName,
    currency,
    note: `FC ${invoiceNumber}`,
    debit: 0,
    credit: supplierTotal,
  });

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
  open, onClose, invoice,
}: {
  open: boolean;
  onClose: () => void;
  invoice: PurchaseInvoice | null;
}) {
  if (!invoice) return null;

  const handlePrint = () => {
    const lines = invoice.lines.map(l => `
      <tr>
        <td style="font-family:monospace;font-size:11px">${l.productCode}</td>
        <td>${l.description}</td>
        <td style="text-align:right">${l.totalQty}</td>
        <td style="text-align:right;font-family:monospace">${l.unitPrice.toLocaleString('pt-AO')}</td>
        <td style="text-align:right">${l.ivaRate}%</td>
        <td style="text-align:right;font-family:monospace;font-weight:bold">${l.totalWithIva.toLocaleString('pt-AO')}</td>
      </tr>
    `).join('');
    const journalRows = invoice.journalLines.map(j => `
      <tr>
        <td style="font-family:monospace">${j.accountCode}</td>
        <td>${j.accountName}</td>
        <td>${j.note}</td>
        <td style="text-align:right;font-family:monospace">${j.debit > 0 ? j.debit.toLocaleString('pt-AO') : '—'}</td>
        <td style="text-align:right;font-family:monospace">${j.credit > 0 ? j.credit.toLocaleString('pt-AO') : '—'}</td>
      </tr>
    `).join('');
    const html = `<html><head><title>FC ${invoice.invoiceNumber}</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px}th{background:#f5f5f5;text-align:left}h2{color:#c2410c}@media print{body{margin:0}}</style>
    </head><body>
      <h2>FATURA DE COMPRA</h2>
      <p>
        <strong>${invoice.invoiceNumber}</strong>
        {invoice.supplierInvoiceNo ? t.purchaseInvoicesUi.supplierInvoiceLabel.replace('{no}', invoice.supplierInvoiceNo) : ''}
      </p>
      <table style="width:auto;border:none;margin-bottom:16px"><tr style="border:none">
        <td style="border:none"><strong>Fornecedor:</strong> ${invoice.supplierName}</td>
        <td style="border:none"><strong>Data:</strong> ${new Date(invoice.date).toLocaleDateString('pt-AO')}</td>
        <td style="border:none"><strong>Armazém:</strong> ${invoice.warehouseName}</td>
        <td style="border:none"><strong>Moeda:</strong> ${invoice.currency}</td>
      </tr></table>
      <table><thead><tr><th>Produto</th><th>Descrição</th><th>Qtd</th><th>Preço</th><th>IVA</th><th>Total</th></tr></thead><tbody>${lines}</tbody></table>
      <div style="text-align:right;margin-top:12px">
        <p>Sub Total: <strong>${invoice.subtotal.toLocaleString('pt-AO')} ${invoice.currency}</strong></p>
        <p style="color:#c2410c">IVA: <strong>${invoice.ivaTotal.toLocaleString('pt-AO')} ${invoice.currency}</strong></p>
        <p style="font-size:16px">Líquido: <strong>${invoice.total.toLocaleString('pt-AO')} ${invoice.currency}</strong></p>
      </div>
      ${invoice.journalLines.length > 0 ? `<h3>Entrada Diário</h3><table><thead><tr><th>Conta</th><th>Nome</th><th>Nota</th><th>Débito</th><th>Crédito</th></tr></thead><tbody>${journalRows}</tbody></table>` : ''}
    </body></html>`;

    // Use iframe to avoid popup blocker
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-orange-600 font-bold">COMPRA</span>
            <span>{invoice.invoiceNumber}</span>
            <Badge variant={getPurchaseInvoiceStatusBadge(t, invoice.status).variant}>
              {getPurchaseInvoiceStatusBadge(t, invoice.status).label}
            </Badge>
            <Button variant="outline" size="sm" className="ml-auto gap-1" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Imprimir
            </Button>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[65vh]">
          <div className="space-y-4 p-1">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Fornecedor:</span> <strong>{invoice.supplierName}</strong></div>
              <div><span className="text-muted-foreground">Data:</span> {format(new Date(invoice.date), 'dd/MM/yyyy')}</div>
              <div><span className="text-muted-foreground">Armazém:</span> {invoice.warehouseName}</div>
              <div><span className="text-muted-foreground">Moeda:</span> {invoice.currency}</div>
              {invoice.supplierInvoiceNo && (
                <div><span className="text-muted-foreground">Nº Fatura Fornecedor:</span> <strong>{invoice.supplierInvoiceNo}</strong></div>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.productCode}</TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right">{l.totalQty}</TableCell>
                    <TableCell className="text-right font-mono">{l.unitPrice.toLocaleString('pt-AO')}</TableCell>
                    <TableCell className="text-right">{l.ivaRate}%</TableCell>
                    <TableCell className="text-right font-mono font-medium">{l.totalWithIva.toLocaleString('pt-AO')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end">
              <div className="space-y-1 text-sm w-64">
                <div className="flex justify-between"><span>Sub Total:</span> <strong className="font-mono">{invoice.subtotal.toLocaleString('pt-AO')}</strong></div>
                <div className="flex justify-between text-orange-600"><span>IVA:</span> <strong className="font-mono">{invoice.ivaTotal.toLocaleString('pt-AO')}</strong></div>
                <div className="flex justify-between text-lg border-t pt-1"><span>Líquido:</span> <strong className="font-mono">{invoice.total.toLocaleString('pt-AO')}</strong></div>
              </div>
            </div>
            {invoice.journalLines.length > 0 && (
              <>
                <h4 className="font-semibold text-sm mt-4">Entrada Diário</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Conta</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Nota</TableHead>
                      <TableHead className="text-right">Débito</TableHead>
                      <TableHead className="text-right">Crédito</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.journalLines.map(j => (
                      <TableRow key={j.id}>
                        <TableCell className="font-mono text-xs">{j.accountCode}</TableCell>
                        <TableCell>{j.accountName}</TableCell>
                        <TableCell className="text-xs">{j.note}</TableCell>
                        <TableCell className="text-right font-mono">{j.debit > 0 ? j.debit.toLocaleString('pt-AO') : '—'}</TableCell>
                        <TableCell className="text-right font-mono">{j.credit > 0 ? j.credit.toLocaleString('pt-AO') : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════
export default function PurchaseInvoices() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { user } = useAuth();
  const { currentBranch, branches } = useBranchContext();
  const { products, addProduct: addProductToStock, refreshProducts } = useProducts(currentBranch?.id);
  const { suppliers, refreshSuppliers, createSupplier } = useSuppliers();
  const { toast } = useToast();
  const navigate = useNavigate();

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
  const [openReturnCreateSignal, setOpenReturnCreateSignal] = useState(0);
  // List mode state
  const [listTab, setListTab] = useState<'faturas' | 'encomendas' | 'devolucoes'>('faturas');
  const [returnCount, setReturnCount] = useState(0);
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  // Form state
  const [form, setForm] = useState<Partial<PurchaseInvoice>>({});
  const [lines, setLines] = useState<PurchaseInvoiceLine[]>([]);
  const [journalLines, setJournalLines] = useState<PurchaseInvoiceJournalLine[]>([]);
  // Freight / Transport cost
  const [freightCost, setFreightCost] = useState(0);
  const [freightOtherCosts, setFreightOtherCosts] = useState(0);
  const [freightSourceAccount, setFreightSourceAccount] = useState('4.1.1'); // default Cash
  const [freightSourceName, setFreightSourceName] = useState('Cash');
  const [freightPickerOpen, setFreightPickerOpen] = useState(false);
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

  // Purchase orders
  const { orders, createOrder, approveOrder, receiveOrder, cancelOrder } = usePurchaseOrders();

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

  // Load invoices — pull from BOTH purchase invoice storage AND document storage
  useEffect(() => {
    const loadAll = async () => {
      // Primary: purchase invoice storage
      const piInvoices = await getPurchaseInvoices(currentBranch?.id);
      
      // Fallback: also load from document storage (fatura_compra type)
      const docInvoices = await getDocuments('fatura_compra', currentBranch?.id);
      
      // Merge: use PI storage as primary, fill gaps from doc storage
      const piIds = new Set(piInvoices.map(i => i.id));
      const docOnlyInvoices: PurchaseInvoice[] = docInvoices
        .filter(d => !piIds.has(d.id))
        .map(d => ({
          id: d.id,
          invoiceNumber: d.documentNumber,
          supplierAccountCode: d.accountCode || '',
          supplierName: d.entityName,
          supplierNif: d.entityNif,
          supplierPhone: d.entityPhone,
          supplierBalance: 0,
          supplierInvoiceNo: d.internalNotes?.replace(t.purchaseInvoicesUi.supplierInvoiceNoStripPrefix, '') || '',
          date: d.issueDate,
          paymentDate: d.dueDate || d.issueDate,
          currency: d.currency === 'AOA' ? 'KZ' : d.currency || 'KZ',
          warehouseId: d.branchId,
          warehouseName: d.branchName,
          priceType: 'last_price' as const,
          purchaseAccountCode: '2.1.1',
          ivaAccountCode: '3.3.1',
          transactionType: 'ALL',
          currencyRate: 1,
          taxRate2: 0,
          surchargePercent: 0,
          changePrice: false,
          isPending: false,
          lines: (d.lines || []).map(l => ({
            id: l.id,
            productId: l.productId || '',
            productCode: l.productSku || '',
            description: l.description,
            quantity: l.quantity,
            packaging: 1,
            unitPrice: l.unitPrice,
            discountPct: l.discount || 0,
            discountPct2: 0,
            totalQty: l.quantity,
            total: l.lineTotal - (l.taxAmount || 0),
            ivaRate: l.taxRate || 0,
            ivaAmount: l.taxAmount || 0,
            totalWithIva: l.lineTotal,
            warehouseId: d.branchId,
            warehouseName: d.branchName,
            currentStock: 0,
            unit: l.unit || 'UN',
          })),
          journalLines: [],
          subtotal: d.subtotal,
          ivaTotal: d.totalTax,
          total: d.total,
          status: d.status === 'cancelled' ? 'cancelled' as const : 'confirmed' as const,
          branchId: d.branchId,
          branchName: d.branchName,
          createdBy: d.createdBy || '',
          createdByName: d.createdByName || '',
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        }));
      
      setInvoices([...piInvoices, ...docOnlyInvoices]);
    };
    loadAll();
  }, [currentBranch?.id]);

  // Load return count for badge
  useEffect(() => {
    const loadReturnCount = async () => {
      try {
        const { getSupplierReturns } = await import('@/lib/supplierReturns');
        const returns = await getSupplierReturns(currentBranch?.id);
        setReturnCount(returns.length);
      } catch { setReturnCount(0); }
    };
    loadReturnCount();
  }, [currentBranch?.id]);

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
  const startCreate = useCallback(() => {
    const now = new Date().toISOString();
    setSaveError(null);
    setForm({
      date: now.split('T')[0],
      paymentDate: now.split('T')[0],
      currency: 'KZ',
      warehouseId: currentBranch?.id || '',
      warehouseName: currentBranch?.name || '',
      priceType: 'last_price',
      purchaseAccountCode: '2.1.1',
      ivaAccountCode: '3.3.1',
      transactionType: 'ALL',
      currencyRate: 1,
      taxRate2: 1000,
      surchargePercent: 0,
      changePrice: true,
      isPending: false,
    });
    setLines([]);
    setJournalLines([]);
    setFreightCost(0);
    setFreightOtherCosts(0);
    setFreightSourceAccount('4.1.1');
    setFreightSourceName('Caixa');
    setActiveTab('fatura');
    setMode('create');
  }, [currentBranch]);

  useEffect(() => {
    if (searchParams.get('mode') !== 'create' || mode === 'create') return;
    startCreate();
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('mode');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, mode, startCreate]);

   // Select supplier — auto-create CoA sub-account under 3.2 Fornecedores
  const handleSelectSupplier = useCallback(async (s: Supplier) => {
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
      ivaRate: p.taxRate || 14,
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
    setLines(prev => [...prev, newLine]);
  }, [form.warehouseId, form.warehouseName, currentBranch]);

  const handleOpenProductPicker = useCallback(() => {
    setProductPickerOpen(true);
  }, []);

  const handleCloseCreate = useCallback(() => {
    setSaveError(null);
    setMode("list");
  }, []);

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

  const postedJournalPreview = useMemo(() => buildPurchaseInvoiceJournalLines({
    documentId: 'preview',
    invoiceNumber: form.supplierInvoiceNo || form.ref || t.purchaseInvoicesUi.previewInvoiceNumber,
    currency: form.currency || 'KZ',
    purchaseAccountCode: form.purchaseAccountCode || '2.1.1',
    ivaAccountCode: form.ivaAccountCode || '3.3.1',
    supplierAccountCode: form.supplierAccountCode || '',
    supplierName: form.supplierName || 'Fornecedor',
    subtotal: totals.subtotal,
    ivaTotal: totals.ivaTotal,
    supplierTotal: totals.total,
    landingCosts: totalLandingCosts,
    freightSourceAccount,
    freightSourceName,
    manualLines: journalLines,
  }), [
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
    totals.ivaTotal,
    totals.subtotal,
    totals.total,
    totalLandingCosts,
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

    // Warehouse is for stock movements; Branch is the current operating branch
    const resolvedWarehouseId = form.warehouseId || currentBranch?.id || '';
    const resolvedWarehouseName = form.warehouseName || currentBranch?.name || '';
    // branchId = current branch context (for document ownership / filtering)
    const resolvedBranchId = currentBranch?.id || resolvedWarehouseId;
    const resolvedBranchName = currentBranch?.name || resolvedWarehouseName;

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

    const now = new Date().toISOString();
    const branchCode = currentBranch?.code || 'SEDE';

    const manualJournalLines = journalLines;

    const invoice: PurchaseInvoice = {
      id: generateId(),
      invoiceNumber: generatePurchaseInvoiceNumber(branchCode),
      supplierAccountCode: resolvedSupplierAccountCode,
      supplierName: matchedSupplier?.name || form.supplierName || '',
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
      taxRate2: form.taxRate2 || 1000,
      orderNo: form.orderNo,
      surchargePercent: form.surchargePercent || 0,
      changePrice: form.changePrice || false,
      isPending: form.isPending || false,
      extraNote: form.extraNote,
      lines,
      journalLines: [],
      subtotal: totals.subtotal,
      ivaTotal: totals.ivaTotal,
      total: totals.total,
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
      supplierTotal: invoice.total,
      landingCosts: totalLandingCosts,
      freightSourceAccount,
      freightSourceName,
      manualLines: manualJournalLines,
    });

    try {
      console.log('[PurchaseInvoices] Calling processTransaction...', {
        type: 'purchase_invoice',
        docId: invoice.id,
        docNumber: invoice.invoiceNumber,
        branchId: invoice.branchId,
        supplierId: resolvedSupplierId,
        supplierAccountCode: resolvedSupplierAccountCode,
        linesCount: invoice.lines.length,
        total: invoice.total,
      });
      // Use central transaction engine for atomic processing
      const txResult = await processTransaction({
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

        // Phase 1: Stock entries — scoped to the selected warehouse
        stockEntries: invoice.lines
          .filter(l => l.productId && l.totalQty > 0)
          .map(l => ({
            productId: l.productId,
            productName: l.description,
            productSku: l.productCode,
            quantity: l.totalQty,
            unitCost: l.unitPrice + (freightAllocations[l.productId] || 0),
            direction: 'IN' as const,
            warehouseId: l.warehouseId || invoice.warehouseId, // BRANCH-SCOPED
          })),

        // Phase 2: Price updates (WAC) — ALWAYS update product cost on purchase invoice
        priceUpdates: invoice.lines
          .filter(l => l.productId && l.totalQty > 0)
          .map(l => ({
            productId: l.productId,
            newUnitCost: l.unitPrice + (freightAllocations[l.productId] || 0),
            quantityReceived: l.totalQty,
            updateAvgCost: true,
          })),

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

      if (!txResult.success) {
        const txError = txResult.errors.join('; ') || t.purchaseInvoicesUi.stockAccountingNotUpdated;
        const description = txError.includes('invalid input syntax for type uuid')
          ? t.purchaseInvoicesUi.invalidIdReopenSupplierWarehouse
          : txError;

        console.error('[PurchaseInvoices] Transaction engine errors:', txResult.errors);
          setSaveError(description);
        toast({
          title: t.purchaseInvoicesUi.transactionEngineFailureTitle,
          description,
          variant: 'destructive',
        });
        return;
      }

      await savePurchaseInvoice(invoice);
      await syncPurchaseInvoiceDocument(invoice);
      await Promise.all([refreshProducts(), refreshSuppliers()]);

      toast({
        title: t.purchaseInvoicesUi.purchaseInvoiceSavedTitle,
        description: `${invoice.invoiceNumber} — ${invoice.supplierName} — ${invoice.total.toLocaleString(uiLocale)} ${invoice.currency}`,
      });

      getPurchaseInvoices(resolvedBranchId).then(setInvoices);
      // Show the saved invoice immediately for printing
      setViewInvoice(invoice);
      setMode('list');
    } catch (error: any) {
      console.error('[PurchaseInvoices] Failed to save purchase invoice:', error);
      setSaveError(error?.message || t.purchaseInvoicesUi.notSyncedWithStockSupplier);
      toast({
        title: t.purchaseInvoicesUi.savePurchaseInvoiceErrorTitle,
        description: error?.message || t.purchaseInvoicesUi.notSyncedWithStockSupplier,
        variant: 'destructive',
      });
    }
  }, [activeSuppliers, form, lines, journalLines, totals, currentBranch, user, toast, refreshProducts, refreshSuppliers, freightAllocations, totalLandingCosts, freightSourceAccount, freightSourceName, freightCost, freightOtherCosts]);

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
              <h1 className="text-2xl font-bold text-foreground">Compras</h1>
              <p className="text-sm text-muted-foreground">Gestão de encomendas e facturas de compra</p>
            </div>
          </div>
          <div className="flex gap-2">
            {listTab === 'encomendas' && (
              <Button variant="outline" className="gap-2" onClick={() => {
                setPoForm({ supplierId: '', branchId: currentBranch?.id || '', notes: '', expectedDeliveryDate: '', items: [] });
                setPoNewItem({ productId: '', quantity: 1, unitCost: 0 });
                setPoCreateOpen(true);
              }}>
                <Plus className="h-4 w-4" /> Nova Encomenda
              </Button>
            )}
            <Button onClick={() => setSearchParams({ mode: "create" })} className="gap-2">
              <Plus className="h-4 w-4" /> Nova Fatura de Compra
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setListTab('devolucoes');
                setOpenReturnCreateSignal(prev => prev + 1);
              }}
            >
              <RotateCcw className="h-4 w-4" /> Devolução
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setNewSupplierForm({ name: '', nif: '', email: '', phone: '', address: '', city: '', country: 'Angola', contactPerson: '', notes: '' });
                setShowCreateSupplier(true);
              }}
            >
              <Plus className="h-4 w-4" /> Gerir Novo Fornecedor
            </Button>
          </div>
        </div>

        {/* Tabs: Faturas / Encomendas */}
        <Tabs value={listTab} onValueChange={v => setListTab(v as any)}>
          <TabsList>
            <TabsTrigger value="faturas" className="gap-1">
              <FileText className="h-4 w-4" /> Faturas de Compra
              <Badge variant="secondary" className="ml-1 text-[10px]">{invoices.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="encomendas" className="gap-1">
              <ShoppingCart className="h-4 w-4" /> Encomendas
              <Badge variant="secondary" className="ml-1 text-[10px]">{orders.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="devolucoes" className="gap-1">
              <RotateCcw className="h-4 w-4" /> Devoluções
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
                <Label className="text-xs text-muted-foreground">Fornecedor</Label>
                <Select value={filterSupplier} onValueChange={setFilterSupplier}>
                  <SelectTrigger className="w-48 h-9">
                    <SelectValue placeholder="Todos fornecedores" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {[...new Set(invoices.map(i => i.supplierName).filter(Boolean))].sort().map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">De</Label>
                <Input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="h-9 w-36" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Até</Label>
                <Input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="h-9 w-36" />
              </div>
              {(filterSupplier && filterSupplier !== '__all__' || filterDateFrom || filterDateTo) && (
                <Button variant="ghost" size="sm" onClick={() => { setFilterSupplier('__all__'); setFilterDateFrom(''); setFilterDateTo(''); }}>
                  <X className="h-4 w-4 mr-1" /> Limpar
                </Button>
              )}
            </div>

            {/* Summary Bar */}
            <div className="flex gap-4 text-xs items-center px-3 py-2 rounded-md bg-muted/50 border border-border/50">
              <span className="text-muted-foreground font-medium">{invoiceTotals.count} facturas</span>
              <div className="h-4 w-px bg-border" />
              <span>Sub Total: <strong className="font-mono text-sm">{invoiceTotals.subtotal.toLocaleString('pt-AO')}</strong></span>
              <span className="text-destructive">IVA: <strong className="font-mono text-sm">{invoiceTotals.iva.toLocaleString('pt-AO')}</strong></span>
              <span>Total: <strong className="font-mono text-sm font-bold">{invoiceTotals.total.toLocaleString('pt-AO')} Kz</strong></span>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px]">
                      <TableHead className="py-2">Nº Fatura</TableHead>
                      <TableHead className="py-2">Nº Fat. Fornecedor</TableHead>
                      <TableHead className="py-2">Fornecedor</TableHead>
                      <TableHead className="py-2">Data</TableHead>
                      <TableHead className="py-2">Armazém</TableHead>
                      <TableHead className="py-2 text-right">Sub Total</TableHead>
                      <TableHead className="py-2 text-right">IVA</TableHead>
                      <TableHead className="py-2 text-right">Líquido</TableHead>
                      <TableHead className="py-2">Estado</TableHead>
                      <TableHead className="py-2 text-right">Acções</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(inv => (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer hover:bg-accent/50 h-8 transition-colors duration-100"
                        onClick={() => setViewInvoice(inv)}
                      >
                        <TableCell className="font-mono text-[11px] font-medium py-1">{inv.invoiceNumber}</TableCell>
                        <TableCell className="text-[11px] py-1">{inv.supplierInvoiceNo || '—'}</TableCell>
                        <TableCell className="text-[11px] py-1 font-medium">{inv.supplierName}</TableCell>
                        <TableCell className="text-[11px] py-1">{format(new Date(inv.date), 'dd/MM/yyyy')}</TableCell>
                        <TableCell className="text-[11px] py-1">{inv.warehouseName}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] py-1">{inv.subtotal.toLocaleString('pt-AO')}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] py-1 text-destructive">{inv.ivaTotal.toLocaleString('pt-AO')}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] py-1 font-bold">{inv.total.toLocaleString('pt-AO')}</TableCell>
                        <TableCell className="py-1">
                          <Badge variant={getPurchaseInvoiceStatusBadge(t, inv.status).variant} className="text-[9px] px-1.5 py-0">
                            {getPurchaseInvoiceStatusBadge(t, inv.status).label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right py-1">
                          <div className="flex gap-0.5 justify-end">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); setViewInvoice(inv); }}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); setViewInvoice(inv); }}>
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                          <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          Nenhuma fatura de compra encontrada
                          <br />
                          <Button variant="link" size="sm" className="mt-2" onClick={() => setSearchParams({ mode: "create" })}>
                            <Plus className="h-4 w-4 mr-1" /> Criar nova fatura de compra
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
                      <TableHead>Nº Encomenda</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead>Filial</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acções</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map(order => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono">{order.orderNumber}</TableCell>
                        <TableCell>{order.supplierName}</TableCell>
                        <TableCell>{order.branchName}</TableCell>
                        <TableCell>{order.createdAt ? format(new Date(order.createdAt), 'dd/MM/yyyy') : '—'}</TableCell>
                        <TableCell className="text-right font-medium font-mono">{(order.total || 0).toLocaleString('pt-AO')} Kz</TableCell>
                        <TableCell>
                          <Badge variant={getPurchaseOrderStatusBadge(t, order.status).variant}>
                            {getPurchaseOrderStatusBadge(t, order.status).label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPoViewOrder(order)} title="Ver / Imprimir">
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPoViewOrder(order)} title="Imprimir">
                              <Printer className="h-4 w-4" />
                            </Button>
                            {order.status === 'pending' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                                approveOrder(order.id, user?.id || '');
                                toast({ title: 'Encomenda aprovada', description: order.orderNumber });
                              }} title="Aprovar">
                                <CheckCircle className="h-4 w-4 text-primary" />
                              </Button>
                            )}
                            {order.status === 'approved' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                                setPoReceiveOrder(order);
                                const qtys: Record<string, number> = {};
                                order.items.forEach((item: any) => { qtys[item.productId] = item.quantity; });
                                setPoReceivedQtys(qtys);
                              }} title="Receber mercadoria">
                                <Package className="h-4 w-4 text-primary" />
                              </Button>
                            )}
                            {(order.status === 'draft' || order.status === 'pending') && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                                cancelOrder(order.id);
                                toast({ title: 'Encomenda cancelada', description: order.orderNumber });
                              }} title="Cancelar">
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
                          Nenhuma encomenda encontrada
                          <br />
                          <Button variant="link" size="sm" className="mt-2" onClick={() => {
                            setPoForm({ supplierId: '', branchId: currentBranch?.id || '', notes: '', expectedDeliveryDate: '', items: [] });
                            setPoCreateOpen(true);
                          }}>
                            <Plus className="h-4 w-4 mr-1" /> Criar nova encomenda
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
            <PurchaseReturnsTab openCreateSignal={openReturnCreateSignal} />
          </TabsContent>
        </Tabs>

        <InvoiceViewDialog open={!!viewInvoice} onClose={() => setViewInvoice(null)} invoice={viewInvoice} />

        {/* ═══ PO CREATE DIALOG ═══ */}
        <Dialog open={poCreateOpen} onOpenChange={setPoCreateOpen}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nova Encomenda de Compra</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Fornecedor *</Label>
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
                  <Label>Filial Destino *</Label>
                  <Select value={poForm.branchId} onValueChange={v => setPoForm(p => ({ ...p, branchId: v }))}>
                    <SelectTrigger><SelectValue placeholder={t.purchaseInvoicesUi.selectBranchPlaceholder} /></SelectTrigger>
                    <SelectContent>
                      {branches.filter(b => b.id).map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Data Prevista de Entrega</Label>
                  <Input type="date" value={poForm.expectedDeliveryDate} onChange={e => setPoForm(p => ({ ...p, expectedDeliveryDate: e.target.value }))} />
                </div>
                <div>
                  <Label>Notas</Label>
                  <Input value={poForm.notes} onChange={e => setPoForm(p => ({ ...p, notes: e.target.value }))} placeholder={t.purchaseInvoicesUi.notesPlaceholder} />
                </div>
              </div>

              {/* Add product - inline search (no nested dialog) */}
              <div className="border rounded-lg p-3 space-y-3">
                <Label className="font-medium">Adicionar Produto</Label>
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-2 relative">
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
                        <span className="text-sm truncate">{products.find(p => p.id === poNewItem.productId)?.name || 'Produto'}</span>
                      </div>
                    )}
                    {poProductDropdownOpen && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-[200px] overflow-y-auto">
                        {(() => {
                          const q = poProductSearch.toLowerCase();
                          const filtered = products.filter(p =>
                            !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q)
                          ).slice(0, 50);
                          if (filtered.length === 0) return <div className="p-3 text-sm text-muted-foreground text-center">Nenhum produto encontrado</div>;
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
                  <Input type="number" min="1" placeholder="Qtd" value={poNewItem.quantity} onChange={e => setPoNewItem(p => ({ ...p, quantity: parseInt(e.target.value) || 1 }))} />
                  <Input type="number" min="0" step="0.01" placeholder="Custo Un." value={poNewItem.unitCost} onChange={e => setPoNewItem(p => ({ ...p, unitCost: parseFloat(e.target.value) || 0 }))} />
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
                  <Plus className="h-4 w-4 mr-1" /> Adicionar
                </Button>
              </div>

              {/* Items list */}
              {poForm.items.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Custo Un.</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
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
                          <TableCell className="text-right font-mono">{item.unitCost.toLocaleString('pt-AO')} Kz</TableCell>
                          <TableCell className="text-right font-mono font-medium">{(item.quantity * item.unitCost).toLocaleString('pt-AO')} Kz</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPoForm(p => ({ ...p, items: p.items.filter(i => i.productId !== item.productId) }))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={3} className="text-right font-medium">Total:</TableCell>
                      <TableCell className="text-right font-mono font-bold">{poForm.items.reduce((s, i) => s + i.quantity * i.unitCost, 0).toLocaleString('pt-AO')} Kz</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPoCreateOpen(false)}>Cancelar</Button>
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
                    taxRate: prod?.taxRate || 14,
                    subtotal,
                  };
                });
                createOrder(poForm.supplierId, poForm.branchId, items as any, user?.id || '', poForm.notes || undefined, poForm.expectedDeliveryDate || undefined)
                  .then(() => {
                    toast({ title: 'Encomenda criada com sucesso' });
                    setPoCreateOpen(false);
                  })
                  .catch((error) => {
                    toast({
                      title: 'Erro ao criar encomenda',
                      description: error?.message || 'Falha ao criar a encomenda.',
                      variant: 'destructive',
                    });
                  });
              }}>
                <Save className="h-4 w-4 mr-1" /> Criar Encomenda
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ═══ PO VIEW DIALOG ═══ */}
        <Dialog open={!!poViewOrder} onOpenChange={() => setPoViewOrder(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Encomenda {poViewOrder?.orderNumber}</DialogTitle>
            </DialogHeader>
            {poViewOrder && (
              <div className="space-y-4" id="po-print-area">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Nº Encomenda:</span><p className="font-bold font-mono text-lg">{poViewOrder.orderNumber}</p></div>
                  <div><span className="text-muted-foreground">Fornecedor:</span><p className="font-medium">{poViewOrder.supplierName}</p></div>
                  <div><span className="text-muted-foreground">Filial:</span><p className="font-medium">{poViewOrder.branchName}</p></div>
                  <div><span className="text-muted-foreground">Data:</span><p className="font-medium">{poViewOrder.createdAt ? format(new Date(poViewOrder.createdAt), 'dd/MM/yyyy HH:mm', { locale: pt }) : '—'}</p></div>
                  {poViewOrder.expectedDeliveryDate && (
                    <div><span className="text-muted-foreground">Entrega Prevista:</span><p className="font-medium">{format(new Date(poViewOrder.expectedDeliveryDate), 'dd/MM/yyyy')}</p></div>
                  )}
                  <div><span className="text-muted-foreground">Estado:</span>
                    <Badge variant={getPurchaseOrderStatusBadge(t, poViewOrder.status).variant} className="ml-2">
                      {getPurchaseOrderStatusBadge(t, poViewOrder.status).label}
                    </Badge>
                  </div>
                  {poViewOrder.notes && (
                    <div className="col-span-2"><span className="text-muted-foreground">Observações:</span><p className="font-medium">{poViewOrder.notes}</p></div>
                  )}
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Produto</TableHead><TableHead className="text-right">Qtd</TableHead><TableHead className="text-right">Custo Unit.</TableHead><TableHead className="text-right">Subtotal</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {poViewOrder.items.map((item: any, idx: number) => (
                      <TableRow key={item.productId || idx}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell><p className="font-medium">{item.productName || item.product_name}</p><p className="text-xs text-muted-foreground">{item.sku}</p></TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">{(item.unitCost || item.unit_cost || 0).toLocaleString('pt-AO')} Kz</TableCell>
                        <TableCell className="text-right">{(item.subtotal || 0).toLocaleString('pt-AO')} Kz</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="border-t pt-2 space-y-1 text-sm text-right">
                  <p>Subtotal: <span className="font-mono font-medium">{(poViewOrder.subtotal || 0).toLocaleString('pt-AO')} Kz</span></p>
                  <p>IVA: <span className="font-mono font-medium">{(poViewOrder.taxAmount || poViewOrder.tax_amount || 0).toLocaleString('pt-AO')} Kz</span></p>
                  <p className="text-lg font-bold">Total: {(poViewOrder.total || 0).toLocaleString('pt-AO')} Kz</p>
                </div>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" className="gap-1" onClick={() => {
                const area = document.getElementById('po-print-area');
                if (!area) return;
                const printWindow = window.open('', '_blank', 'width=800,height=600');
                if (!printWindow) return;
                printWindow.document.write(`<!DOCTYPE html><html><head><title>Encomenda ${poViewOrder?.orderNumber}</title><style>
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
                  <h1>Ordem de Compra</h1>
                  <h2>${poViewOrder?.orderNumber}</h2>
                  <div class="info">
                    <div><span class="label">Fornecedor:</span><br/><span class="value">${poViewOrder?.supplierName}</span></div>
                    <div><span class="label">Filial:</span><br/><span class="value">${poViewOrder?.branchName}</span></div>
                    <div><span class="label">Data:</span><br/><span class="value">${poViewOrder ? format(new Date(poViewOrder.createdAt), 'dd/MM/yyyy HH:mm') : ''}</span></div>
                    <div><span class="label">Estado:</span><br/><span class="value">${poViewOrder?.status === 'pending' ? 'Pendente' : poViewOrder?.status === 'approved' ? 'Aprovado' : poViewOrder?.status === 'received' ? 'Recebido' : poViewOrder?.status}</span></div>
                    ${poViewOrder?.expectedDeliveryDate ? `<div><span class="label">Entrega Prevista:</span><br/><span class="value">${format(new Date(poViewOrder.expectedDeliveryDate), 'dd/MM/yyyy')}</span></div>` : ''}
                    ${poViewOrder?.notes ? `<div class="col-span-2"><span class="label">Observações:</span><br/><span class="value">${poViewOrder.notes}</span></div>` : ''}
                  </div>
                  <table>
                    <thead><tr><th>#</th><th>Produto</th><th>SKU</th><th class="right">Qtd</th><th class="right">Custo Unit.</th><th class="right">Subtotal</th></tr></thead>
                    <tbody>${(poViewOrder?.items || []).map((item: any, i: number) => 
                      `<tr><td>${i+1}</td><td>${item.productName || item.product_name || ''}</td><td>${item.sku || ''}</td><td class="right">${item.quantity}</td><td class="right">${(item.unitCost || item.unit_cost || 0).toLocaleString('pt-AO')} Kz</td><td class="right">${(item.subtotal || 0).toLocaleString('pt-AO')} Kz</td></tr>`
                    ).join('')}</tbody>
                  </table>
                  <div class="totals">
                    <p>Subtotal: ${(poViewOrder?.subtotal || 0).toLocaleString('pt-AO')} Kz</p>
                    <p>IVA: ${(poViewOrder?.taxAmount || poViewOrder?.tax_amount || 0).toLocaleString('pt-AO')} Kz</p>
                    <p class="grand">Total: ${(poViewOrder?.total || 0).toLocaleString('pt-AO')} Kz</p>
                  </div>
                </body></html>`);
                printWindow.document.close();
                setTimeout(() => { printWindow.print(); }, 300);
              }}>
                <Printer className="h-4 w-4" /> Imprimir
              </Button>
              <Button variant="outline" onClick={() => setPoViewOrder(null)}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ═══ PO RECEIVE DIALOG ═══ */}
        <Dialog open={!!poReceiveOrder} onOpenChange={() => setPoReceiveOrder(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Receber Mercadoria — {poReceiveOrder?.orderNumber}</DialogTitle>
            </DialogHeader>
            {poReceiveOrder && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Confirme as quantidades recebidas. O stock será actualizado automaticamente.</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Encomendado</TableHead>
                      <TableHead className="text-right">Recebido</TableHead>
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
              <Button variant="outline" onClick={() => setPoReceiveOrder(null)}>Cancelar</Button>
              <Button onClick={() => {
                if (!poReceiveOrder) return;
                receiveOrder(poReceiveOrder.id, user?.id || '', poReceivedQtys);
                toast({ title: 'Mercadoria recebida', description: `${poReceiveOrder.orderNumber} — stock actualizado` });
                setPoReceiveOrder(null);
              }}>
                <CheckCircle className="h-4 w-4 mr-1" /> Confirmar Recepção
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─── CREATE MODE ─── Smart ERP Dense Layout
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-hidden text-xs animate-fade-in">
      {/* ═══ TOP BAR ═══ */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCloseCreate}>
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
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Saldo</span>
              <span className={`font-mono text-sm font-bold ${(form.supplierBalance || 0) > 0 ? 'text-destructive' : (form.supplierBalance || 0) < 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                {(form.supplierBalance || 0).toLocaleString('pt-AO', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[9px] text-muted-foreground">{form.currency || 'KZ'}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-black tracking-tight text-destructive">COMPRA</h2>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={handleCloseCreate}>
            <X className="h-3 w-3" /> Cancelar
          </Button>
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleSave}>
            <Save className="h-3 w-3" /> Guardar
          </Button>
        </div>
      </div>

      {/* ═══ DENSE FORM BAR ═══ */}
      <div className="grid grid-cols-12 gap-x-2 gap-y-0.5 px-3 py-1.5 bg-card border-b border-border shrink-0 items-end">
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">No</label>
          <Input value={form.ref || ''} onChange={e => setForm(p => ({ ...p, ref: e.target.value }))} placeholder="Auto" className="h-7 text-xs px-1.5" />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-muted-foreground leading-none">Nº Fat. Fornecedor</label>
          <Input value={(form as any).supplierInvoiceNo || ''} onChange={e => setForm(p => ({ ...p, supplierInvoiceNo: e.target.value }))} className="h-7 text-xs px-1.5" />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">Ref</label>
          <Input value={form.ref2 || ''} onChange={e => setForm(p => ({ ...p, ref2: e.target.value }))} className="h-7 text-xs px-1.5" />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">Data</label>
          <Input type="date" value={form.date || ''} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className="h-7 text-xs px-1" />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">Pagamento</label>
          <Input type="date" value={form.paymentDate || ''} onChange={e => setForm(p => ({ ...p, paymentDate: e.target.value }))} className="h-7 text-xs px-1" />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">Moeda</label>
          <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="KZ">KZ</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-muted-foreground leading-none">Armazém</label>
          <Select value={form.warehouseId} onValueChange={v => {
            const br = branches.find(b => b.id === v);
            setForm(p => ({ ...p, warehouseId: v, warehouseName: br?.name || v }));
          }}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {branches.filter(b => b.id).map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground leading-none">Tipo Preço</label>
          <Select value={form.priceType} onValueChange={v => setForm(p => ({ ...p, priceType: v as any }))}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="last_price">Last Price</SelectItem>
              <SelectItem value="average_price">Avg Price</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 flex items-end gap-1">
          <div className="flex items-center gap-1">
            <Checkbox id="cp" checked={form.changePrice} onCheckedChange={v => setForm(p => ({ ...p, changePrice: !!v }))} className="h-3.5 w-3.5" />
            <label htmlFor="cp" className="text-[10px]">Change Price</label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox id="pend" checked={form.isPending} onCheckedChange={v => setForm(p => ({ ...p, isPending: !!v }))} className="h-3.5 w-3.5" />
            <label htmlFor="pend" className="text-[10px]">Pendente</label>
          </div>
        </div>
      </div>

      {/* ═══ ACCOUNTING ROW (compact) ═══ */}
      <div className="flex items-center gap-3 px-3 py-1 bg-muted/30 border-b border-border shrink-0 text-[10px]">
        <span className="text-muted-foreground">Conta Compra:</span>
        <Input value={form.purchaseAccountCode || ''} onChange={e => setForm(p => ({ ...p, purchaseAccountCode: e.target.value }))} className="h-6 w-16 text-[10px] font-mono px-1" />
        <span className="text-muted-foreground">IVA:</span>
        <Input value={form.ivaAccountCode || ''} onChange={e => setForm(p => ({ ...p, ivaAccountCode: e.target.value }))} className="h-6 w-16 text-[10px] font-mono px-1" />
        <span className="text-muted-foreground">TX:</span>
        <Input value={form.transactionType || ''} onChange={e => setForm(p => ({ ...p, transactionType: e.target.value }))} className="h-6 w-14 text-[10px] font-mono px-1" />
        <span className="text-muted-foreground">Câmbio:</span>
        <Input type="number" value={form.currencyRate || 1} onChange={e => setForm(p => ({ ...p, currencyRate: parseFloat(e.target.value) || 1 }))} className="h-6 w-16 text-[10px] font-mono px-1" />
        <span className="text-muted-foreground">Taxa 2:</span>
        <Input type="number" value={form.taxRate2 || 1000} onChange={e => setForm(p => ({ ...p, taxRate2: parseFloat(e.target.value) || 0 }))} className="h-6 w-16 text-[10px] font-mono px-1" />
        <span className="text-muted-foreground">Ordem:</span>
        <Input value={form.orderNo || ''} onChange={e => setForm(p => ({ ...p, orderNo: e.target.value }))} className="h-6 w-20 text-[10px] font-mono px-1" />
        {/* Freight inline */}
        <div className="ml-auto flex items-center gap-2 border-l border-border pl-3">
          <span className="text-amber-600 dark:text-amber-400 font-semibold">🚚 Frete:</span>
          <Input type="number" min="0" step="0.01" value={freightCost || ''} onChange={e => setFreightCost(parseFloat(e.target.value) || 0)} className="h-6 w-20 text-[10px] font-mono px-1" placeholder="0" />
          <span className="text-muted-foreground">Outras:</span>
          <Input type="number" min="0" step="0.01" value={freightOtherCosts || ''} onChange={e => setFreightOtherCosts(parseFloat(e.target.value) || 0)} className="h-6 w-20 text-[10px] font-mono px-1" placeholder="0" />
          <span className="text-muted-foreground">Saída:</span>
          <div className="flex items-center gap-0.5">
            <Input value={freightSourceAccount} onChange={e => setFreightSourceAccount(e.target.value)} className="h-6 w-14 text-[10px] font-mono px-1" />
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setFreightPickerOpen(true); setAccountPickerOpen(true); }}>
              <Search className="h-2.5 w-2.5" />
            </Button>
          </div>
          {totalLandingCosts > 0 && (
            <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
              = {totalLandingCosts.toLocaleString('pt-AO')} Kz
            </span>
          )}
        </div>
      </div>

      {/* ═══ TABS: Fatura / Diário ═══ */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <div className="px-3 pt-1 shrink-0">
          <TabsList className="h-7">
            <TabsTrigger value="fatura" className="text-xs h-6 gap-1 px-3"><FileText className="h-3 w-3" /> Fatura</TabsTrigger>
            <TabsTrigger value="diario" className="text-xs h-6 gap-1 px-3"><BookOpen className="h-3 w-3" /> Diário</TabsTrigger>
          </TabsList>
        </div>

        {/* ──── FATURA TAB ──── */}
        <TabsContent value="fatura" className="flex-1 min-h-0 overflow-auto px-3 pb-1 mt-1">
          {/* Save error */}
          {saveError && (
            <Alert variant="destructive" className="mb-2">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erro</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          {/* Inline Editable Grid */}
          <InlineLineGrid
            lines={lines}
            onLinesChange={setLines}
            onOpenProductPicker={handleOpenProductPicker}
            onRemoveLine={removeLine}
            freightAllocations={freightAllocations}
            warehouseName={form.warehouseName || currentBranch?.name || ''}
          />

          {/* Freight allocation preview */}
          {totalLandingCosts > 0 && lines.length > 0 && (
            <div className="border rounded px-2 py-1 bg-muted/30 mt-1">
              <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Distribuição do frete:</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0">
                {lines.filter(l => l.productId && l.totalQty > 0).map(l => {
                  const perUnit = freightAllocations[l.productId] || 0;
                  const effectiveCost = l.unitPrice + perUnit;
                  return (
                    <div key={l.productId} className="flex justify-between text-[10px]">
                      <span className="truncate max-w-[120px]">{l.description}</span>
                      <span className="font-mono text-muted-foreground ml-1">
                        {l.unitPrice.toLocaleString('pt-AO')}+{perUnit.toFixed(2)}=<strong className="text-foreground">{effectiveCost.toFixed(2)}</strong>
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
                placeholder="Nota extra..."
              />
            </div>
          )}
        </TabsContent>

        {/* ──── DIÁRIO TAB ──── */}
        <TabsContent value="diario" className="flex-1 min-h-0 overflow-auto px-3 pb-1 mt-1 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">Lançamentos automáticos + manuais</h3>
            <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px]" onClick={addJournalLine}>
              <Plus className="h-3 w-3" /> Adicionar
            </Button>
          </div>

          <div className="border border-border rounded overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="text-[10px] h-7">
                  <TableHead className="py-1">Conta</TableHead>
                  <TableHead className="py-1">Nome</TableHead>
                  <TableHead className="py-1">Nota</TableHead>
                  <TableHead className="py-1 w-24 text-right">Débito</TableHead>
                  <TableHead className="py-1 w-24 text-right">Crédito</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {postedJournalPreview.map((line) => (
                  <TableRow key={line.id} className="text-xs h-7">
                    <TableCell className="font-mono py-0.5">{line.accountCode || '—'}</TableCell>
                    <TableCell className="py-0.5">{line.accountName || '—'}</TableCell>
                    <TableCell className="py-0.5 text-muted-foreground">{line.note || '—'}</TableCell>
                    <TableCell className="text-right font-mono py-0.5">{line.debit > 0 ? line.debit.toLocaleString('pt-AO') : '—'}</TableCell>
                    <TableCell className="text-right font-mono py-0.5">{line.credit > 0 ? line.credit.toLocaleString('pt-AO') : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end border-t px-3 py-1.5 text-xs bg-muted/30">
              <div className="flex gap-6">
                <span>Débito: <strong className="font-mono">{postedJournalTotals.debit.toLocaleString('pt-AO')}</strong></span>
                <span>Crédito: <strong className="font-mono">{postedJournalTotals.credit.toLocaleString('pt-AO')}</strong></span>
                <span className={Math.abs(postedJournalTotals.difference) > 0.01 ? 'text-destructive font-bold' : 'text-green-600'}>
                  Dif: <strong className="font-mono">{postedJournalTotals.difference.toLocaleString('pt-AO')}</strong>
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
                    <TableHead className="py-1">Conta</TableHead>
                    <TableHead className="py-1">Nome</TableHead>
                    <TableHead className="py-1">Moeda</TableHead>
                    <TableHead className="py-1 min-w-[120px]">Nota</TableHead>
                    <TableHead className="py-1 w-24 text-right">Débito</TableHead>
                    <TableHead className="py-1 w-24 text-right">Crédito</TableHead>
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
          <span className="bg-muted px-2 py-0.5 rounded-full font-medium">{lines.length} produto{lines.length !== 1 ? 's' : ''}</span>
          <span>Qtd: <strong className="text-foreground font-mono text-sm">{lines.reduce((s, l) => s + l.totalQty, 0)}</strong></span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="text-right transition-all duration-200">
            <span className="text-[9px] text-muted-foreground block leading-none uppercase tracking-wider">Sub Total</span>
            <span className="font-mono font-semibold">{totals.subtotal.toLocaleString('pt-AO')}</span>
          </div>
          {totalLandingCosts > 0 && (
            <div className="text-right animate-fade-in">
              <span className="text-[9px] text-amber-600 dark:text-amber-400 block leading-none uppercase tracking-wider">Frete</span>
              <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{totalLandingCosts.toLocaleString('pt-AO')}</span>
            </div>
          )}
          <div className="text-right">
            <span className="text-[9px] text-destructive block leading-none uppercase tracking-wider">IVA</span>
            <span className="font-mono font-semibold text-destructive">{totals.ivaTotal.toLocaleString('pt-AO')}</span>
          </div>
          <div className="text-right border-l-2 border-primary/20 pl-4">
            <span className="text-[9px] text-muted-foreground block leading-none uppercase tracking-wider">Líquido</span>
            <span className="font-mono font-bold text-lg tracking-tight">{totals.total.toLocaleString('pt-AO')}</span>
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
          setNewSupplierForm({ name: '', nif: '', email: '', phone: '', address: '', city: '', country: 'Angola', contactPerson: '', notes: '' });
          setShowCreateSupplier(true);
        }}
      />
      <ProductPickerDialog
        open={productPickerOpen}
        onClose={() => setProductPickerOpen(false)}
        products={products}
        onSelect={handleAddProduct}
        onCreateNew={() => setShowCreateProduct(true)}
      />
      <ProductPickerDialog
        open={poProductPickerOpen}
        onClose={() => setPoProductPickerOpen(false)}
        products={products}
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
        onSave={async (newProduct) => {
          const savedProduct = await addProductToStock(newProduct);
          handleAddProduct(savedProduct);
          toast({ title: 'Produto criado', description: `${savedProduct.name} adicionado ao stock e à fatura` });
        }}
      />

      {/* Inline Create Supplier Dialog */}
      <Dialog open={showCreateSupplier} onOpenChange={setShowCreateSupplier}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Fornecedor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome *</Label>
              <Input value={newSupplierForm.name} onChange={e => setNewSupplierForm(f => ({ ...f, name: e.target.value }))} placeholder={t.purchaseInvoicesUi.supplierNamePlaceholder} />
            </div>
            <div>
              <Label>NIF</Label>
              <Input value={newSupplierForm.nif} onChange={e => setNewSupplierForm(f => ({ ...f, nif: e.target.value }))} placeholder="NIF" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Email</Label>
                <Input value={newSupplierForm.email} onChange={e => setNewSupplierForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input value={newSupplierForm.phone} onChange={e => setNewSupplierForm(f => ({ ...f, phone: e.target.value }))} placeholder="Telefone" />
              </div>
            </div>
            <div>
              <Label>Morada</Label>
              <Input value={newSupplierForm.address} onChange={e => setNewSupplierForm(f => ({ ...f, address: e.target.value }))} placeholder="Morada" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Cidade</Label>
                <Input value={newSupplierForm.city} onChange={e => setNewSupplierForm(f => ({ ...f, city: e.target.value }))} placeholder="Cidade" />
              </div>
              <div>
                <Label>País</Label>
                <Input value={newSupplierForm.country} onChange={e => setNewSupplierForm(f => ({ ...f, country: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateSupplier(false)}>Cancelar</Button>
            <Button
              disabled={!newSupplierForm.name.trim()}
              onClick={async () => {
                try {
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
                  } as any);
                  setShowCreateSupplier(false);
                  handleSelectSupplier(created);
                  toast({ title: t.purchaseInvoicesUi.supplierCreatedTitle, description: t.purchaseInvoicesUi.supplierCreatedDesc.replace('{name}', created.name) });
                } catch (err: any) {
                  toast({ title: t.common.error, description: err.message || t.purchaseInvoicesUi.createSupplierFailed, variant: 'destructive' });
                }
              }}
            >
              <Save className="h-4 w-4 mr-1" /> Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
