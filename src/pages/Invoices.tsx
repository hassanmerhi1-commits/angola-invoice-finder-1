// NEXOR ERP Faturas/Vouchers workspace
// Multi-tab document browser with linked conversion flow

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { navigateThenStartPurchaseCreate } from '@/lib/nexorPurchaseCreate';
import { useTranslation } from '@/i18n';
import { useAuth, useClients } from '@/hooks/useERP';
import { useBranchScope } from '@/hooks/useBranchScope';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  Plus, Search, Printer, RefreshCw, FileText, Receipt,
  Banknote, CreditCard, ArrowRight, Download, XCircle, CheckCircle,
  Clock, ChevronDown, ArrowRightLeft, Send, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { salesOrderToErpDocumentPrefill, type SalesOrder } from '@/lib/salesOrderToDocument';
import { printDocument, downloadDocumentHTML } from '@/lib/documentPDF';
import { DocumentType, ERPDocument, DOCUMENT_TYPE_CONFIG, DocumentStatus } from '@/types/documents';
import type { CreditNote } from '@/types/erp';
import { api } from '@/lib/api/client';
import { getCachedList, setCachedList } from '@/lib/listCache';
import { invalidateInventoryGridCacheForBranches } from '@/lib/inventoryGrid';
import { PRODUCTS_CHANGED_EVENT } from '@/lib/storage';
import {
  getDocuments,
  convertDocument,
  getSalesInvoicesAsDocuments,
  getPurchaseInvoicesAsDocuments,
  mapCreditNoteToDocument,
} from '@/lib/documentStorage';
import type { BranchRef } from '@/lib/purchaseInvoiceStorage';
import { NEXOR_TOOLBAR } from '@/lib/nexorToolbarEvents';
import { NEXOR_TOOLBAR_BTN_SM } from '@/lib/nexorToolbarStyles';
import { SALES_CHANGED_EVENT, CREDIT_NOTES_CHANGED_EVENT } from '@/lib/storage';
import {
  documentTypeForNewFromTab,
  getInvoicesWorkspaceTab,
  NEXOR_INVOICES_NEW,
  NEXOR_INVOICES_NEW_RECEIPT,
  setInvoicesWorkspaceTab,
  type InvoicesWorkspaceTab,
} from '@/lib/invoicesWorkspace';
import { DatePickerButton, localISODate } from '@/components/ui/DatePickerButton';
import { DocumentFormDialog } from '@/components/documents/DocumentFormDialog';
import { isFiscallyImmutable } from '@/lib/fiscalImmutability';
import { DocumentFlowViewer } from '@/components/documents/DocumentFlowViewer';
import { setContextMenuResolver } from '@/lib/contextMenuRegistry';
import { useAgtTransmit } from '@/hooks/useAgtTransmit';
import { useVoidInvoice } from '@/hooks/useVoidInvoice';
import { usePermissions } from '@/hooks/usePermissions';
import { isAgtValidated } from '@/lib/agtStatus';
import { VoidInvoiceDialog } from '@/components/invoice/VoidInvoiceDialog';

function isProvisionalInvoiceNumber(documentNumber: string): boolean {
  const n = String(documentNumber || '').trim().toUpperCase();
  return n.startsWith('OFF-') || n.startsWith('LOCAL-');
}

/** Prefer canonical sales row over stale local erp_documents mirror (doc_* ids). */
function resolveCanonicalSaleDocument(doc: ERPDocument, all: ERPDocument[]): ERPDocument {
  if (doc.documentType !== 'fatura_venda' || !doc.documentNumber) return doc;
  const canonical = all.find(
    (d) => d.documentType === 'fatura_venda'
      && d.documentNumber === doc.documentNumber
      && !d.id.startsWith('doc_'),
  );
  if (!canonical) return doc;
  return {
    ...canonical,
    agtStatus: canonical.agtStatus || doc.agtStatus,
    agtCode: canonical.agtCode || doc.agtCode,
  };
}

// Build flow nodes from a document and its linked chain
function buildFlowNodes(doc: ERPDocument): { type: string; number: string; date: string; status: 'completed' | 'active' | 'pending'; amount?: number }[] {
  const nodes: { type: string; number: string; date: string; status: 'completed' | 'active' | 'pending'; amount?: number }[] = [];

  // Parent document (origin)
  if (doc.parentDocumentNumber && doc.parentDocumentType) {
    const typeMap: Record<string, string> = {
      proforma: 'proforma', fatura_venda: 'invoice', fatura_compra: 'invoice',
      recibo: 'payment', pagamento: 'payment', nota_credito: 'credit_note',
      nota_debito: 'invoice', guia_remessa: 'delivery',
    };
    nodes.push({
      type: typeMap[doc.parentDocumentType] || doc.parentDocumentType,
      number: doc.parentDocumentNumber,
      date: doc.issueDate,
      status: 'completed',
    });
  }

  // Current document
  const currentTypeMap: Record<string, string> = {
    proforma: 'proforma', fatura_venda: 'invoice', fatura_compra: 'invoice',
    recibo: 'payment', pagamento: 'payment', nota_credito: 'credit_note',
    nota_debito: 'invoice', guia_remessa: 'delivery',
  };
  nodes.push({
    type: currentTypeMap[doc.documentType] || doc.documentType,
    number: doc.documentNumber,
    date: doc.issueDate,
    status: 'active',
    amount: doc.total,
  });

  // Child documents
  if (doc.childDocuments) {
    for (const child of doc.childDocuments) {
      nodes.push({
        type: currentTypeMap[child.type] || child.type,
        number: child.number,
        date: doc.issueDate,
        status: 'completed',
      });
    }
  }

  return nodes;
}

export default function Invoices() {
  const { t, language } = useTranslation();
  const DOC_TABS: { key: DocumentType | 'all'; label: string; icon: any }[] = useMemo(() => [
    { key: 'all', label: t.documents.all, icon: FileText },
    { key: 'proforma', label: t.documents.proforma, icon: FileText },
    { key: 'fatura_venda', label: t.documents.salesInvoiceShort, icon: FileText },
    { key: 'fatura_compra', label: t.documents.purchaseInvoiceShort, icon: FileText },
    { key: 'recibo', label: t.documents.receipt, icon: Receipt },
    { key: 'pagamento', label: t.documents.payment, icon: Banknote },
    { key: 'nota_credito', label: t.documents.creditNoteShort, icon: CreditCard },
    { key: 'nota_debito', label: t.documents.debitNoteShort, icon: CreditCard },
    { key: 'guia_remessa', label: t.documents.deliveryNoteShort, icon: FileText },
  ], [t]);

  const STATUS_BADGES: Record<DocumentStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = useMemo(() => ({
    draft: { label: t.documentStatus.draft, variant: 'secondary' },
    pending: { label: t.documentStatus.pending, variant: 'outline' },
    confirmed: { label: t.documentStatus.confirmed, variant: 'default' },
    paid: { label: t.documentStatus.paid, variant: 'default' },
    partial: { label: t.documentStatus.partial, variant: 'outline' },
    cancelled: { label: t.documentStatus.cancelled, variant: 'destructive' },
    converted: { label: t.documentStatus.converted, variant: 'secondary' },
  }), [t]);
  const { user } = useAuth();
  const { clients } = useClients();
  const { hasPermission } = usePermissions(user?.id);
  const canSendAgt = hasPermission('agt_send');
  const canCreateCreditNote = hasPermission('credit_note_create');
  const canCreateDebitNote = hasPermission('debit_note_create');
  const canVoidInvoice = hasPermission('pos_void');
  const { currentBranch, branches, isHeadOffice, listBranchId } = useBranchScope();
  const navigate = useNavigate();
  const location = useLocation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { transmit: transmitAgt } = useAgtTransmit();
  const { voidInvoice, voiding } = useVoidInvoice();

  const [activeTab, setActiveTab] = useState<DocumentType | 'all'>('all');
  const [voidTarget, setVoidTarget] = useState<ERPDocument | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState(() => localISODate());
  const [dateTo, setDateTo] = useState(() => localISODate());
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [listLoading, setListLoading] = useState(false);

  // Dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [formDocType, setFormDocType] = useState<DocumentType>('fatura_venda');
  const [editDoc, setEditDoc] = useState<ERPDocument | null>(null);
  const [prefillDoc, setPrefillDoc] = useState<ERPDocument | null>(null);
  const pendingSalesOrderIdRef = useRef<string | null>(null);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  // Load documents — seed instantly from cache so the tab renders without waiting on the network.
  const [documents, setDocuments] = useState<ERPDocument[]>(
    () => getCachedList<ERPDocument[]>(`invoicesDocs:${activeTab}:${listBranchId ?? 'all'}:${dateFrom}:${dateTo}`) ?? [],
  );

  useEffect(() => {
    const onSalesChanged = () => setRefreshKey((k) => k + 1);
    const onCreditNotesChanged = () => setRefreshKey((k) => k + 1);
    window.addEventListener(SALES_CHANGED_EVENT, onSalesChanged);
    window.addEventListener(CREDIT_NOTES_CHANGED_EVENT, onCreditNotesChanged);
    return () => {
      window.removeEventListener(SALES_CHANGED_EVENT, onSalesChanged);
      window.removeEventListener(CREDIT_NOTES_CHANGED_EVENT, onCreditNotesChanged);
    };
  }, []);

  useEffect(() => {
    const type = activeTab === 'all' ? undefined : activeTab;
    const branchFilter = listBranchId;
    const branchNames = Object.fromEntries(branches.map((b) => [b.id, b.name]));
    const branchCatalog: BranchRef[] = branches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      isMain: b.isMain,
    }));

    const cacheKey = `invoicesDocs:${activeTab}:${listBranchId ?? 'all'}:${dateFrom}:${dateTo}`;
    // Drop previous branch/tab rows immediately; seed only this scope's cache.
    setSelectedDocId(null);
    setDocuments(getCachedList<ERPDocument[]>(cacheKey) ?? []);
    setListLoading(true);

    let cancelled = false;
    const listOpts = { light: true as const, dateFrom, dateTo, limit: 200 };
    const load = async () => {
      try {
        if (type === 'nota_credito') {
          const cnRes = await api.fiscalDocuments.listCreditNotes(listBranchId, listOpts);
          const mapped = (cnRes.data || []).map((cn: CreditNote) =>
            mapCreditNoteToDocument(cn, cn.branchName || branchNames[cn.branchId] || '', t.pos.finalConsumer),
          );
          if (!cancelled) {
            setDocuments(mapped);
            setCachedList(cacheKey, mapped);
          }
          return;
        }

        const loadSales = !type || type === 'fatura_venda';
        const loadPurchase = !type || type === 'fatura_compra';

        const loadFiscalCreditNotes = !type;
        const [storedDocs, salesDocs, purchaseDocs, cnRes] = await Promise.all([
          getDocuments(type, branchFilter),
          loadSales
            ? getSalesInvoicesAsDocuments(listBranchId, branchNames, isHeadOffice, branchCatalog, listOpts)
            : Promise.resolve([]),
          loadPurchase
            ? getPurchaseInvoicesAsDocuments(listBranchId, branchNames, branchCatalog, isHeadOffice)
            : Promise.resolve([]),
          loadFiscalCreditNotes
            ? api.fiscalDocuments.listCreditNotes(listBranchId, listOpts)
            : Promise.resolve({ data: [] as CreditNote[] }),
        ]);

        const salesByNumber = new Map(
          salesDocs.filter((d) => d.documentNumber).map((d) => [d.documentNumber, d]),
        );
        const fiscalCreditDocs = (cnRes.data || []).map((cn: CreditNote) =>
          mapCreditNoteToDocument(cn, cn.branchName || branchNames[cn.branchId] || '', t.pos.finalConsumer),
        );
        const merged: ERPDocument[] = [];
        const seenNumbers = new Set<string>();
        for (const doc of storedDocs) {
          if (doc.documentType === 'fatura_venda' && doc.documentNumber && salesByNumber.has(doc.documentNumber)) {
            continue;
          }
          // Local erp_documents copies are stale; fiscal API is canonical for credit notes.
          if (doc.documentType === 'nota_credito') continue;
          merged.push(doc);
          if (doc.documentNumber) seenNumbers.add(doc.documentNumber);
        }
        for (const doc of [...salesDocs, ...purchaseDocs, ...fiscalCreditDocs]) {
          if (!doc.documentNumber || seenNumbers.has(doc.documentNumber)) continue;
          seenNumbers.add(doc.documentNumber);
          merged.push(doc);
        }

        merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const result = type ? merged.filter((d) => d.documentType === type) : merged;
        if (!cancelled) {
          setDocuments(result);
          setCachedList(cacheKey, result);
        }
      } catch (err) {
        console.error('[Invoices] load failed:', err);
        // Keep showing the last cached list instead of blanking the tab on a transient failure.
        const cached = getCachedList<ERPDocument[]>(cacheKey);
        if (!cached || cached.length === 0) {
          toast.error(err instanceof Error ? err.message : t.common.loading);
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [activeTab, listBranchId, isHeadOffice, branches, refreshKey, dateFrom, dateTo, t.pos.finalConsumer]);

  useEffect(() => {
    setInvoicesWorkspaceTab(activeTab);
  }, [activeTab]);

  // Open sales invoice form when navigating from Pro Forma or Sales Order conversion
  useEffect(() => {
    const st = location.state as {
      prefillFromProforma?: ERPDocument;
      fromSalesOrder?: SalesOrder;
    } | null;
    if (st?.fromSalesOrder) {
      setActiveTab('fatura_venda');
      setInvoicesWorkspaceTab('fatura_venda');
      setFormDocType('fatura_venda');
      setEditDoc(null);
      pendingSalesOrderIdRef.current = st.fromSalesOrder.id;
      const client = clients.find((c) => c.id === st.fromSalesOrder?.clientId);
      setPrefillDoc(salesOrderToErpDocumentPrefill(st.fromSalesOrder, {
        paymentTermsDays: client?.paymentTermsDays,
      }));
      setFormOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }
    if (!st?.prefillFromProforma) return;
    setActiveTab('fatura_venda');
    setInvoicesWorkspaceTab('fatura_venda');
    setFormDocType('fatura_venda');
    setEditDoc(null);
    setPrefillDoc(st.prefillFromProforma);
    setFormOpen(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate, clients]);

  const openFiscalCreditNoteCreate = useCallback(() => {
    if (!canCreateCreditNote) {
      toast.error(t.fiscalDocumentsUi.creditNotePermissionDenied);
      return;
    }
    toast.info(t.invoicesUi.creditNoteUseFiscalDocs);
    navigate('/fiscal-documents', { state: { openCreditNoteCreate: true } });
  }, [navigate, canCreateCreditNote, t]);

  const openFiscalDebitNoteCreate = useCallback(() => {
    if (!canCreateDebitNote) {
      toast.error(t.fiscalDocumentsUi.debitNotePermissionDenied);
      return;
    }
    toast.info(t.invoicesUi.debitNoteUseFiscalDocs);
    navigate('/fiscal-documents', { state: { openDebitNoteCreate: true } });
  }, [navigate, canCreateDebitNote, t]);

  const openNewDocumentForTab = useCallback(
    (tab?: InvoicesWorkspaceTab) => {
      const resolved = tab ?? getInvoicesWorkspaceTab();
      if (resolved === 'nota_credito') {
        openFiscalCreditNoteCreate();
        return;
      }
      if (resolved === 'nota_debito') {
        openFiscalDebitNoteCreate();
        return;
      }
      if (resolved === 'recibo') {
        navigate('/payments', { state: { openReceipt: true } });
        return;
      }
      if (resolved === 'pagamento') {
        navigate('/payments', { state: { openPayment: true } });
        return;
      }
      const type = documentTypeForNewFromTab(resolved);
      if (type === 'fatura_compra') {
        navigateThenStartPurchaseCreate(navigate, location.pathname);
        return;
      }
      setFormDocType(type);
      setEditDoc(null);
      setPrefillDoc(null);
      setFormOpen(true);
    },
    [navigate, location.pathname, openFiscalCreditNoteCreate, openFiscalDebitNoteCreate],
  );

  // TopNav toolbar "Novo" — match active document tab (read tab at click time)
  useEffect(() => {
    const onToolbarNew = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: InvoicesWorkspaceTab }>).detail;
      openNewDocumentForTab(detail?.tab ?? getInvoicesWorkspaceTab());
    };
    const openReceipt = () => {
      navigate('/payments', { state: { openReceipt: true } });
    };
    window.addEventListener(NEXOR_INVOICES_NEW, onToolbarNew);
    window.addEventListener(NEXOR_INVOICES_NEW_RECEIPT, openReceipt);
    return () => {
      window.removeEventListener(NEXOR_INVOICES_NEW, onToolbarNew);
      window.removeEventListener(NEXOR_INVOICES_NEW_RECEIPT, openReceipt);
    };
  }, [openNewDocumentForTab, navigate]);

  const filteredDocs = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return documents.filter((d) => {
      if (q) {
        const hay = [
          d.documentNumber,
          d.entityName,
          d.entityNif,
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const day = String(d.issueDate || '').slice(0, 10);
      if (dateFrom && day && day < dateFrom) return false;
      if (dateTo && day && day > dateTo) return false;
      return true;
    });
  }, [documents, searchTerm, dateFrom, dateTo]);

  const selectedDoc = filteredDocs.find(d => d.id === selectedDocId);

  // Totals
  const totals = useMemo(() => ({
    count: filteredDocs.length,
    total: filteredDocs.reduce((s, d) => s + d.total, 0),
    paid: filteredDocs.reduce((s, d) => s + d.amountPaid, 0),
    due: filteredDocs.reduce((s, d) => s + d.amountDue, 0),
  }), [filteredDocs]);

  const openNewDocument = (type: DocumentType) => {
    openNewDocumentForTab(type);
  };

  const openEditDocument = (doc: ERPDocument) => {
    if (doc.documentType === 'nota_credito') {
      const isLocalOnly = doc.id.startsWith('doc_');
      navigate('/fiscal-documents', {
        state: isLocalOnly
          ? { openCreditNoteNumber: doc.documentNumber }
          : { openCreditNoteId: doc.id },
      });
      return;
    }
    const resolved = doc.documentType === 'fatura_venda'
      ? resolveCanonicalSaleDocument(doc, documents)
      : doc;
    setFormDocType(resolved.documentType);
    setEditDoc(resolved);
    setPrefillDoc(null);
    setFormOpen(true);
  };

  useEffect(() => {
    const selected = documents.find((d) => d.id === selectedDocId) || null;

    const onAll = () => {
      setSelectedDocId(null);
      setSearchTerm('');
      setFormOpen(false);
      setEditDoc(null);
      setPrefillDoc(null);
    };
    const onPrint = () => {
      if (!selected) {
        toast.info(t.topNav.file.printSelectDocument);
        return;
      }
      void printDocument(selected, { source: 'invoices' })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          toast.error(message || t.invoiceViewUi.printError);
        });
    };
    const onExcel = () => {
      const rows = filteredDocs.map((d) => ({
        Tipo: d.documentType,
        Numero: d.documentNumber,
        Data: d.issueDate,
        Entidade: d.entityName,
        Total: d.total,
        Pago: d.amountPaid,
        Pendente: d.amountDue,
        Estado: d.status,
      }));
      if (!rows.length) return;
      import('@/lib/excel').then(({ exportToExcel }) => {
        exportToExcel(rows, `documentos_${new Date().toISOString().slice(0, 10)}`);
      });
    };

    const handlers: Record<string, () => void> = {
      [NEXOR_TOOLBAR.ALL]: onAll,
      [NEXOR_TOOLBAR.DOCUMENTS_PRINT]: onPrint,
      [NEXOR_TOOLBAR.EXCEL]: onExcel,
    };

    for (const [event, handler] of Object.entries(handlers)) {
      window.addEventListener(event, handler);
    }
    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        window.removeEventListener(event, handler);
      }
    };
  }, [documents, selectedDocId, filteredDocs, t]);

  useEffect(() => {
    setContextMenuResolver((target) => {
      const row = target.closest('[data-nexor-context="document-row"]');
      if (!row) return [];
      const docId = row.getAttribute('data-nexor-id');
      const doc = documents.find((d) => d.id === docId);
      if (!doc) return [];

      const immutable = isFiscallyImmutable(doc);
      const items = [
        {
          id: immutable ? 'doc-view' : 'doc-edit',
          label: immutable ? t.invoicesUi.viewEdit : t.interaction.openEdit,
          onSelect: () => openEditDocument(doc),
        },
        {
          id: 'doc-print',
          label: t.interaction.printDocument,
          onSelect: () => {
            void printDocument(doc, { source: 'invoices' })
              .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                toast.error(message || t.invoiceViewUi.printError);
              });
          },
        },
      ];
      if (
        canSendAgt
        && doc.documentType === 'fatura_venda'
        && immutable
        && doc.status !== 'cancelled'
        && !isAgtValidated(resolveCanonicalSaleDocument(doc, documents).agtStatus)
      ) {
        const target = resolveCanonicalSaleDocument(doc, documents);
        items.push({
          id: 'doc-send-agt',
          label: t.documentFormUi.sendToAgt,
          onSelect: () => {
            void transmitAgt('sale', target.id, {
              documentNumber: target.documentNumber,
              onSuccess: () => refresh(),
            });
          },
        });
      }
      if (
        canVoidInvoice
        && doc.documentType === 'fatura_venda'
        && immutable
        && doc.status !== 'cancelled'
      ) {
        items.push({
          id: 'doc-void',
          label: t.voidInvoiceUi.action,
          onSelect: () => setVoidTarget(resolveCanonicalSaleDocument(doc, documents)),
        });
      }
      return items;
    });
    return () => setContextMenuResolver(null);
  }, [documents, openEditDocument, t, transmitAgt, refresh, canSendAgt, canVoidInvoice]);

  const handleConvert = async (doc: ERPDocument, targetType: DocumentType) => {
    if (targetType === 'nota_credito') {
      if (!canCreateCreditNote) {
        toast.error(t.fiscalDocumentsUi.creditNotePermissionDenied);
        return;
      }
      if (doc.documentType === 'fatura_venda') {
        navigate('/fiscal-documents', { state: { openCreditNoteForSaleId: doc.id } });
        toast.info(t.invoicesUi.creditNoteUseFiscalDocs);
        return;
      }
    }
    if (targetType === 'nota_debito') {
      if (!canCreateDebitNote) {
        toast.error(t.fiscalDocumentsUi.debitNotePermissionDenied);
        return;
      }
      if (doc.documentType === 'fatura_venda') {
        navigate('/fiscal-documents', { state: { openDebitNoteForSaleId: doc.id } });
        toast.info(t.invoicesUi.debitNoteUseFiscalDocs);
        return;
      }
    }
    // Proforma → Sales invoice should open the form prefilled (draft),
    // not auto-create a confirmed invoice.
    if (doc.documentType === 'proforma' && targetType === 'fatura_venda') {
      setActiveTab('fatura_venda');
      setInvoicesWorkspaceTab('fatura_venda');
      setFormDocType('fatura_venda');
      setEditDoc(null);
      setPrefillDoc(doc);
      setFormOpen(true);
      return;
    }
    const result = await convertDocument(
      doc.id,
      targetType,
      currentBranch?.code || 'SEDE',
      user?.id || '',
      user?.name || ''
    );
    if (result) {
      const typeLabels = t.documentFormUi.types as Record<DocumentType, { full: string; short: string }>;
      const targetShort = typeLabels[targetType]?.short ?? DOCUMENT_TYPE_CONFIG[targetType].shortLabel;
      toast.success(
        t.invoicesUi.conversionCreated
          .replace('{type}', targetShort)
          .replace('{number}', result.documentNumber)
          .replace('{source}', doc.documentNumber),
      );
      refresh();
    } else {
      toast.error(t.invoicesUi.conversionNotAllowed);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM}>
              <Plus className="w-3 h-3" /> {t.invoicesUi.newDocument} <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(Object.keys(DOCUMENT_TYPE_CONFIG) as DocumentType[])
              .filter((key) => key !== 'nota_credito' || canCreateCreditNote)
              .map((key) => {
              const cfg = DOCUMENT_TYPE_CONFIG[key];
              const typeLabels = t.documentFormUi.types as Record<DocumentType, { full: string; short: string }>;
              const label = typeLabels[key]?.full ?? cfg.label;
              return (
              <DropdownMenuItem key={key} onClick={() => {
                if (key === 'fatura_compra') {
                  navigateThenStartPurchaseCreate(navigate, location.pathname);
                } else if (key === 'nota_credito') {
                  openFiscalCreditNoteCreate();
                } else if (key === 'nota_debito') {
                  openFiscalDebitNoteCreate();
                } else {
                  openNewDocument(key);
                }
              }}>
                <span className={cn("mr-2", cfg.color)}>■</span>
                {label}
              </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Convert button */}
        {selectedDoc && DOCUMENT_TYPE_CONFIG[selectedDoc.documentType].canConvertTo
          .filter((targetType) => targetType !== 'nota_credito' || canCreateCreditNote).length > 0
          && selectedDoc.status !== 'converted' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM}>
                <ArrowRightLeft className="w-3 h-3" /> {t.invoicesUi.convert} <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {DOCUMENT_TYPE_CONFIG[selectedDoc.documentType].canConvertTo
                .filter((targetType) => targetType !== 'nota_credito' || canCreateCreditNote)
                .map(targetType => {
                const typeLabels = t.documentFormUi.types as Record<DocumentType, { full: string; short: string }>;
                const convLabel = typeLabels[targetType]?.full ?? DOCUMENT_TYPE_CONFIG[targetType].label;
                return (
                <DropdownMenuItem key={targetType} onClick={() => handleConvert(selectedDoc, targetType)}>
                  <ArrowRight className="w-3 h-3 mr-2" />
                  {convLabel}
                </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={!selectedDoc}
          onClick={() => {
            if (!selectedDoc) return;
            void printDocument(selectedDoc, { source: 'invoices' })
              .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                toast.error(message || t.invoiceViewUi.printError);
              });
          }}>
          <Printer className="w-3 h-3" /> {t.invoicesUi.print}
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={!selectedDoc}
          onClick={() => selectedDoc && downloadDocumentHTML(selectedDoc)}>
          <Download className="w-3 h-3" /> {t.invoicesUi.pdf}
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={refresh}>
          <RefreshCw className="w-3 h-3" />
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <span className="text-xs text-muted-foreground">{t.common.from}:</span>
        <DatePickerButton
          value={dateFrom}
          onChange={setDateFrom}
          placeholder={t.common.from}
          locale={language === 'pt' ? 'pt' : 'en'}
        />
        <span className="text-xs text-muted-foreground">{t.common.to}:</span>
        <DatePickerButton
          value={dateTo}
          onChange={setDateTo}
          placeholder={t.common.to}
          locale={language === 'pt' ? 'pt' : 'en'}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={() => {
            const today = localISODate();
            setDateFrom(today);
            setDateTo(today);
          }}
        >
          {t.invoicesUi.todayOnly}
        </Button>

        <div className="flex-1" />

        {/* Document flow legend */}
        <div className="hidden md:flex items-center gap-1 text-[10px] text-muted-foreground mr-2">
          <span className="text-blue-600 font-medium">{t.invoicesUi.flowProforma}</span>
          <ArrowRight className="w-3 h-3" />
          <span className="text-green-600 font-medium">{t.invoicesUi.flowInvoice}</span>
          <ArrowRight className="w-3 h-3" />
          <span className="text-emerald-600 font-medium">{t.invoicesUi.flowReceipt}</span>
          <ArrowRight className="w-3 h-3" />
          <span className="text-red-600 font-medium">{t.invoicesUi.flowPayment}</span>
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input placeholder={t.invoicesUi.searchPlaceholder} value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="h-7 text-xs pl-7 w-40" />
        </div>
      </div>

      {/* Document type tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          const tab = v as DocumentType | 'all';
          setActiveTab(tab);
          setInvoicesWorkspaceTab(tab);
          setSelectedDocId(null);
        }}
        className="flex-1 flex flex-col"
      >
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 h-auto p-0 overflow-x-auto">
          {DOC_TABS.map(tab => {
            const config = tab.key !== 'all' ? DOCUMENT_TYPE_CONFIG[tab.key] : null;
            return (
              <TabsTrigger key={tab.key} value={tab.key}
                className={cn(
                  "text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-3 py-1.5",
                  config && `data-[state=active]:${config.color}`
                )}>
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Single content area for all tabs (same grid) */}
        <div className="flex-1 overflow-auto">
          {activeTab === 'nota_credito' && (
            <div className="flex items-center justify-between gap-3 border-b bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
              <span>{t.invoicesUi.fiscalDocsCreditNoteHint}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                onClick={() => navigate('/fiscal-documents')}
              >
                {t.invoicesUi.openFiscalDocuments}
              </Button>
            </div>
          )}
          {activeTab === 'nota_debito' && (
            <div className="flex items-center justify-between gap-3 border-b bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
              <span>{t.invoicesUi.debitNoteUseFiscalDocs}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                onClick={() => navigate('/fiscal-documents', { state: { openDebitNoteCreate: true } })}
              >
                {t.invoicesUi.openFiscalDocuments}
              </Button>
            </div>
          )}
          <div className="relative">
          {listLoading && filteredDocs.length > 0 && (
            <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 border-b bg-background/80 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t.common.loading}
            </div>
          )}
          <table className={cn('w-full text-xs', listLoading && filteredDocs.length > 0 && 'opacity-60 pointer-events-none')}>
            <thead className="bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-12">{t.invoicesUi.type}</th>
                <th className="px-3 py-2 text-left font-semibold w-36">{t.invoicesUi.documentNo}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.common.date}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.invoicesUi.dueDate}</th>
                <th className="px-3 py-2 text-left font-semibold">{activeTab === 'fatura_compra' || activeTab === 'pagamento' ? t.paymentsUi.supplier : t.paymentsUi.customer}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.invoicesUi.nif}</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.common.total}</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.invoicesUi.paid}</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.invoicesUi.due}</th>
                <th className="px-3 py-2 text-center font-semibold w-20">{t.common.status}</th>
                <th className="px-3 py-2 text-left font-semibold w-16">{t.invoicesUi.origin}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredDocs.map(doc => {
                const config = DOCUMENT_TYPE_CONFIG[doc.documentType];
                const statusBadge = STATUS_BADGES[doc.status] ?? STATUS_BADGES.draft;
                if (!config) return null;
                return (
                  <tr
                    key={doc.id}
                    data-nexor-context="document-row"
                    data-nexor-id={doc.id}
                    className={cn("cursor-pointer hover:bg-accent/50 transition-colors",
                      selectedDocId === doc.id && "nexor-row-selected")}
                    onClick={() => setSelectedDocId(doc.id)}
                    onDoubleClick={() => openEditDocument(doc)}
                    onContextMenu={() => setSelectedDocId(doc.id)}
                  >
                    <td className={cn("px-3 py-1.5 font-medium", config.color)}>{config.prefix}</td>
                    <td className="px-3 py-1.5 font-mono">
                      <div>{doc.documentNumber}</div>
                      {doc.documentType === 'fatura_venda' && (
                        <div className={cn(
                          "text-[10px] font-sans mt-0.5",
                          isProvisionalInvoiceNumber(doc.documentNumber)
                            ? "text-amber-600 font-medium"
                            : "text-muted-foreground",
                        )}>
                          {isProvisionalInvoiceNumber(doc.documentNumber)
                            ? t.invoicesUi.pendingSyncOffline
                            : <>
                              {doc.paymentMethod === 'credit'
                                ? t.pos.credit
                                : doc.paymentMethod === 'card'
                                  ? t.paymentsUi.methods.card
                                  : doc.paymentMethod === 'transfer'
                                    ? t.paymentsUi.methods.transfer
                                    : t.paymentsUi.methods.cash}
                              {doc.amountDue > 0.01 ? ` · ${t.invoicesUi.due}` : doc.amountPaid >= doc.total - 0.01 ? ` · ${t.invoicesUi.paid}` : ''}
                            </>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{new Date(doc.issueDate).toLocaleDateString(locale)}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {doc.dueDate ? new Date(doc.dueDate).toLocaleDateString(locale) : '—'}
                    </td>
                    <td className="px-3 py-1.5">{doc.entityName}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{doc.entityNif || '-'}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-medium">{doc.total.toLocaleString(locale)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-green-600">{doc.amountPaid.toLocaleString(locale)}</td>
                    <td className={cn("px-3 py-1.5 text-right font-mono", doc.amountDue > 0 && "text-destructive font-medium")}>
                      {doc.amountDue.toLocaleString(locale)}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <Badge variant={statusBadge.variant} className="text-[10px] px-1.5 py-0">{statusBadge.label}</Badge>
                    </td>
                    <td className="px-3 py-1.5">
                      {doc.parentDocumentNumber ? (
                        <span className="text-[10px] text-blue-500 font-mono">{doc.parentDocumentNumber.split('-').slice(0, 2).join('-')}</span>
                      ) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted/80 border-t-2 border-primary/30">
              <tr className="font-bold text-xs">
                <td className="px-3 py-2" colSpan={6}>{t.invoicesUi.documentsTotal.replace('{count}', String(totals.count))}</td>
                <td className="px-3 py-2 text-right font-mono">{totals.total.toLocaleString(locale)} Kz</td>
                <td className="px-3 py-2 text-right font-mono text-green-600">{totals.paid.toLocaleString(locale)} Kz</td>
                <td className="px-3 py-2 text-right font-mono text-destructive">{totals.due.toLocaleString(locale)} Kz</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
          {listLoading && filteredDocs.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin opacity-70" />
              <p className="text-sm">{t.common.loading}</p>
            </div>
          )}
          {!listLoading && filteredDocs.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t.common.noResults}</p>
              <p className="text-xs mt-1">{t.common.create}</p>
            </div>
          )}
          </div>
        </div>
      </Tabs>

      {/* Selected document info bar with Document Flow */}
      {selectedDoc && DOCUMENT_TYPE_CONFIG[selectedDoc.documentType] && (
        <div className="border-t">
          <div className="h-7 bg-primary/10 flex items-center px-3 text-[10px] gap-4">
            <span className={cn("font-bold", DOCUMENT_TYPE_CONFIG[selectedDoc.documentType].color)}>
              {selectedDoc.documentNumber}
            </span>
            <span>{selectedDoc.entityName}</span>
            <span>{t.common.total}: {selectedDoc.total.toLocaleString(locale)} Kz</span>
            {selectedDoc.parentDocumentNumber && (
              <span className="text-blue-500">{t.invoicesUi.origin}: {selectedDoc.parentDocumentNumber}</span>
            )}
            {selectedDoc.childDocuments && selectedDoc.childDocuments.length > 0 && (
              <span className="text-green-600">
                {t.common.generate}: {selectedDoc.childDocuments.map(c => c.number).join(', ')}
              </span>
            )}
            {selectedDoc.documentType === 'nota_credito' && (
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto h-6 text-[10px] gap-1 px-2"
                onClick={() => navigate('/fiscal-documents', { state: { openCreditNoteId: selectedDoc.id } })}
              >
                {t.fiscalDocumentsUi.actionView}
              </Button>
            )}
            {selectedDoc.documentType === 'fatura_venda'
              && isFiscallyImmutable(selectedDoc)
              && selectedDoc.status !== 'cancelled' && (
              <div className="ml-auto flex items-center gap-1">
                {canVoidInvoice && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1 px-2 text-destructive border-destructive/40"
                    onClick={() => setVoidTarget(resolveCanonicalSaleDocument(selectedDoc, documents))}
                  >
                    <XCircle className="w-3 h-3" />
                    {t.voidInvoiceUi.action}
                  </Button>
                )}
                {canSendAgt && (() => {
                  const agtTarget = resolveCanonicalSaleDocument(selectedDoc, documents);
                  return isAgtValidated(agtTarget.agtStatus) ? (
                    <Badge variant="default" className="h-6 text-[10px] px-2">
                      {t.agtUi.agtValidatedLabel}
                      {agtTarget.agtCode ? ` · ${agtTarget.agtCode}` : ''}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 text-[10px] gap-1 px-2"
                      onClick={() => {
                        void transmitAgt('sale', agtTarget.id, {
                          documentNumber: agtTarget.documentNumber,
                          onSuccess: () => refresh(),
                        });
                      }}
                    >
                      <Send className="w-3 h-3" />
                      {t.documentFormUi.sendToAgt}
                    </Button>
                  );
                })()}
              </div>
            )}
          </div>
          {/* Document Flow Chain */}
          <DocumentFlowViewer nodes={buildFlowNodes(selectedDoc)} className="border-t bg-muted/20 px-3 py-1" />
        </div>
      )}

      <VoidInvoiceDialog
        open={!!voidTarget}
        onOpenChange={(open) => { if (!open) setVoidTarget(null); }}
        documentNumber={voidTarget?.documentNumber || ''}
        saving={voiding}
        onConfirm={async (reason) => {
          if (!voidTarget) return;
          await voidInvoice(voidTarget.id, reason, {
            documentNumber: voidTarget.documentNumber,
            onSuccess: () => {
              setVoidTarget(null);
              refresh();
            },
          });
        }}
      />

      {/* Document Form Dialog */}
      {formOpen && (
        <DocumentFormDialog
          key={`${formDocType}-${prefillDoc?.id ?? editDoc?.id ?? 'new'}`}
          open={formOpen}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) {
              // Abandoning convert must not leave a stale SO link for the next save.
              pendingSalesOrderIdRef.current = null;
              setPrefillDoc(null);
            }
          }}
          documentType={formDocType}
          editDocument={editDoc}
          prefillFrom={prefillDoc}
          onSaved={async (doc) => {
            refresh();
            const soId = pendingSalesOrderIdRef.current;
            if (soId) {
              pendingSalesOrderIdRef.current = null;
              try {
                const mark = await api.salesOrders.markInvoiced(soId, {
                  invoiceId: doc.id,
                  invoiceNumber: doc.documentNumber,
                });
                if (mark.error) {
                  toast.error(mark.error);
                } else {
                  const branchId = doc.branchId || prefillDoc?.branchId;
                  if (branchId) {
                    invalidateInventoryGridCacheForBranches([branchId]);
                  }
                  window.dispatchEvent(
                    new CustomEvent(PRODUCTS_CHANGED_EVENT, {
                      detail: { branchId: branchId || undefined },
                    }),
                  );
                }
              } catch (e) {
                console.warn('[Invoices] mark sales order invoiced failed', e);
                toast.error(e instanceof Error ? e.message : 'Failed to link sales order');
              }
            }
            setPrefillDoc(null);
          }}
        />
      )}
    </div>
  );
}
