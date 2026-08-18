// NEXOR ERP Document Creation/Edit Dialog
// Used for all document types: Proforma, Fatura, Recibo, Pagamento, etc.

import { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Trash2, Search, Save, Printer, X, Send, Link2, UserRound, UserPlus, Pencil, MapPin, Phone, CalendarDays, Wallet } from 'lucide-react';
import { printDocument } from '@/lib/documentPDF';
import { cn } from '@/lib/utils';
import { DocumentType, DocumentLine, ERPDocument, DOCUMENT_TYPE_CONFIG } from '@/types/documents';
import { calculateLineTotals, calculateDocumentTotals, createDocument, saveDocument, removeLocalDocumentsByNumber, getSaleInvoiceAsDocument } from '@/lib/documentStorage';
import { linkProformaAfterInvoiceConfirm } from '@/lib/linkProformaConversion';
import { useProducts, useAuth, useClients, useSuppliers } from '@/hooks/useERP';
import type { Client, Supplier, OpenItem } from '@/types/erp';
import { effectiveUnitPrice, clientPricing, normalizePriceLevel } from '@/lib/pricing';
import { signedOpenItemBalance, isOpenItemDebit } from '@/lib/openItems';
import { useBranchContext } from '@/contexts/BranchContext';
import { useBranchScope } from '@/hooks/useBranchScope';
import { formatBranchDisplayName } from '@/lib/branchDisplay';
import { ClientFormDialog } from '@/components/clients/ClientFormDialog';
import { digitProductCodeForMatch } from '@/components/inventory/productLineSearch';
import { getCaixas } from '@/lib/accountingStorage';
import type { Caixa } from '@/types/accounting';
import { api } from '@/lib/api/client';
import { isAgtValidated } from '@/lib/agtStatus';
import { DEFAULT_VAT_RATE } from '@/lib/taxUtils';
import { useTranslation } from '@/i18n';
import { isFiscallyImmutable, allowsDueDateOnlyEdit } from '@/lib/fiscalImmutability';
import { useAgtTransmit } from '@/hooks/useAgtTransmit';
import { usePermissions } from '@/hooks/usePermissions';
import { OPEN_ITEMS_CHANGED_EVENT, SALES_CHANGED_EVENT, SUPPLIERS_CHANGED_EVENT } from '@/lib/storage';
import { newClientRequestId } from '@/lib/sync/offlineSales';
import { isFiscalInvoiceNumber, isOfflineSaleStub } from '@/lib/saleOfflineGuard';
import { localISODate, isBeforeToday } from '@/lib/workingDayAccess';
import { validateNIF } from '@/lib/companySettings';
import { Badge } from '@/components/ui/badge';
import {
  fiscalInvoiceTypeLabel,
  fsMaxAmount,
  normalizeCustomerNif,
  resolveSaleInvoiceType,
} from '@/lib/fiscalInvoiceType';

function defaultSalesDueDate(daysAhead = 15): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return localISODate(d);
}

function dueDateForSalePayment(method: string, paymentTermsDays?: number): string {
  if (method === 'credit') {
    const days = Math.trunc(Number(paymentTermsDays) || 0);
    return defaultSalesDueDate(days > 0 ? days : 15);
  }
  return localISODate();
}

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
  const { hasPermission } = usePermissions(user?.id);
  const { currentBranch } = useBranchContext();
  const { branches: scopeBranches, allBranches, canPickBranch } = useBranchScope();
  const branchOptions = canPickBranch && allBranches.length > 0 ? allBranches : scopeBranches;
  const [invoiceBranchId, setInvoiceBranchId] = useState('');
  const invoiceBranch = useMemo(
    () => branchOptions.find((b) => b.id === invoiceBranchId) || currentBranch,
    [branchOptions, invoiceBranchId, currentBranch],
  );
  const { products } = useProducts(invoiceBranch?.id || currentBranch?.id, {
    light: documentType !== 'fatura_venda',
  });
  const { clients, saveClient } = useClients();
  const { suppliers } = useSuppliers();
  const config = DOCUMENT_TYPE_CONFIG[documentType];
  const isPaymentDocument = documentType === 'recibo' || documentType === 'pagamento';
  const typeUi = (t.documentFormUi.types as Record<DocumentType, { full: string; short: string }>)[documentType]
    || { full: config.label, short: config.shortLabel };
  const fiscalLocked = Boolean(editDocument && isFiscallyImmutable(editDocument));
  const dueDateOnlyEdit = Boolean(editDocument && allowsDueDateOnlyEdit(editDocument));
  const formReadOnly = fiscalLocked && !dueDateOnlyEdit;
  const contentLocked = formReadOnly || dueDateOnlyEdit;
  const finalConsumerName = t.pos.finalConsumer;
  const fmt = (n: number, opts?: Intl.NumberFormatOptions) =>
    n.toLocaleString(locale, { minimumFractionDigits: opts?.minimumFractionDigits, maximumFractionDigits: opts?.maximumFractionDigits });
  const savingRef = useRef(false);

  // Form state
  const [entityId, setEntityId] = useState<string>('');
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
  const [entityPickerOpen, setEntityPickerOpen] = useState(false);
  const [priceLevel, setPriceLevel] = useState(1);
  const [activeLineTab, setActiveLineTab] = useState('linhas');
  const { transmit: transmitAgt, transmitting: agtTransmitting } = useAgtTransmit();
  const [agtStatus, setAgtStatus] = useState<string | undefined>();
  const [agtCode, setAgtCode] = useState<string | undefined>();
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [customerFormClient, setCustomerFormClient] = useState<Client | null>(null);
  const [draftCreditLimit, setDraftCreditLimit] = useState(0);
  const [savingCreditLimit, setSavingCreditLimit] = useState(false);
  const [invoiceCaixas, setInvoiceCaixas] = useState<Caixa[]>([]);
  const [invoiceCaixaId, setInvoiceCaixaId] = useState('');
  const [caixasLoading, setCaixasLoading] = useState(false);
  const [walkInMode, setWalkInMode] = useState(false);
  const walkInNameRef = useRef<HTMLInputElement>(null);

  const agtValidated = isAgtValidated(agtStatus);

  // On-account (a prazo) sale invoice: needs a registered client with a positive
  // credit limit; posts amountPaid=0 and the backend creates the AR open item.
  const isCreditInvoice = documentType === 'fatura_venda' && paymentMethod === 'credit';
  const isSalesInvoice = documentType === 'fatura_venda';
  const isSalesWorkspace = isSalesInvoice;
  const requireSavedCustomer = isCreditInvoice && !contentLocked;
  const selectedEntityClient = useMemo(
    () => (config.entityType === 'customer' ? (clients.find((c) => c.id === entityId) ?? null) : null),
    [config.entityType, clients, entityId],
  );

  const fillCustomerContact = (client: Client) => {
    setWalkInMode(false);
    setEntityId(String(client.id));
    setEntityName(client.name);
    setEntityNif(client.nif || '');
    setEntityAddress(client.address || '');
    setEntityPhone(client.phone || '');
    setPriceLevel(normalizePriceLevel(client.defaultPriceLevel ?? 1));
  };

  const applySavedCustomer = (client: Client) => {
    fillCustomerContact(client);
    if (documentType !== 'fatura_venda') return;
    const creditLimit = Number(client.creditLimit) || 0;
    if (creditLimit > 0) {
      setPaymentMethod('credit');
      setAmountPaid(0);
      setDueDate(dueDateForSalePayment('credit', client.paymentTermsDays));
      return;
    }
    setDueDate(dueDateForSalePayment(paymentMethod, client.paymentTermsDays));
  };

  const handleInvoiceBranchChange = (nextId: string) => {
    if (!nextId) return;
    setInvoiceBranchId((prev) => (prev === nextId ? prev : nextId));
    setLines((rows) => (
      rows.every((line) => line.branchId === nextId)
        ? rows
        : rows.map((line) => ({ ...line, branchId: nextId }))
    ));
  };

  const handleInvoiceCaixaChange = (caixaId: string) => {
    setInvoiceCaixaId(caixaId);
    const caixa = invoiceCaixas.find((c) => c.id === caixaId);
    if (caixa?.branchId) handleInvoiceBranchChange(caixa.branchId);
  };

  const caixaOptionLabel = (caixa: Caixa) => {
    if (!canPickBranch) return caixa.name;
    const branch = branchOptions.find((b) => b.id === caixa.branchId);
    const branchLabel = caixa.branchName || (branch ? formatBranchDisplayName(branch) : '');
    return branchLabel ? `${branchLabel} — ${caixa.name}` : caixa.name;
  };

  // Reset form when opening
  useEffect(() => {
    if (open) {
      const source = editDocument || prefillFrom;
      setAgtStatus(editDocument?.agtStatus);
      setAgtCode(editDocument?.agtCode);
      if (source) {
        const sourceClient = clients.find((c) => c.id === source.entityId) as Client | undefined;
        const sourceMethod = source.paymentMethod || 'cash';
        setPaymentMethod(sourceMethod);
        setDueDate(
          documentType === 'fatura_venda' && sourceMethod !== 'credit' && !editDocument
            ? localISODate()
            : (source.dueDate || source.validUntil?.split('T')[0] || ''),
        );
        setValidUntil(source.validUntil || '');
        setNotes(source.notes || '');
        setAmountPaid(source.amountPaid || 0);
        const nextBranchId = source.branchId || currentBranch?.id || '';
        setInvoiceBranchId(nextBranchId);
        setLines(source.lines.map((l) => ({ ...l, branchId: nextBranchId })));
        if (documentType === 'fatura_venda' && sourceClient) {
          fillCustomerContact(sourceClient);
        } else {
          setEntityId(source.entityId || '');
          setEntityName(source.entityName);
          setEntityNif(source.entityNif || '');
          setEntityAddress(source.entityAddress || '');
          setEntityPhone(source.entityPhone || '');
          setPriceLevel(normalizePriceLevel(sourceClient?.defaultPriceLevel ?? 1));
        }
      } else {
        setPriceLevel(1);
        setEntityId('');
        setEntityName('');
        setEntityNif('');
        setEntityAddress('');
        setEntityPhone('');
        setDueDate(documentType === 'fatura_venda' ? localISODate() : '');
        setValidUntil(documentType === 'proforma' ? defaultSalesDueDate() : '');
        setNotes('');
        setPaymentMethod('cash');
        setAmountPaid(0);
        setLines([]);
        setSelectedOpenItemIds(new Set());
        setWalkInMode(false);
      }
      setInvoiceBranchId(source?.branchId || currentBranch?.id || '');
      setInvoiceCaixaId('');
      setEntityPickerOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editDocument, prefillFrom, documentType]);

  // Fresh AGT status from server (list rows may be stale local mirrors).
  useEffect(() => {
    if (!open || !editDocument || documentType !== 'fatura_venda' || !editDocument.documentNumber) return;
    let cancelled = false;
    void api.agt.getDocumentStatus('sale', editDocument.id, editDocument.documentNumber).then((res) => {
      if (cancelled || !res.data) return;
      if (res.data.agtStatus) setAgtStatus(res.data.agtStatus);
      if (res.data.agtCode) setAgtCode(res.data.agtCode);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, editDocument?.id, editDocument?.documentNumber, documentType]);

  useEffect(() => {
    if (!open || documentType !== 'fatura_venda') return;
    const bid = currentBranch?.id || invoiceBranchId;
    if (!canPickBranch && !bid) return;
    let cancelled = false;
    setCaixasLoading(true);
    void getCaixas(bid, currentBranch?.name, {
      ensureIfEmpty: true,
      allBranches: canPickBranch,
    })
      .then((list) => {
        if (cancelled) return;
        setInvoiceCaixas(list);
        setInvoiceCaixaId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev;
          const sameBranch = list.find((c) => c.branchId === bid);
          return sameBranch?.id || list[0]?.id || '';
        });
      })
      .catch(() => {
        if (!cancelled) setInvoiceCaixas([]);
      })
      .finally(() => {
        if (!cancelled) setCaixasLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, documentType, canPickBranch, currentBranch?.id, currentBranch?.name]);

  useEffect(() => {
    if (!open || documentType !== 'fatura_venda' || !invoiceCaixaId) return;
    const caixa = invoiceCaixas.find((c) => c.id === invoiceCaixaId);
    if (caixa?.branchId) handleInvoiceBranchChange(caixa.branchId);
  }, [open, documentType, invoiceCaixaId, invoiceCaixas]);

  useEffect(() => {
    if (!open || !requireSavedCustomer || !selectedEntityClient) return;
    fillCustomerContact(selectedEntityClient);
  }, [open, requireSavedCustomer, selectedEntityClient]);

  const entityDirectory = config.entityType === 'customer' ? clients : suppliers;

  const filteredEntities = useMemo(() => {
    const active = entityDirectory.filter((e) => e.isActive !== false);
    const q = entityName.trim().toLowerCase();
    if (!q) return active.slice(0, 25);
    return active
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.nif && e.nif.toLowerCase().includes(q)) ||
          (e.phone && e.phone.includes(q)),
      )
      .slice(0, 25);
  }, [entityDirectory, entityName]);

  // Pricing context for customer documents: selected client's default price level
  // and signed % adjustment applied automatically to product-linked lines.
  const selectedClientForPricing = useMemo<Client | null>(() => {
    if (config.entityType !== 'customer') return null;
    return (clients.find((c) => c.id === entityId) as Client | undefined) ?? null;
  }, [config.entityType, clients, entityId]);
  const adjustmentPct = clientPricing(selectedClientForPricing).adjustmentPct;
  const showPricingControls = config.entityType === 'customer' && !contentLocked;

  const selectEntity = (entity: Client | Supplier) => {
    setEntityPickerOpen(false);
    setSelectedOpenItemIds(new Set());
    if (config.entityType === 'customer') {
      applySavedCustomer(entity as Client);
      return;
    }
    setEntityId(String(entity.id));
    setEntityName(entity.name);
    setEntityNif(entity.nif || '');
    setEntityAddress(entity.address || '');
    setEntityPhone(entity.phone || '');
  };

  // Reprice product-linked lines when the price level or client adjustment changes.
  useEffect(() => {
    if (config.entityType !== 'customer' || contentLocked) return;
    setLines((prev) => {
      let changed = false;
      const next = prev.map((line) => {
        if (!line.productId) return line;
        const product = products.find((p) => p.id === line.productId);
        if (!product) return line;
        const unitPrice = effectiveUnitPrice(product, priceLevel, adjustmentPct);
        if (unitPrice === line.unitPrice) return line;
        changed = true;
        return calculateLineTotals({ ...line, unitPrice });
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceLevel, adjustmentPct]);

  const [entityOpenItemsLoading, setEntityOpenItemsLoading] = useState(false);
  const [entityOpenItems, setEntityOpenItems] = useState<OpenItem[]>([]);
  const [selectedOpenItemIds, setSelectedOpenItemIds] = useState<Set<string>>(new Set());

  const mapOpenItemRow = (oi: any): OpenItem => ({
    id: String(oi.id ?? ''),
    entityType: (oi.entity_type ?? oi.entityType ?? 'customer') as OpenItem['entityType'],
    entityId: String(oi.entity_id ?? oi.entityId ?? ''),
    documentType: (oi.document_type ?? oi.documentType ?? 'invoice') as OpenItem['documentType'],
    documentId: String(oi.document_id ?? oi.documentId ?? ''),
    documentNumber: String(oi.document_number ?? oi.documentNumber ?? ''),
    documentDate: String(oi.document_date ?? oi.documentDate ?? oi.created_at ?? oi.createdAt ?? ''),
    dueDate: oi.due_date ?? oi.dueDate ?? undefined,
    currency: String(oi.currency ?? 'AOA'),
    originalAmount: Number(oi.original_amount ?? oi.originalAmount ?? 0),
    remainingAmount: Number(oi.remaining_amount ?? oi.remainingAmount ?? 0),
    isDebit: Boolean(oi.is_debit ?? oi.isDebit ?? true),
    status: (oi.status ?? 'open') as OpenItem['status'],
    branchId: String(oi.branch_id ?? oi.branchId ?? ''),
    createdAt: String(oi.created_at ?? oi.createdAt ?? ''),
    clearedAt: oi.cleared_at ?? oi.clearedAt ?? undefined,
  });

  const entityPayableItems = useMemo(
    () => entityOpenItems.filter((oi) => isOpenItemDebit(oi.isDebit)),
    [entityOpenItems],
  );

  const payableItemsKey = entityPayableItems.map((oi) => oi.id).join('|');
  useEffect(() => {
    if (!isPaymentDocument || !entityId || !payableItemsKey) return;
    setSelectedOpenItemIds(new Set(entityPayableItems.map((oi) => oi.id)));
    const total = entityPayableItems.reduce((sum, oi) => sum + signedOpenItemBalance(oi), 0);
    setAmountPaid((prev) => (prev > 0 ? prev : Math.round(total * 100) / 100));
  }, [isPaymentDocument, entityId, payableItemsKey, entityPayableItems]);

  useEffect(() => {
    if (!open) return;
    const showOpenItems =
      (documentType === 'fatura_venda' || documentType === 'recibo' || documentType === 'pagamento')
      && Boolean(entityId);
    if (!showOpenItems) {
      setEntityOpenItems([]);
      setEntityOpenItemsLoading(false);
      return;
    }
    const entType = documentType === 'pagamento' ? 'supplier' : 'customer';
    let cancelled = false;
    setEntityOpenItemsLoading(true);
    void api.payments.openItems(entType, entityId).then((res) => {
      if (cancelled) return;
      const rows = Array.isArray(res.data) ? res.data : [];
      setEntityOpenItems(rows.map(mapOpenItemRow).filter((x) => x.status !== 'cleared'));
    }).catch(() => {
      if (!cancelled) setEntityOpenItems([]);
    }).finally(() => {
      if (!cancelled) setEntityOpenItemsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, documentType, entityId]);

  // Filtered products for search
  const filteredProducts = useMemo(() => {
    if (!productSearch) return products.slice(0, 20);
    const q = productSearch.toLowerCase();
    const qDigits = digitProductCodeForMatch(productSearch);
    return products.filter((p) => {
      if (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q))) {
        return true;
      }
      if (qDigits.length < 6) return false;
      const skuDigits = digitProductCodeForMatch(p.sku);
      const barcodeDigits = digitProductCodeForMatch(p.barcode);
      return skuDigits === qDigits
        || barcodeDigits === qDigits
        || skuDigits.includes(qDigits)
        || barcodeDigits.includes(qDigits);
    }).slice(0, 20);
  }, [products, productSearch]);

  // Totals
  const totals = useMemo(() => calculateDocumentTotals(lines), [lines]);

  // Credit pre-checks for on-account invoices (backend enforces the same rules).
  const creditClientLimit = Number(selectedEntityClient?.creditLimit) || 0;
  const creditClientBalance = Number(selectedEntityClient?.currentBalance) || 0;
  const creditMissingClient = isCreditInvoice && !selectedEntityClient;
  const creditNoLimit = isCreditInvoice && !!selectedEntityClient && creditClientLimit <= 0;
  const creditOverLimit =
    isCreditInvoice
    && !!selectedEntityClient
    && creditClientLimit > 0
    && creditClientBalance + totals.total > creditClientLimit + 0.01;

  useEffect(() => {
    if (!creditNoLimit) return;
    setDraftCreditLimit(Math.max(Math.ceil(totals.total || 0), 1));
  }, [creditNoLimit, selectedEntityClient?.id, totals.total]);

  const applyInvoiceCreditLimit = async () => {
    if (!selectedEntityClient) return;
    const limit = Number(draftCreditLimit);
    if (!(limit > 0)) {
      toast.error(t.documentFormUi.creditLimitInvalid);
      return;
    }
    setSavingCreditLimit(true);
    try {
      await saveClient({ ...selectedEntityClient, creditLimit: limit });
      toast.success(t.documentFormUi.creditLimitSaved);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t.documentFormUi.saveError);
    } finally {
      setSavingCreditLimit(false);
    }
  };

  const openNewCustomerForm = () => {
    setCustomerFormClient(null);
    setEntityPickerOpen(false);
    setCustomerFormOpen(true);
  };

  const openEditCustomerForm = () => {
    if (!selectedEntityClient) return;
    setCustomerFormClient(selectedEntityClient);
    setCustomerFormOpen(true);
  };

  const handlePaymentMethodChange = (next: string) => {
    if (next === 'credit' && !entityId) {
      toast.error(t.documentFormUi.customerRequired);
      return;
    }
    setPaymentMethod(next);
    if (documentType !== 'fatura_venda' || formReadOnly) return;
    setDueDate(dueDateForSalePayment(next, selectedEntityClient?.paymentTermsDays));
    if (next === 'credit') setAmountPaid(0);
  };

  const applyWalkInCustomer = () => {
    setEntityPickerOpen(false);
    setWalkInMode(true);
    setEntityId('');
    setEntityAddress('');
    setEntityPhone('');
    setPriceLevel(1);
    if (paymentMethod === 'credit') handlePaymentMethodChange('cash');
    window.setTimeout(() => walkInNameRef.current?.focus(), 0);
  };

  const assertWalkInIdentity = (): boolean => {
    if (!isSalesInvoice || entityId) return true;
    if (!entityName.trim()) {
      toast.error(t.documentFormUi.walkInNameRequired);
      walkInNameRef.current?.focus();
      return false;
    }
    if (!validateNIF(entityNif)) {
      toast.error(t.documentFormUi.walkInNifRequired);
      return false;
    }
    return true;
  };

  useEffect(() => {
    if (!open || documentType !== 'fatura_venda' || formReadOnly) return;
    if (paymentMethod === 'credit') return;
    const today = localISODate();
    setDueDate((prev) => (prev === today ? prev : today));
  }, [open, documentType, formReadOnly, paymentMethod]);

  const creditLooksLikeCash =
    documentType === 'fatura_venda'
    && paymentMethod !== 'credit'
    && !!entityId
    && !!selectedEntityClient
    && !!dueDate
    && dueDate > localISODate();
  const previewInvoiceType = useMemo(() => {
    if (documentType !== 'fatura_venda') return null;
    return resolveSaleInvoiceType({
      customerNif: normalizeCustomerNif(entityNif),
      paymentMethod,
      total: totals.total,
    });
  }, [documentType, entityNif, paymentMethod, totals.total]);

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
    const unitPrice = product
      ? (config.entityType === 'customer'
          ? effectiveUnitPrice(product, priceLevel, adjustmentPct)
          : product.price || 0)
      : 0;
    const newLine = calculateLineTotals({
      description: product ? product.name : '',
      productId: product?.id,
      productSku: product?.sku,
      quantity: 1,
      unitPrice,
      discount: 0,
      taxRate: product?.taxRate ?? DEFAULT_VAT_RATE,
      branchId: invoiceBranchId || currentBranch?.id,
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

  const buildDocumentForPrint = (): ERPDocument | null => {
    if (lines.length === 0) return null;

    const now = new Date();
    const today = localISODate(now);
    const time = now.toTimeString().slice(0, 8);
    const base = editDocument ?? prefillFrom;
    const prefix = DOCUMENT_TYPE_CONFIG[documentType].prefix;
    const draftNumber = `${prefix}-${invoiceBranch?.code || currentBranch?.code || 'SEDE'}-${today.replace(/-/g, '')}-DRAFT`;

    let issueDate = base?.issueDate ?? today;
    if (isBeforeToday(issueDate) && !hasPermission('backdate_post')) {
      issueDate = today;
    }

    return {
      ...(base ?? {}),
      id: base?.id ?? `print-draft-${Date.now()}`,
      documentType,
      documentNumber: base?.documentNumber ?? draftNumber,
      branchId: invoiceBranch?.id || currentBranch?.id || '',
      branchName: invoiceBranch?.name || currentBranch?.name || '',
      entityType: config.entityType,
      entityId: base?.entityId,
      entityName: entityName || finalConsumerName,
      entityNif: entityNif || base?.entityNif,
      entityAddress: entityAddress || base?.entityAddress,
      entityPhone: entityPhone || base?.entityPhone,
      entityEmail: base?.entityEmail,
      lines,
      subtotal: totals.subtotal,
      totalDiscount: totals.totalDiscount,
      totalTax: totals.totalTax,
      total: totals.total,
      currency: base?.currency ?? 'AOA',
      paymentMethod: (paymentMethod as ERPDocument['paymentMethod']) ?? base?.paymentMethod,
      amountPaid: isCreditInvoice ? 0 : (config.requiresPayment ? amountPaid : totals.total),
      amountDue: isCreditInvoice ? totals.total : (config.requiresPayment ? totals.total - amountPaid : 0),
      parentDocumentId: base?.parentDocumentId ?? prefillFrom?.id,
      parentDocumentNumber: base?.parentDocumentNumber ?? prefillFrom?.documentNumber,
      parentDocumentType: base?.parentDocumentType ?? prefillFrom?.documentType,
      childDocuments: base?.childDocuments,
      status: base?.status ?? 'draft',
      issueDate,
      issueTime: base?.issueTime ?? time,
      dueDate: dueDate || base?.dueDate,
      validUntil: validUntil || base?.validUntil,
      notes: notes || base?.notes,
      saftHash: base?.saftHash,
      createdBy: base?.createdBy ?? user?.id ?? '',
      createdByName: base?.createdByName ?? user?.name ?? '',
      createdAt: base?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
  };

  const handlePrint = () => {
    if (requireSavedCustomer && !entityId) {
      toast.error(t.documentFormUi.customerRequired);
      return;
    }
    if (!assertWalkInIdentity()) return;
    const doc = buildDocumentForPrint();
    if (!doc) {
      toast.error(t.documentFormUi.printNeedsLines);
      return;
    }
    void printDocument(doc, { source: 'document_form' })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(message || t.documentFormUi.printError);
      });
  };

  const printConfirmedSaleInvoice = async (doc: ERPDocument) => {
    try {
      let toPrint = doc;
      if (doc.id && !String(doc.id).startsWith('doc_')) {
        const full = await getSaleInvoiceAsDocument(doc.id, {
          [doc.branchId]: doc.branchName || '',
        });
        if (full?.lines?.length) toPrint = full;
      }
      await printDocument(toPrint, { source: 'document_form' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || t.documentFormUi.printError);
    }
  };

  const handleSave = async (status: 'draft' | 'confirmed') => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
    if (requireSavedCustomer && !entityId) {
      toast.error(t.documentFormUi.customerRequired);
      return;
    }
    if (status === 'confirmed' && !assertWalkInIdentity()) return;
    if (
      documentType === 'fatura_venda'
      && status === 'confirmed'
      && paymentMethod === 'cash'
      && !invoiceCaixaId
    ) {
      toast.error(t.documentFormUi.caixaRequired);
      return;
    }
    if (isPaymentDocument) {
      if (!entityId) {
        toast.error(t.paymentsUi.requiredFields);
        return;
      }
      if (!amountPaid || amountPaid <= 0) {
        toast.error(t.paymentsUi.requiredFields);
        return;
      }
      if (status !== 'confirmed') {
        toast.error(t.documentFormUi.paymentConfirmOnly);
        return;
      }
    } else if (lines.length === 0) {
      toast.error(t.documentFormUi.addAtLeastOneLine);
      return;
    }

    const today = localISODate();
    let resolvedIssueDate = editDocument?.issueDate?.slice(0, 10) || prefillFrom?.issueDate?.slice(0, 10) || today;
    if (editDocument && isBeforeToday(editDocument.issueDate) && !dueDateOnlyEdit) {
      if (!hasPermission('edit_historical')) {
        toast.error(t.journalsUi.cannotEditHistorical);
        return;
      }
    }
    if (isBeforeToday(resolvedIssueDate) && !hasPermission('backdate_post')) {
      toast.error(t.documentFormUi.cannotBackdate);
      resolvedIssueDate = today;
    }
    if (!editDocument && !hasPermission('backdate_post')) {
      resolvedIssueDate = today;
    }

      if (editDocument) {
        if (formReadOnly) {
          toast.error(t.documentFormUi.fiscalLockedSaveError);
          return;
        }

        const updated: ERPDocument = {
          ...editDocument,
          entityId: entityId || editDocument.entityId,
          entityName: entityName || finalConsumerName,
          entityNif,
          entityAddress,
          entityPhone,
          lines: dueDateOnlyEdit ? editDocument.lines : lines,
          ...(dueDateOnlyEdit ? {
            subtotal: editDocument.subtotal,
            totalDiscount: editDocument.totalDiscount,
            totalTax: editDocument.totalTax,
            total: editDocument.total,
          } : totals),
          paymentMethod: dueDateOnlyEdit ? editDocument.paymentMethod : (paymentMethod as any),
          amountPaid: dueDateOnlyEdit ? editDocument.amountPaid : (config.requiresPayment ? amountPaid : 0),
          amountDue: dueDateOnlyEdit
            ? editDocument.amountDue
            : (config.requiresPayment ? totals.total - amountPaid : totals.total),
          dueDate,
          validUntil: dueDateOnlyEdit ? editDocument.validUntil : validUntil,
          notes: dueDateOnlyEdit ? editDocument.notes : notes,
          status: editDocument.status,
        };
        await saveDocument(updated);
        if (
          editDocument.documentType === 'fatura_venda' &&
          dueDate &&
          dueDate !== editDocument.dueDate
        ) {
          const patchRes = await api.sales.updateDueDate(editDocument.id, dueDate);
          if (patchRes.error) {
            throw new Error(patchRes.error);
          }
        }
        onSaved?.(updated);
        toast.success(
          dueDateOnlyEdit
            ? t.documentFormUi.dueDateUpdatedToast.replace('{short}', typeUi.short)
            : t.documentFormUi.documentUpdatedToast.replace('{short}', typeUi.short),
        );
      } else {
        // For confirmed fatura_venda, route through the backend transaction engine
        // so stock is decremented and journal entries (including branch Caixa) are created
        if (documentType === 'fatura_venda' && status === 'confirmed') {
          if (isCreditInvoice && !entityId) {
            toast.error(t.documentFormUi.customerRequired);
            return;
          }
          if (paymentMethod === 'cash' && !invoiceCaixaId) {
            toast.error(t.documentFormUi.caixaRequired);
            return;
          }
          if (isCreditInvoice) {
            if (creditMissingClient) {
              toast.error(t.checkoutUi.creditRequiresClient);
              return;
            }
            if (creditNoLimit) {
              toast.error(t.checkoutUi.creditNoLimit);
              return;
            }
            if (creditOverLimit) {
              toast.error(
                t.checkoutUi.creditOverLimit
                  .replace('{balance}', creditClientBalance.toLocaleString(locale))
                  .replace('{limit}', creditClientLimit.toLocaleString(locale)),
              );
              return;
            }
          } else if (creditLooksLikeCash) {
            toast.error(t.documentFormUi.creditUseOnAccountPayment);
            return;
          } else if (previewInvoiceType === 'FS' && selectedEntityClient) {
            toast.error(t.documentFormUi.fsNotOnAccount);
            return;
          }
          // Stock availability is validated authoritatively by the backend transaction
          // engine, which is SKU- and warehouse-aware (sums the movement ledger across all
          // branch rows + legacy product.stock). We intentionally do NOT pre-check against
          // the branch-scoped light-list `product.stock` here: that value is 0 for items
          // whose stock lives on a catalog/other-branch row or only in the movement ledger,
          // which produced false "quantity is zero" blocks. Any real shortage is reported by
          // the backend below and surfaced via insufficientStockToCompleteSaleInvoice.
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
            warehouseId: l.branchId || invoiceBranchId,
            branchId: l.branchId || invoiceBranchId,
          }));

          const branchId = invoiceBranch?.id || currentBranch?.id || '';
          const branchCode = invoiceBranch?.code || currentBranch?.code || 'SEDE';

          // Generate invoice number from backend (required for on-account / FT)
          let invoiceNumber = '';
          if (isCreditInvoice) {
            const numResult = await api.sales.generateInvoiceNumber(branchCode, {
              paymentMethod: 'credit',
              total: totals.total,
              customerNif: entityNif || undefined,
            });
            if (numResult.error || !numResult.data?.invoiceNumber) {
              throw new Error(numResult.error || t.documentFormUi.saleServerFailed);
            }
            invoiceNumber = numResult.data.invoiceNumber;
          } else {
            try {
              const numResult = await api.sales.generateInvoiceNumber(branchCode, {
                paymentMethod: paymentMethod || 'cash',
                total: totals.total,
                customerNif: entityNif || undefined,
              });
              invoiceNumber = numResult.data?.invoiceNumber || `FT ${branchCode}/${Date.now()}`;
            } catch {
              invoiceNumber = `FT ${branchCode}/${Date.now()}`;
            }
          }

          const clientRequestId = newClientRequestId();

          const saleResult = await api.sales.create({
            clientRequestId,
            invoiceNumber,
            branchId,
            cashierId: user?.id || '',
            cashierName: user?.name || '',
            items: saleItems,
            subtotal: Math.round(saleItems.reduce((s, i) => s + Number(i.subtotal || 0), 0) * 100) / 100,
            taxAmount: totals.totalTax,
            discount: totals.totalDiscount,
            total: totals.total,
            paymentMethod: paymentMethod || 'cash',
            amountPaid: isCreditInvoice ? 0 : (config.requiresPayment ? amountPaid : totals.total),
            change: config.requiresPayment && !isCreditInvoice ? Math.max(0, amountPaid - totals.total) : 0,
            customerNif: entityNif || undefined,
            customerName: (entityName || finalConsumerName) || undefined,
            clientId: entityId || undefined,
            caixaId: paymentMethod === 'cash' ? invoiceCaixaId || undefined : undefined,
            dueDate: dueDate || undefined,
            parentProformaId: prefillFrom?.documentType === 'proforma' ? prefillFrom.id : undefined,
            parentProformaNumber: prefillFrom?.documentType === 'proforma' ? prefillFrom.documentNumber : undefined,
            salesOrderId: prefillFrom?.documentType === 'sales_order' ? prefillFrom.id : undefined,
          });

          if (!saleResult.data) {
            const saleError = saleResult.error || t.documentFormUi.saleServerFailed;
            if (saleError.includes('chk_products_stock_nonneg') || saleError.toLowerCase().includes('stock insuficiente')) {
              throw new Error(t.documentFormUi.insufficientStockToCompleteSaleInvoice);
            }
            throw new Error(saleError);
          }

          const sale = saleResult.data as Record<string, unknown>;
          if (sale.duplicate) {
            throw new Error(t.documentFormUi.saleDuplicateRetry);
          }
          if (isCreditInvoice && isOfflineSaleStub(sale)) {
            throw new Error(t.documentFormUi.saleCreditRequiresServer);
          }
          const saleId = String(sale.id || '');
          const saleInvoiceNumber = String(
            sale.invoice_number || sale.invoiceNumber || invoiceNumber,
          );
          const saleInvoiceType = String(
            sale.invoice_type || sale.invoiceType || previewInvoiceType || '',
          ).toUpperCase();
          const salePaymentMethod = String(
            sale.payment_method || sale.paymentMethod || paymentMethod || '',
          ).toLowerCase();

          if (isCreditInvoice && (!isFiscalInvoiceNumber(saleInvoiceNumber) || saleInvoiceType === 'FS' || saleInvoiceType === 'FR' || salePaymentMethod !== 'credit')) {
            throw new Error(t.documentFormUi.saleCreditMismatch.replace('{number}', saleInvoiceNumber));
          }

          await removeLocalDocumentsByNumber('fatura_venda', saleInvoiceNumber, saleId);

          // Mirror in erp_documents using the same id as `sales` (required for AGT transmit)
          const doc = await createDocument(
            documentType,
            branchId,
            branchCode,
            invoiceBranch?.name || currentBranch?.name || '',
            user?.id || '',
            user?.name || '',
            {
              id: saleId,
              documentNumber: saleInvoiceNumber,
              entityId,
              entityName: entityName || finalConsumerName,
              entityNif,
              entityAddress,
              entityPhone,
              lines,
              ...totals,
              paymentMethod: paymentMethod as any,
              amountPaid: isCreditInvoice ? 0 : (config.requiresPayment ? amountPaid : totals.total),
              amountDue: isCreditInvoice
                ? totals.total
                : Math.max(0, totals.total - (config.requiresPayment ? amountPaid : totals.total)),
              dueDate,
              notes,
              status: 'confirmed',
              fiscalLocked: true,
              issueDate: resolvedIssueDate,
              parentDocumentId: prefillFrom?.id,
              parentDocumentNumber: prefillFrom?.documentNumber,
              parentDocumentType: prefillFrom?.documentType,
            }
          );
          if (prefillFrom?.documentType === 'proforma') {
            await linkProformaAfterInvoiceConfirm(prefillFrom, doc);
          }
          onSaved?.(doc);
          if (isCreditInvoice && salePaymentMethod === 'credit' && saleInvoiceType === 'FT') {
            toast.success(
              t.documentFormUi.documentCreatedOnAccountToast
                .replace('{number}', doc.documentNumber),
            );
          } else {
            toast.success(
              t.documentFormUi.documentCreatedWithStockToast
                .replace('{short}', typeUi.short)
                .replace('{number}', doc.documentNumber),
            );
          }
          if (status === 'confirmed') {
            await printConfirmedSaleInvoice(doc);
          }
        } else if (isPaymentDocument && status === 'confirmed') {
          const paymentType = documentType === 'recibo' ? 'receipt' : 'payment';
          const entType = documentType === 'recibo' ? 'customer' : 'supplier';
          const branchId = currentBranch?.id || user?.branchId || '';
          const selected = entityPayableItems.filter((oi) => selectedOpenItemIds.has(oi.id));

          const payRes = await api.payments.create({
            paymentType,
            entityType: entType,
            entityId,
            entityName: entityName || '',
            paymentMethod,
            amount: amountPaid,
            branchId,
            createdBy: user?.id || user?.email || 'user-admin',
            reference: '',
            notes,
            invoiceIds: selected.map((oi) => oi.documentId),
          });

          if (payRes.error || !payRes.data) {
            throw new Error(payRes.error || t.paymentsUi.recordFailed);
          }

          const payRow = payRes.data as Record<string, unknown>;
          const paymentId = String(payRow.id || '');
          const paymentNumber = String(payRow.payment_number || payRow.paymentNumber || '');

          const paymentLine = calculateLineTotals({
            id: `line_${Date.now()}`,
            description: documentType === 'recibo'
              ? `${t.paymentsUi.receipts} — ${entityName}`
              : `${t.paymentsUi.payments} — ${entityName}`,
            quantity: 1,
            unitPrice: amountPaid,
            discount: 0,
            taxRate: 0,
          });

          const doc = await createDocument(
            documentType,
            branchId,
            currentBranch?.code || 'SEDE',
            currentBranch?.name || '',
            user?.id || '',
            user?.name || '',
            {
              id: paymentId || undefined,
              documentNumber: paymentNumber || undefined,
              entityId,
              entityName: entityName || finalConsumerName,
              entityNif,
              entityAddress,
              entityPhone,
              lines: [paymentLine],
              subtotal: amountPaid,
              totalDiscount: 0,
              totalTax: 0,
              total: amountPaid,
              paymentMethod: paymentMethod as ERPDocument['paymentMethod'],
              amountPaid,
              amountDue: 0,
              parentDocumentId: prefillFrom?.id,
              parentDocumentNumber: prefillFrom?.documentNumber,
              parentDocumentType: prefillFrom?.documentType,
              dueDate,
              notes,
              status: 'confirmed',
              issueDate: resolvedIssueDate,
            },
          );

          window.dispatchEvent(new Event(OPEN_ITEMS_CHANGED_EVENT));
          if (entType === 'supplier') {
            window.dispatchEvent(new CustomEvent(SUPPLIERS_CHANGED_EVENT, { detail: {} }));
          }
          onSaved?.(doc);
          toast.success(
            documentType === 'recibo' ? t.paymentsUi.receiptRecorded : t.paymentsUi.paymentRecorded,
          );
        } else {
          // All other document types (proforma, draft, etc.) — save locally
          const doc = await createDocument(
            documentType,
            isSalesWorkspace ? (invoiceBranch?.id || currentBranch?.id || '') : (currentBranch?.id || ''),
            isSalesWorkspace ? (invoiceBranch?.code || currentBranch?.code || 'SEDE') : (currentBranch?.code || 'SEDE'),
            isSalesWorkspace ? (invoiceBranch?.name || currentBranch?.name || '') : (currentBranch?.name || ''),
            user?.id || '',
            user?.name || '',
            {
              entityId,
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
              issueDate: resolvedIssueDate,
            }
          );
          onSaved?.(doc);
          if (documentType === 'proforma') {
            void api.audit.log({
              tableName: 'proformas',
              recordId: doc.id,
              action: 'create',
              description: `Proforma ${doc.documentNumber} criada`,
              metadata: { documentKind: 'OR', documentNumber: doc.documentNumber },
            }).catch(() => {});
          }
          toast.success(
            t.documentFormUi.documentCreatedToast
              .replace('{short}', typeUi.short)
              .replace('{number}', doc.documentNumber),
          );
        }
      }
      onOpenChange(false);
    } catch (error: any) {
      const message = error?.message === 'FISCAL_IMMUTABLE'
        ? t.documentFormUi.fiscalLockedSaveError
        : (error.message || t.documentFormUi.saveError);
      toast.error(message);
    } finally {
      savingRef.current = false;
    }
  };

  const canTransmitAgt = Boolean(
    hasPermission('agt_send')
    && editDocument
    && documentType === 'fatura_venda'
    && fiscalLocked
    && editDocument.status !== 'cancelled',
  );

  const handleTransmitAgt = () => {
    if (!editDocument || agtValidated) return;
    void transmitAgt('sale', editDocument.id, {
      documentNumber: editDocument.documentNumber,
      onSuccess: () => window.dispatchEvent(new Event(SALES_CHANGED_EVENT)),
    }).then((data) => {
      if (data?.agtStatus) setAgtStatus(data.agtStatus);
      if (data?.agtCode) setAgtCode(data.agtCode);
    });
  };

  const renderLineBranchLabel = () => (
    <span className="block max-w-[160px] truncate text-xs text-muted-foreground">
      {formatBranchDisplayName(invoiceBranch)}
    </span>
  );

  const renderInvoiceCaixaSelect = () => {
    const triggerClass = 'h-8 w-full text-sm';
    if (caixasLoading && invoiceCaixas.length === 0) {
      return (
        <div className={cn('flex items-center gap-2 truncate rounded-md border bg-muted/40 px-2', triggerClass)}>
          <Wallet className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-muted-foreground">{t.documentFormUi.caixaLoading}</span>
        </div>
      );
    }
    if (invoiceCaixas.length <= 1) {
      const only = invoiceCaixas[0];
      return (
        <div className={cn('flex items-center gap-2 truncate rounded-md border bg-muted/40 px-2', triggerClass)}>
          <Wallet className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{only ? caixaOptionLabel(only) : t.expensesUi.noCashRegisters}</span>
        </div>
      );
    }
    return (
      <Select value={invoiceCaixaId} onValueChange={handleInvoiceCaixaChange} disabled={contentLocked}>
        <SelectTrigger className={triggerClass}>
          <div className="flex min-w-0 items-center gap-2">
            <Wallet className="h-3.5 w-3.5 shrink-0" />
            <SelectValue placeholder={t.expensesUi.selectCashPlaceholder} />
          </div>
        </SelectTrigger>
        <SelectContent className="z-[80]">
          {invoiceCaixas.map((caixa) => (
            <SelectItem key={caixa.id} value={caixa.id}>
              {caixaOptionLabel(caixa)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        'p-0 [&>button[data-dialog-close]]:hidden',
        isSalesWorkspace
          ? 'flex h-[96vh] max-h-[96vh] w-[98vw] max-w-[98vw] flex-col gap-0 overflow-hidden sm:rounded-xl'
          : 'max-h-[90vh] max-w-5xl overflow-y-auto',
      )}>
        <div className={cn(
          'flex items-center gap-3 border-b',
          isSalesWorkspace ? 'bg-background px-4 py-2' : 'bg-muted/50 px-4 py-2',
        )}>
          <DialogTitle className={cn(
            'min-w-0 flex-1 font-bold',
            isSalesWorkspace ? 'text-lg tracking-tight' : 'min-w-0 flex-1 text-sm',
            config.color,
          )}>
            {editDocument
              ? `${t.documentFormUi.editPrefix} ${typeUi.short} — ${editDocument.documentNumber}`
              : `${t.documentFormUi.newPrefix} ${typeUi.full}`}
            {prefillFrom && (
              <span className="text-muted-foreground font-normal ml-2 text-sm">
                {t.documentFormUi.fromDocument.replace('{number}', prefillFrom.documentNumber)}
              </span>
            )}
          </DialogTitle>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className={cn('gap-1', isSalesWorkspace ? 'h-8 px-3 text-sm' : 'h-7 text-xs')}
              onClick={handlePrint}
              disabled={lines.length === 0}
            >
              <Printer className={isSalesWorkspace ? 'w-4 h-4' : 'w-3 h-3'} /> {t.documentFormUi.print}
            </Button>
            {canTransmitAgt && (
              <Button
                size="sm"
                variant="default"
                className={cn('gap-1', isSalesWorkspace ? 'h-8 px-3 text-sm' : 'h-7 text-xs')}
                onClick={handleTransmitAgt}
                disabled={agtTransmitting || agtValidated}
              >
                <Send className={isSalesWorkspace ? 'w-4 h-4' : 'w-3 h-3'} />
                {agtValidated ? t.agtUi.agtValidatedLabel : t.documentFormUi.sendToAgt}
              </Button>
            )}
            {!fiscalLocked && !isPaymentDocument && (
              <Button
                size="sm"
                variant="outline"
                className={cn('gap-1', isSalesWorkspace ? 'h-8 px-3 text-sm' : 'h-7 text-xs')}
                onClick={() => handleSave('draft')}
              >
                <Save className={isSalesWorkspace ? 'w-4 h-4' : 'w-3 h-3'} /> {t.documentFormUi.saveDraft}
              </Button>
            )}
            {!formReadOnly && (
              <Button
                size="sm"
                className={cn('gap-1', isSalesWorkspace ? 'h-8 px-4 text-sm' : 'h-7 text-xs')}
                onClick={() => handleSave('confirmed')}
              >
                <Save className={isSalesWorkspace ? 'w-4 h-4' : 'w-3 h-3'} /> {dueDateOnlyEdit ? t.documentFormUi.saveDueDate : t.documentFormUi.confirmSave}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn('shrink-0', isSalesWorkspace ? 'h-8 w-8' : 'h-8 w-8')}
              onClick={() => onOpenChange(false)}
              aria-label={t.common.close}
            >
              <X className={isSalesWorkspace ? 'h-4 w-4' : 'h-4 w-4'} />
            </Button>
          </div>
        </div>

        <div className={cn(isSalesWorkspace ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 py-2' : 'space-y-4 p-4')}>
          {fiscalLocked && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
              {dueDateOnlyEdit
                ? t.documentFormUi.fiscalLockedDueDateOnly
                : t.documentFormUi.fiscalLockedBanner}
            </div>
          )}
          {canTransmitAgt && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{t.documentFormUi.agtStatusLabel}</p>
                <p className="text-muted-foreground text-xs">
                  {agtValidated
                    ? t.invoiceViewUi.agtValidated
                    : agtStatus === 'rejected'
                      ? t.invoiceViewUi.agtRejected
                      : t.invoiceViewUi.agtPending}
                  {agtCode ? ` · ${t.invoiceViewUi.cuce}: ${agtCode}` : ''}
                </p>
              </div>
              <Button
                size="sm"
                className="gap-1"
                onClick={handleTransmitAgt}
                disabled={agtTransmitting || agtValidated}
              >
                <Send className="w-3 h-3" />
                {agtValidated ? t.agtUi.agtValidatedLabel : t.documentFormUi.sendToAgt}
              </Button>
            </div>
          )}
          <div className={cn(
            contentLocked && 'pointer-events-none opacity-80',
            isSalesWorkspace ? 'shrink-0' : 'space-y-4',
          )}>
          {isSalesWorkspace && (
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
              <div className="rounded-lg border bg-card p-2 shadow-sm">
                <div className="mb-1.5 flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-semibold">{t.documentFormUi.customer}</Label>
                  {selectedEntityClient && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                      <Link2 className="h-3 w-3" />
                      {t.documentFormUi.clientLinked.replace('{name}', selectedEntityClient.name)}
                    </span>
                  )}
                  {walkInMode && paymentMethod !== 'credit' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                      {t.documentFormUi.walkInBadge}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={entityName}
                      onChange={(e) => {
                        const next = e.target.value;
                        setEntityName(next);
                        if (
                          entityId
                          && selectedEntityClient
                          && next.trim().toLowerCase() !== selectedEntityClient.name.trim().toLowerCase()
                        ) {
                          setEntityId('');
                          setEntityNif('');
                          setEntityAddress('');
                          setEntityPhone('');
                          setWalkInMode(true);
                        }
                        setEntityPickerOpen(true);
                      }}
                      onFocus={() => setEntityPickerOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => setEntityPickerOpen(false), 150);
                      }}
                      placeholder={t.documentFormUi.customerSearchPlaceholder}
                      className="h-8 pl-9 text-sm"
                      autoComplete="off"
                    />
                    {entityPickerOpen && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 overflow-y-auto rounded-lg border bg-popover shadow-lg max-h-44">
                        {!contentLocked && (
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 border-b px-4 py-2 text-left text-sm hover:bg-accent/60"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={applyWalkInCustomer}
                          >
                            <span className="truncate font-medium">{t.documentFormUi.quickSale}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {t.common.name} + {t.documentFormUi.nif}
                            </span>
                          </button>
                        )}
                        {filteredEntities.length === 0 ? (
                          <div className="px-3 py-2 space-y-2">
                            <p className="text-sm text-muted-foreground">
                              {t.documentFormUi.noSavedCustomers}
                            </p>
                            {!contentLocked && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 w-full gap-1.5 text-sm"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={openNewCustomerForm}
                              >
                                <UserPlus className="h-4 w-4" />
                                {t.clientsUi.newClient}
                              </Button>
                            )}
                          </div>
                        ) : (
                          filteredEntities.map((entity) => (
                            <button
                              key={entity.id}
                              type="button"
                              className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-accent/60"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => selectEntity(entity)}
                            >
                              <span className="truncate font-medium">{entity.name}</span>
                              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                {entity.nif || '—'}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 shrink-0 gap-1.5 px-3 text-sm"
                    onClick={applyWalkInCustomer}
                    disabled={contentLocked}
                  >
                    {t.documentFormUi.quickSale}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 shrink-0 gap-1.5 px-3 text-sm"
                    onClick={openNewCustomerForm}
                    disabled={contentLocked}
                  >
                    <UserPlus className="h-4 w-4" />
                    {t.clientsUi.newClient}
                  </Button>
                  {selectedEntityClient && !contentLocked && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 shrink-0 gap-1.5 px-3 text-sm"
                      onClick={openEditCustomerForm}
                    >
                      <Pencil className="h-4 w-4" />
                      {t.clientsUi.editTitle}
                    </Button>
                  )}
                </div>
                {selectedEntityClient ? (
                  <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs lg:grid-cols-4">
                    <p className="text-muted-foreground">
                      {t.documentFormUi.nif}{' '}
                      <span className="font-mono text-foreground">{entityNif || '—'}</span>
                    </p>
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{entityPhone || '—'}</span>
                    </p>
                    <p className="flex items-center gap-1.5 text-muted-foreground col-span-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{entityAddress || '—'}</span>
                    </p>
                    <p className="text-muted-foreground">
                      {t.documentFormUi.customerBalance}:{' '}
                      <span className="font-mono text-foreground">{fmt(creditClientBalance)} Kz</span>
                    </p>
                    <p className="text-muted-foreground col-span-2">
                      {t.clientsUi.colCreditLimit}:{' '}
                      <span className="font-mono text-foreground">{fmt(creditClientLimit)} Kz</span>
                    </p>
                  </div>
                ) : (
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <Label className="text-xs">{t.common.name} *</Label>
                      <Input
                        ref={walkInNameRef}
                        value={entityName}
                        onChange={(e) => {
                          setEntityName(e.target.value);
                          setWalkInMode(true);
                        }}
                        placeholder={t.documentFormUi.walkInNamePlaceholder}
                        className="h-8 text-sm"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-xs">{t.documentFormUi.nif} *</Label>
                      <Input
                        value={entityNif}
                        onChange={(e) => setEntityNif(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder={t.documentFormUi.walkInNifPlaceholder}
                        className="h-8 font-mono text-sm"
                        inputMode="numeric"
                        maxLength={10}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-card p-2 shadow-sm space-y-1.5">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-semibold">{t.documentFormUi.invoiceDetails}</Label>
                  {previewInvoiceType && (
                    <Badge variant={previewInvoiceType === 'FT' && isCreditInvoice ? 'default' : 'outline'} className="ml-auto">
                      {fiscalInvoiceTypeLabel(previewInvoiceType, t.posUi)}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5 col-span-2">
                    <Label className="text-xs">{t.documentFormUi.invoiceCaixa}</Label>
                    {renderInvoiceCaixaSelect()}
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-xs">{t.documentFormUi.dueDate}</Label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={e => setDueDate(e.target.value)}
                      className="h-8 text-sm"
                      disabled={formReadOnly || paymentMethod !== 'credit'}
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-xs">{t.documentFormUi.paymentMethod}</Label>
                    <Select value={paymentMethod} onValueChange={handlePaymentMethodChange}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">{t.paymentsUi.methods.cash}</SelectItem>
                        <SelectItem value="card">{t.paymentsUi.methods.card}</SelectItem>
                        <SelectItem value="transfer">{t.paymentsUi.methods.transfer}</SelectItem>
                        <SelectItem value="credit">{t.pos.credit}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {showPricingControls && (
                    <div className="space-y-0.5 col-span-2">
                      <Label className="text-xs">{t.documentFormUi.priceLevelLabel}</Label>
                      <Select value={String(priceLevel)} onValueChange={(v) => setPriceLevel(Number(v))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {t.documentFormUi.priceLevelOption.replace('{n}', String(n))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                {adjustmentPct !== 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t.documentFormUi.clientAdjustmentNote.replace('{pct}', `${adjustmentPct > 0 ? '+' : ''}${adjustmentPct}`)}
                  </p>
                )}
                {isCreditInvoice && (
                  <div className="space-y-1.5">
                    <p className={cn('text-xs', (creditMissingClient || creditNoLimit || creditOverLimit) ? 'text-destructive' : 'text-muted-foreground')}>
                      {creditMissingClient
                        ? t.checkoutUi.creditRequiresClient
                        : creditNoLimit
                          ? t.checkoutUi.creditNoLimit
                          : creditOverLimit
                            ? t.checkoutUi.creditOverLimit
                              .replace('{balance}', creditClientBalance.toLocaleString(locale))
                              .replace('{limit}', creditClientLimit.toLocaleString(locale))
                            : t.checkoutUi.creditHint}
                    </p>
                    {creditNoLimit && selectedEntityClient && !contentLocked && (
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[160px] flex-1 space-y-0.5">
                          <Label className="text-xs">{t.documentFormUi.setCreditLimitLabel}</Label>
                          <NumericInput
                            value={draftCreditLimit}
                            onValueChange={setDraftCreditLimit}
                            min={0}
                            className="h-8 text-sm"
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          disabled={savingCreditLimit || draftCreditLimit <= 0}
                          onClick={() => void applyInvoiceCreditLimit()}
                        >
                          {t.documentFormUi.setCreditLimitAction}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {!isSalesWorkspace && (
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{config.entityType === 'customer' ? t.documentFormUi.customer : t.documentFormUi.supplier}</Label>
              <div className="relative">
                <Input
                  value={entityName}
                  onChange={(e) => {
                    const next = e.target.value;
                    setEntityName(next);
                    if (
                      entityId
                      && selectedEntityClient
                      && next.trim().toLowerCase() !== selectedEntityClient.name.trim().toLowerCase()
                    ) {
                      setEntityId('');
                    }
                    setEntityPickerOpen(true);
                  }}
                  onFocus={() => setEntityPickerOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setEntityPickerOpen(false), 150);
                  }}
                  placeholder={finalConsumerName}
                  className="h-8 text-xs"
                  autoComplete="off"
                />
                {entityPickerOpen && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-0.5 border rounded-md bg-popover shadow-md max-h-40 overflow-y-auto">
                    {filteredEntities.length === 0 ? (
                      <p className="px-3 py-2 text-[11px] text-muted-foreground">
                        {t.documentFormUi.noSavedCustomers}
                      </p>
                    ) : (
                      filteredEntities.map((entity) => (
                        <button
                          key={entity.id}
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 flex justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectEntity(entity)}
                        >
                          <span className="truncate font-medium">{entity.name}</span>
                          <span className="text-muted-foreground shrink-0 tabular-nums">
                            {entity.nif || '—'}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {entityId && selectedEntityClient && (
                <p className="text-[11px] text-emerald-700 flex items-center gap-1">
                  <Link2 className="h-3 w-3 shrink-0" />
                  {t.documentFormUi.clientLinked.replace('{name}', selectedEntityClient.name)}
                </p>
              )}
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
          )}

          {showPricingControls && !isSalesWorkspace && (
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <Label className="text-xs">{t.documentFormUi.priceLevelLabel}</Label>
                <Select value={String(priceLevel)} onValueChange={(v) => setPriceLevel(Number(v))}>
                  <SelectTrigger className="h-8 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {t.documentFormUi.priceLevelOption.replace('{n}', String(n))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {adjustmentPct !== 0 && (
                <span className="text-xs text-muted-foreground pb-2">
                  {t.documentFormUi.clientAdjustmentNote.replace('{pct}', `${adjustmentPct > 0 ? '+' : ''}${adjustmentPct}`)}
                </span>
              )}
            </div>
          )}

          {/* Pending receipts / open items for selected customer or supplier */}
          {(documentType === 'fatura_venda' && !isSalesWorkspace || isPaymentDocument) && entityId && (
            <div className="border rounded-md">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/40">
                <div className="text-xs font-semibold">
                  {t.paymentsUi.openDocsToOffset} ({entityPayableItems.length})
                </div>
                {entityOpenItemsLoading && (
                  <div className="text-xs text-muted-foreground">{t.paymentsUi.loadingOpenDocs}</div>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto">
                {entityPayableItems.length === 0 && !entityOpenItemsLoading ? (
                  <div className="px-3 py-4 text-xs text-muted-foreground">
                    {documentType === 'recibo'
                      ? t.paymentsUi.noOpenDocsForEntity
                      : documentType === 'pagamento'
                        ? t.paymentsUi.noOpenDocsForSupplier
                        : t.paymentsUi.noneOpenItems}
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background/90 backdrop-blur border-b">
                      <tr>
                        {isPaymentDocument && <th className="w-8 px-2 py-2" />}
                        <th className="text-left font-semibold px-3 py-2">{t.paymentsUi.document}</th>
                        <th className="text-left font-semibold px-3 py-2">{t.common.date}</th>
                        <th className="text-left font-semibold px-3 py-2">{t.paymentsUi.dueDate}</th>
                        <th className="text-right font-semibold px-3 py-2">{t.paymentsUi.openAmount}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {entityPayableItems.map((oi) => (
                        <tr key={oi.id} className="hover:bg-accent/30">
                          {isPaymentDocument && (
                            <td className="px-2 py-2">
                              <Checkbox
                                checked={selectedOpenItemIds.has(oi.id)}
                                onCheckedChange={(checked) => {
                                  const next = new Set(selectedOpenItemIds);
                                  if (checked) next.add(oi.id);
                                  else next.delete(oi.id);
                                  setSelectedOpenItemIds(next);
                                }}
                              />
                            </td>
                          )}
                          <td className="px-3 py-2 font-mono">{oi.documentNumber}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {oi.documentDate ? new Date(oi.documentDate).toLocaleDateString(locale) : '—'}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {oi.dueDate ? new Date(oi.dueDate).toLocaleDateString(locale) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-medium">
                            {fmt(Math.abs(signedOpenItemBalance(oi)))} {t.common.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          </div>

          {/* Dates & payment row */}
          {!isSalesWorkspace && (
          <div className="grid grid-cols-4 gap-3">
            {documentType === 'proforma' && (
              <div className="space-y-1">
                <Label className="text-xs">{t.documentFormUi.validUntil}</Label>
                <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="h-8 text-xs" disabled={contentLocked} />
              </div>
            )}
            {(documentType !== 'proforma') && (
              <div className="space-y-1">
                <Label className="text-xs">{t.documentFormUi.dueDate}</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-8 text-xs" disabled={formReadOnly} />
              </div>
            )}
          </div>
          )}

          <div className={cn(
            contentLocked && 'pointer-events-none opacity-80',
            isSalesWorkspace ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden' : 'space-y-4',
          )}>
            {documentType === 'fatura_venda' && !isSalesWorkspace && (
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t.documentFormUi.paymentMethod}</Label>
                  <Select value={paymentMethod} onValueChange={handlePaymentMethodChange}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t.paymentsUi.methods.cash}</SelectItem>
                      <SelectItem value="card">{t.paymentsUi.methods.card}</SelectItem>
                      <SelectItem value="transfer">{t.paymentsUi.methods.transfer}</SelectItem>
                      <SelectItem value="credit">{t.pos.credit}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {isCreditInvoice && (
                  <div className="col-span-3 flex items-end pb-1">
                    {creditMissingClient ? (
                      <p className="text-xs text-destructive">{t.checkoutUi.creditRequiresClient}</p>
                    ) : creditNoLimit ? (
                      <div className="flex flex-wrap items-end gap-2 w-full">
                        <p className="text-xs text-destructive w-full">{t.checkoutUi.creditNoLimit}</p>
                        {selectedEntityClient && !contentLocked && (
                          <>
                            <div className="min-w-[140px] flex-1 space-y-1">
                              <Label className="text-xs">{t.documentFormUi.setCreditLimitLabel}</Label>
                              <NumericInput
                                value={draftCreditLimit}
                                onValueChange={setDraftCreditLimit}
                                min={0}
                                className="h-8 text-xs"
                              />
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8"
                              disabled={savingCreditLimit || draftCreditLimit <= 0}
                              onClick={() => void applyInvoiceCreditLimit()}
                            >
                              {t.documentFormUi.setCreditLimitAction}
                            </Button>
                          </>
                        )}
                      </div>
                    ) : creditOverLimit ? (
                      <p className="text-xs text-destructive">
                        {t.checkoutUi.creditOverLimit
                          .replace('{balance}', creditClientBalance.toLocaleString(locale))
                          .replace('{limit}', creditClientLimit.toLocaleString(locale))}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t.checkoutUi.creditHint}</p>
                    )}
                  </div>
                )}
              </div>
            )}
            {creditLooksLikeCash && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {t.documentFormUi.creditDueDateNeedsOnAccount}
              </p>
            )}
            {config.requiresPayment && (
              <div className="grid grid-cols-4 gap-3">
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
                  <Label className="text-xs">
                    {isPaymentDocument ? t.paymentsUi.amount : t.documentFormUi.amountPaid}
                  </Label>
                  <Input type="number" value={amountPaid} onChange={e => setAmountPaid(Number(e.target.value))} className="h-8 text-xs" />
                </div>
              </div>
            )}

          {!isPaymentDocument && (
          <div className={isSalesWorkspace ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden' : undefined}>
          {/* Product search + add */}
          <div className={cn('flex items-end gap-2', isSalesWorkspace && 'shrink-0')}>
            <div className="flex-1 space-y-0.5">
              <Label className={isSalesWorkspace ? 'text-xs font-medium' : 'text-xs'}>{t.documentFormUi.addProduct}</Label>
              <div className="relative">
                <Search className={cn(
                  'absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground',
                  isSalesWorkspace ? 'w-4 h-4' : 'w-3 h-3',
                )} />
                <Input value={productSearch} onChange={e => setProductSearch(e.target.value)}
                  placeholder={t.documentFormUi.productSearchPlaceholder}
                  className={isSalesWorkspace ? 'h-8 pl-9 text-sm' : 'h-8 text-xs pl-7'} />
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className={cn('gap-1', isSalesWorkspace ? 'h-8 px-3 text-sm' : 'h-8 text-xs')}
              onClick={() => addLine()}
            >
              <Plus className={isSalesWorkspace ? 'w-4 h-4' : 'w-3 h-3'} /> {t.documentFormUi.manualLine}
            </Button>
          </div>

          {/* Product search results */}
          {productSearch && filteredProducts.length > 0 && (
            <div className={cn(
              'overflow-y-auto rounded-lg border bg-popover shadow-sm',
              isSalesWorkspace ? 'max-h-28 shrink-0' : 'max-h-32',
            )}>
              {isSalesWorkspace && (
                <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_5.5rem_7rem] gap-2 border-b bg-muted/80 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>{t.documentFormUi.colDescription}</span>
                  <span className="text-right">{t.documentFormUi.colQty}</span>
                  <span className="text-right">{t.documentFormUi.colPriceExVat}</span>
                </div>
              )}
              {filteredProducts.map(p => (
                <button
                  key={p.id}
                  className={cn(
                    'w-full text-left hover:bg-accent/50',
                    isSalesWorkspace
                      ? 'grid grid-cols-[minmax(0,1fr)_5.5rem_7rem] items-center gap-2 px-4 py-1.5 text-sm'
                      : 'flex items-center justify-between gap-3 px-3 py-1.5 text-xs',
                  )}
                  onClick={() => addLine(p.id)}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-muted-foreground">{p.sku}</span> {p.name}
                  </span>
                  {isSalesWorkspace ? (
                    <>
                      <span className="text-right">
                        <Badge variant={(Number(p.stock) || 0) > 0 ? 'secondary' : 'destructive'} className="text-[10px] tabular-nums">
                          {Number(p.stock) || 0} {p.unit || 'UN'}
                        </Badge>
                        {(Number(p.reservedStock) || 0) > 0 && (
                          <span className="mt-0.5 block text-[10px] text-amber-600">
                            {language === 'pt' ? 'reserv.' : 'rsvd'} {p.reservedStock}
                          </span>
                        )}
                      </span>
                      <span className="text-right font-mono tabular-nums">{p.price.toLocaleString(locale)} Kz</span>
                    </>
                  ) : (
                    <span className="flex shrink-0 items-center gap-3">
                      <span className={cn(
                        'font-mono tabular-nums',
                        (Number(p.stock) || 0) <= 0 ? 'text-destructive' : 'text-muted-foreground',
                      )}>
                        {t.documentFormUi.availableStock
                          .replace('{qty}', String(Number(p.stock) || 0))
                          .replace('{unit}', p.unit || 'UN')}
                      </span>
                      <span className="font-mono">{p.price.toLocaleString(locale)} Kz</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Lines tabs */}
          <Tabs value={activeLineTab} onValueChange={setActiveLineTab} className={isSalesWorkspace ? 'flex min-h-0 flex-1 flex-col' : undefined}>
            <TabsList className={cn(
              'w-full justify-start rounded-none border-b bg-muted/30 p-0',
              isSalesWorkspace ? 'h-8 shrink-0' : 'h-7',
            )}>
              <TabsTrigger value="linhas" className={cn(
                'rounded-none border-b-2 border-transparent data-[state=active]:border-primary',
                isSalesWorkspace ? 'h-8 px-3 text-sm' : 'h-7 text-xs',
              )}>
                {t.documentFormUi.linesCount.replace('{count}', String(lines.length))}
              </TabsTrigger>
              <TabsTrigger value="notas" className={cn(
                'rounded-none border-b-2 border-transparent data-[state=active]:border-primary',
                isSalesWorkspace ? 'h-8 px-3 text-sm' : 'h-7 text-xs',
              )}>
                {t.documentFormUi.notesTab}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="linhas" className={isSalesWorkspace ? 'mt-0 flex min-h-0 flex-1 flex-col' : 'mt-0'}>
              <div className={cn(
                'overflow-auto border',
                isSalesWorkspace ? 'min-h-0 flex-1 rounded-lg' : 'rounded',
              )}>
                <table className={cn('w-full', isSalesWorkspace ? 'text-sm' : 'text-xs')}>
                  <thead className="sticky top-0 z-10 border-b bg-muted/80 backdrop-blur">
                    <tr>
                      <th className={cn('text-left', isSalesWorkspace ? 'px-2 py-1.5 w-8' : 'px-2 py-1.5 w-8')}>{t.documentFormUi.colHash}</th>
                      <th className={cn('text-left', isSalesWorkspace ? 'px-2 py-1.5 w-20' : 'px-2 py-1.5 w-20')}>{t.documentFormUi.colCode}</th>
                      <th className={cn('text-left', isSalesWorkspace ? 'px-2 py-1.5' : 'px-2 py-1.5')}>{t.documentFormUi.colDescription}</th>
                      {isSalesWorkspace && (
                        <th className="px-2 py-1.5 text-left w-[140px]">{t.documentFormUi.colBranch}</th>
                      )}
                      <th className={cn('text-right', isSalesWorkspace ? 'px-2 py-1.5 w-24' : 'px-2 py-1.5 w-16')}>{t.documentFormUi.colQty}</th>
                      <th className={cn('text-right', isSalesWorkspace ? 'px-2 py-1.5 w-24' : 'px-2 py-1.5 w-24')}>{t.documentFormUi.colPriceExVat}</th>
                      <th className={cn('text-right', isSalesWorkspace ? 'px-2 py-1.5 w-16' : 'px-2 py-1.5 w-16')}>{t.documentFormUi.colDiscPct}</th>
                      <th className={cn('text-right', isSalesWorkspace ? 'px-2 py-1.5 w-24' : 'px-2 py-1.5 w-20')}>{t.documentFormUi.colTaxableBase}</th>
                      <th className={cn('text-right', isSalesWorkspace ? 'px-2 py-1.5 w-14' : 'px-2 py-1.5 w-14')}>{t.documentFormUi.colVatPct}</th>
                      <th className={cn('text-right', isSalesWorkspace ? 'px-2 py-1.5 w-24' : 'px-2 py-1.5 w-24')}>{t.documentFormUi.colVatAmount}</th>
                      <th className={cn('text-right', isSalesWorkspace ? 'px-2 py-1.5 w-28' : 'px-2 py-1.5 w-28')}>{t.documentFormUi.colTotalIncVat}</th>
                      <th className={cn(isSalesWorkspace ? 'px-2 py-1.5 w-8' : 'px-2 py-1.5 w-8')}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {lines.map((line, idx) => (
                      <tr key={line.id} className="hover:bg-accent/30">
                        <td className={cn('text-muted-foreground', isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1')}>{idx + 1}</td>
                        <td className={isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1'}>
                          <Input value={line.productSku || ''} readOnly className={cn('border-0 bg-transparent p-0', isSalesWorkspace ? 'h-8 text-sm' : 'h-6 text-xs')} />
                        </td>
                        <td className={isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1'}>
                          <Input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                            className={cn('border-0 bg-transparent p-0 focus:border focus:bg-background', isSalesWorkspace ? 'h-8 text-sm' : 'h-6 text-xs')} />
                        </td>
                        {isSalesWorkspace && (
                          <td className="px-3 py-2">
                            {renderLineBranchLabel()}
                          </td>
                        )}
                        <td className={isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1'}>
                          <NumericInput integer min={0} value={line.quantity} onValueChange={v => updateLine(idx, 'quantity', v)}
                            className={cn(
                              'w-full text-right',
                              isSalesWorkspace
                                ? 'h-8 rounded-md border bg-background px-2 text-sm'
                                : 'h-6 border-0 bg-transparent p-0 text-xs focus:border focus:bg-background',
                            )} />
                          {isSalesWorkspace && line.productId && (() => {
                            const product = products.find((p) => p.id === line.productId);
                            if (!product) return null;
                            return (
                              <p className={cn(
                                'mt-0.5 text-[10px] tabular-nums',
                                (Number(product.stock) || 0) <= 0 ? 'text-destructive' : 'text-muted-foreground',
                              )}>
                                {t.documentFormUi.availableStock
                                  .replace('{qty}', String(Number(product.stock) || 0))
                                  .replace('{unit}', product.unit || 'UN')}
                              </p>
                            );
                          })()}
                        </td>
                        <td className={isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1'}>
                          <NumericInput min={0} value={line.unitPrice} onValueChange={v => updateLine(idx, 'unitPrice', v)}
                            className={cn('w-full border-0 bg-transparent p-0 text-right focus:border focus:bg-background', isSalesWorkspace ? 'h-8 text-sm' : 'h-6 text-xs')} />
                        </td>
                        <td className={isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1'}>
                          <NumericInput min={0} value={line.discount} onValueChange={v => updateLine(idx, 'discount', v)}
                            className={cn(
                              'w-full text-right',
                              isSalesWorkspace
                                ? 'h-8 rounded-md border bg-background px-2 text-sm'
                                : 'h-6 border-0 bg-transparent p-0 text-xs focus:border focus:bg-background',
                            )} />
                        </td>
                        <td className={cn('text-right font-mono text-muted-foreground', isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1')}>
                          {fmt((line.quantity * line.unitPrice) * (1 - (line.discount || 0) / 100))}
                        </td>
                        <td className={isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1'}>
                          <NumericInput min={0} max={100} value={line.taxRate} onValueChange={v => updateLine(idx, 'taxRate', v)}
                            className={cn('w-full border-0 bg-transparent p-0 text-right focus:border focus:bg-background', isSalesWorkspace ? 'h-8 text-sm' : 'h-6 text-xs')} />
                        </td>
                        <td className={cn('text-right font-mono', isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1')}>{fmt(line.taxAmount)}</td>
                        <td className={cn('text-right font-mono font-medium', isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1')}>{fmt(line.lineTotal)}</td>
                        <td className={isSalesWorkspace ? 'px-3 py-2' : 'px-2 py-1'}>
                          <Button variant="ghost" size="icon" className={isSalesWorkspace ? 'h-8 w-8' : 'h-5 w-5'} onClick={() => removeLine(idx)}>
                            <Trash2 className={cn('text-destructive', isSalesWorkspace ? 'w-4 h-4' : 'w-3 h-3')} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {lines.length === 0 && (
                      <tr><td colSpan={isSalesWorkspace ? 12 : 11} className={cn('text-center text-muted-foreground', isSalesWorkspace ? 'px-4 py-6 text-sm' : 'px-4 py-8')}>{t.documentFormUi.lineEmpty}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="notas" className={isSalesWorkspace ? 'mt-0 min-h-0 flex-1 overflow-auto' : 'mt-2'}>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t.documentFormUi.notesPlaceholder} rows={isSalesWorkspace ? 4 : 3} className={isSalesWorkspace ? 'h-full min-h-[6rem] text-sm' : 'text-xs'} />
            </TabsContent>
          </Tabs>

          <div className={cn(isSalesWorkspace && 'grid shrink-0 grid-cols-1 items-start gap-2 lg:grid-cols-[minmax(0,1fr)_18rem]')}>
          {/* IVA Summary Table (AGT Requirement) */}
          {ivaSummary.length > 0 && (
            <div className={cn('overflow-hidden border', isSalesWorkspace ? 'rounded-lg' : 'rounded')}>
              <table className={cn('w-full', isSalesWorkspace ? 'text-xs' : 'text-xs')}>
                <thead className="bg-muted/60">
                  <tr>
                    <th className={cn('text-left font-medium', isSalesWorkspace ? 'px-3 py-1.5' : 'px-3 py-1.5')}>{t.documentFormUi.taxSummaryTitle}</th>
                    <th className={cn('text-right font-medium', isSalesWorkspace ? 'px-3 py-1.5' : 'px-3 py-1.5')}>{t.documentFormUi.taxableBase}</th>
                    <th className={cn('text-right font-medium', isSalesWorkspace ? 'px-3 py-1.5' : 'px-3 py-1.5')}>{t.documentFormUi.vatRate}</th>
                    <th className={cn('text-right font-medium', isSalesWorkspace ? 'px-3 py-1.5' : 'px-3 py-1.5')}>{t.documentFormUi.vatAmount}</th>
                    <th className={cn('text-right font-medium', isSalesWorkspace ? 'px-3 py-1.5' : 'px-3 py-1.5')}>{t.documentFormUi.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {ivaSummary.map(([rate, vals]) => (
                    <tr key={rate} className="border-t">
                      <td className={isSalesWorkspace ? 'px-3 py-1' : 'px-3 py-1'}>{rate === 0 ? t.documentFormUi.exempt : t.documentFormUi.vatAtRate.replace('{rate}', String(rate))}</td>
                      <td className={cn('text-right font-mono', isSalesWorkspace ? 'px-3 py-1' : 'px-3 py-1')}>{fmt(vals.base, { minimumFractionDigits: 2 })} Kz</td>
                      <td className={cn('text-right', isSalesWorkspace ? 'px-3 py-1' : 'px-3 py-1')}>{rate}%</td>
                      <td className={cn('text-right font-mono', isSalesWorkspace ? 'px-3 py-1' : 'px-3 py-1')}>{fmt(vals.iva, { minimumFractionDigits: 2 })} Kz</td>
                      <td className={cn('text-right font-mono font-medium', isSalesWorkspace ? 'px-3 py-1' : 'px-3 py-1')}>{fmt(vals.total, { minimumFractionDigits: 2 })} Kz</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals panel */}
          <div className={cn(!isSalesWorkspace && 'flex justify-end')}>
            <div className={cn(
              isSalesWorkspace
                ? 'w-full space-y-0.5 rounded-lg border bg-card px-3 py-2 text-xs shadow-sm'
                : 'w-72 space-y-1 rounded border bg-muted/30 p-3 text-xs',
            )}>
              <div className="flex justify-between"><span>{t.documentFormUi.subtotalExVat}</span><span className="font-mono">{fmt(totals.subtotal)} Kz</span></div>
              <div className="flex justify-between text-muted-foreground"><span>{t.documentFormUi.discount}</span><span className="font-mono">-{fmt(totals.totalDiscount)} Kz</span></div>
              <div className="flex justify-between text-muted-foreground"><span>{t.documentFormUi.totalVat}</span><span className="font-mono">{fmt(totals.totalTax)} Kz</span></div>
              <div className={cn('flex justify-between border-t font-bold', isSalesWorkspace ? 'pt-1 text-sm' : 'pt-1 text-sm')}>
                <span>{t.documentFormUi.totalIncVat}</span><span className="font-mono">{fmt(totals.total)} Kz</span>
              </div>
              {(config.requiresPayment || isCreditInvoice) && (
                <>
                  <div className="flex justify-between text-green-600"><span>{t.documentFormUi.paid}</span><span className="font-mono">{fmt(isCreditInvoice ? 0 : amountPaid)} Kz</span></div>
                  <div className="flex justify-between font-medium text-destructive"><span>{t.documentFormUi.outstanding}</span><span className="font-mono">{fmt(totals.total - (isCreditInvoice ? 0 : amountPaid))} Kz</span></div>
                </>
              )}
              {previewInvoiceType && !isSalesWorkspace && (
                <div className="mt-2 space-y-1 border-t pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{t.checkoutUi.documentType}</span>
                    <Badge variant={previewInvoiceType === 'FT' && isCreditInvoice ? 'default' : 'outline'}>
                      {fiscalInvoiceTypeLabel(previewInvoiceType, t.posUi)}
                    </Badge>
                  </div>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    {previewInvoiceType === 'FS'
                      ? t.documentFormUi.fsPreviewWarning.replace('{max}', fsMaxAmount().toLocaleString(locale))
                      : previewInvoiceType === 'FT' && isCreditInvoice
                        ? t.documentFormUi.ftCreditPreview
                        : t.checkoutUi.documentTypeHint.replace('{max}', fsMaxAmount().toLocaleString(locale))}
                  </p>
                </div>
              )}
            </div>
          </div>
          </div>
          </div>
          )}

          {isPaymentDocument && (
            <div className="space-y-1">
              <Label className="text-xs">{t.common.notes}</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t.documentFormUi.notesPlaceholder} rows={3} className="text-xs" />
            </div>
          )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    {isSalesWorkspace && (
      <ClientFormDialog
        open={customerFormOpen}
        onOpenChange={setCustomerFormOpen}
        client={customerFormClient}
        initialName={entityName}
        initialCreditLimit={totals.total}
        onSaved={(client) => {
          applySavedCustomer(client);
          setCustomerFormOpen(false);
          setCustomerFormClient(null);
        }}
      />
    )}
    </>
  );
}
