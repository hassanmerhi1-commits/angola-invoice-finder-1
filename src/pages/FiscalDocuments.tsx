import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales, useAuth, useProducts, usePurchaseOrders } from '@/hooks/useERP';
import { 
  useCreditNotes, 
  useDebitNotes, 
  useTransportDocuments, 
  useCompanyInfo,
  useSAFTExport 
} from '@/hooks/useFiscalDocuments';
import { useSupplierReturns } from '@/hooks/useSupplierReturns';
import { SupplierReturnItem } from '@/lib/supplierReturns';
import { Sale, CreditNote, CreditNoteItem, DebitNote, DebitNoteItem, TransportDocumentItem, Product, PurchaseOrder } from '@/types/erp';
import { CreditNoteCreateDialog } from '@/components/fiscal/CreditNoteCreateDialog';
import { DebitNoteCreateDialog } from '@/components/fiscal/DebitNoteCreateDialog';
import { api } from '@/lib/api/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  FileText, 
  FileMinus, 
  FilePlus, 
  Truck, 
  Download, 
  Plus,
  Calendar,
  Building2,
  AlertCircle,
  RotateCcw,
  Package,
  CheckCircle,
  XCircle,
  Send,
} from 'lucide-react';
import { useAgtTransmit } from '@/hooks/useAgtTransmit';
import { usePermissions } from '@/hooks/usePermissions';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { enUS } from 'date-fns/locale';

export default function FiscalDocuments() {
  const { t, language } = useTranslation();
  const fd = t.fiscalDocumentsUi;
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;
  const { user } = useAuth();
  const { hasPermission } = usePermissions(user?.id);
  const canCreateCreditNote = hasPermission('credit_note_create');
  const canCreateDebitNote = hasPermission('debit_note_create');
  const canSendAgt = hasPermission('agt_send');
  const canExportSaft = hasPermission('saft_export');
  const { currentBranch, apiBranchId, branches } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  const { products } = useProducts(apiBranchId, { light: true });
  const { orders } = usePurchaseOrders(apiBranchId);
  const { creditNotes, createCreditNote, refreshCreditNotes } = useCreditNotes(apiBranchId);
  const { transmit: transmitAgt, transmitting: agtTransmitting } = useAgtTransmit();
  const { debitNotes, createDebitNote, refreshDebitNotes } = useDebitNotes(apiBranchId);
  const { transportDocs, createTransportDocument, updateTransportStatus } = useTransportDocuments(apiBranchId);
  const { supplierReturns, createSupplierReturn, approveReturn, markAsShipped, completeReturn, cancelReturn } = useSupplierReturns(apiBranchId);
  const { companyInfo, saveCompanyInfo } = useCompanyInfo();
  const { generateSAFT } = useSAFTExport();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // Dialog states
  const [creditNoteDialog, setCreditNoteDialog] = useState(false);
  const [debitNoteDialog, setDebitNoteDialog] = useState(false);
  const [transportDocDialog, setTransportDocDialog] = useState(false);
  const [supplierReturnDialog, setSupplierReturnDialog] = useState(false);
  const [saftDialog, setSaftDialog] = useState(false);
  const [companyDialog, setCompanyDialog] = useState(false);

  const [initialCreditSaleId, setInitialCreditSaleId] = useState<string | null>(null);
  const [initialDebitSaleId, setInitialDebitSaleId] = useState<string | null>(null);
  const [creditNoteSubmitting, setCreditNoteSubmitting] = useState(false);
  const [debitNoteSubmitting, setDebitNoteSubmitting] = useState(false);
  const [viewCreditNote, setViewCreditNote] = useState<CreditNote | null>(null);
  const [viewDebitNote, setViewDebitNote] = useState<DebitNote | null>(null);

  const [transportType, setTransportType] = useState<'delivery' | 'transfer' | 'return' | 'consignment'>('delivery');
  const [originAddress, setOriginAddress] = useState(currentBranch?.address || '');
  const [originCity, setOriginCity] = useState('Luanda');
  const [destAddress, setDestAddress] = useState('');
  const [destCity, setDestCity] = useState('');
  const [destNif, setDestNif] = useState('');
  const [destName, setDestName] = useState('');
  const [loadingDate, setLoadingDate] = useState(new Date().toISOString().split('T')[0]);
  const [loadingTime, setLoadingTime] = useState('08:00');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [transportItems, setTransportItems] = useState<TransportDocumentItem[]>([]);
  const [transportNotes, setTransportNotes] = useState('');

  // Supplier Return form states
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [returnReason, setReturnReason] = useState<'damaged' | 'wrong_item' | 'quality' | 'overstock' | 'other'>('damaged');
  const [returnDescription, setReturnDescription] = useState('');
  const [returnItems, setReturnItems] = useState<SupplierReturnItem[]>([]);
  const [returnNotes, setReturnNotes] = useState('');
  const [deductStock, setDeductStock] = useState(true);

  const [saftStartDate, setSaftStartDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  const [saftEndDate, setSaftEndDate] = useState(new Date().toISOString().split('T')[0]);

  const [editCompanyInfo, setEditCompanyInfo] = useState(companyInfo);
  const openCreditNoteFetchRef = useRef<string | null>(null);

  const notifyCreditNoteDenied = useCallback(() => {
    toast({
      variant: 'destructive',
      title: t.common.error,
      description: fd.creditNotePermissionDenied,
    });
  }, [toast, t.common.error, fd.creditNotePermissionDenied]);

  const openCreditNoteCreateDialog = useCallback(() => {
    if (!canCreateCreditNote) {
      notifyCreditNoteDenied();
      return;
    }
    setInitialCreditSaleId(null);
    setCreditNoteDialog(true);
  }, [canCreateCreditNote, notifyCreditNoteDenied]);

  const notifyDebitNoteDenied = useCallback(() => {
    toast({
      variant: 'destructive',
      title: t.common.error,
      description: fd.debitNotePermissionDenied,
    });
  }, [toast, t.common.error, fd.debitNotePermissionDenied]);

  const openDebitNoteCreateDialog = useCallback(() => {
    if (!canCreateDebitNote) {
      notifyDebitNoteDenied();
      return;
    }
    setInitialDebitSaleId(null);
    setDebitNoteDialog(true);
  }, [canCreateDebitNote, notifyDebitNoteDenied]);

  useEffect(() => {
    const st = location.state as {
      openSaft?: boolean;
      openCreditNoteForSaleId?: string;
      openCreditNoteId?: string;
      openCreditNoteCreate?: boolean;
      openDebitNoteCreate?: boolean;
      openDebitNoteForSaleId?: string;
    } | null;
    if (st?.openSaft) {
      setSaftDialog(true);
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }
    if (st?.openDebitNoteCreate) {
      navigate(location.pathname, { replace: true, state: {} });
      openDebitNoteCreateDialog();
      return;
    }
    if (st?.openDebitNoteForSaleId && sales.length) {
      navigate(location.pathname, { replace: true, state: {} });
      if (!canCreateDebitNote) {
        notifyDebitNoteDenied();
        return;
      }
      setInitialDebitSaleId(st.openDebitNoteForSaleId);
      setDebitNoteDialog(true);
      return;
    }
    if (st?.openCreditNoteCreate) {
      navigate(location.pathname, { replace: true, state: {} });
      if (!canCreateCreditNote) {
        notifyCreditNoteDenied();
        return;
      }
      openCreditNoteCreateDialog();
      return;
    }
    if (st?.openCreditNoteForSaleId && sales.length) {
      navigate(location.pathname, { replace: true, state: {} });
      if (!canCreateCreditNote) {
        notifyCreditNoteDenied();
        return;
      }
      const sale = sales.find((s) => s.id === st.openCreditNoteForSaleId);
      if (sale) {
        setInitialCreditSaleId(sale.id);
        setCreditNoteDialog(true);
      }
    }
  }, [
    location.state,
    location.pathname,
    navigate,
    sales,
    canCreateCreditNote,
    canCreateDebitNote,
    notifyCreditNoteDenied,
    notifyDebitNoteDenied,
    openCreditNoteCreateDialog,
    openDebitNoteCreateDialog,
  ]);

  useEffect(() => {
    const st = location.state as {
      openCreditNoteId?: string;
      openCreditNoteNumber?: string;
    } | null;
    const openId = st?.openCreditNoteId;
    const openNumber = st?.openCreditNoteNumber;
    if (!openId && !openNumber) {
      openCreditNoteFetchRef.current = null;
      return;
    }
    const lookupKey = openId || openNumber || '';
    const note = openId
      ? creditNotes.find((n) => n.id === openId)
      : creditNotes.find((n) => n.documentNumber === openNumber);
    if (note) {
      setViewCreditNote(note);
      openCreditNoteFetchRef.current = null;
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }
    if (openCreditNoteFetchRef.current === lookupKey) return;
    openCreditNoteFetchRef.current = lookupKey;
    void refreshCreditNotes();
  }, [location.state, creditNotes, location.pathname, navigate, refreshCreditNotes]);

  // Received POs for supplier returns
  const receivedOrders = orders.filter(o => o.status === 'received' || o.status === 'partial');

  const resolveSaleBranch = (sale: Sale) => {
    const saleBranchId = sale.branchId || currentBranch?.id;
    const saleBranch = branches.find((b) => b.id === saleBranchId) || currentBranch;
    if (!saleBranchId || !saleBranch) return null;
    return { id: saleBranchId, code: saleBranch.code, name: saleBranch.name };
  };

  const handleCreateCreditNote = async (payload: {
    sale: Sale;
    reason: CreditNote['reason'];
    description: string;
    items: CreditNoteItem[];
    restoreStock: boolean;
  }) => {
    const { sale: selectedSale, reason: creditReason, description: creditDescription, items: creditItems, restoreStock } = payload;
    if (!selectedSale || !user) return;
    if (!canCreateCreditNote) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: t.auditTrailUi.permissionDenied,
      });
      return;
    }
    const saleBranch = resolveSaleBranch(selectedSale);
    if (!saleBranch) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: t.fiscalDocumentsUi.documentIssuedSuccess,
      });
      return;
    }

    setCreditNoteSubmitting(true);
    try {
      const note = await createCreditNote(
        saleBranch.id,
        saleBranch.code,
        selectedSale,
        creditReason,
        creditDescription,
        creditItems,
        user.id,
        restoreStock,
        saleBranch.name,
      );
      toast({
        title: t.fiscalDocumentsUi.creditNoteCreatedTitle,
        description: t.fiscalDocumentsUi.documentIssuedSuccess,
      });
      setCreditNoteDialog(false);
      setInitialCreditSaleId(null);
      setViewCreditNote(note);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : t.fiscalDocumentsUi.documentIssuedSuccess,
      });
      throw err;
    } finally {
      setCreditNoteSubmitting(false);
    }
  };

  const handleTransmitCreditNote = async (note: CreditNote) => {
    try {
      const data = await transmitAgt('credit_note', note.id, {
        onSuccess: () => refreshCreditNotes(),
      });
      if (data?.agtCode || data?.agtStatus) {
        setViewCreditNote((prev) => (prev?.id === note.id ? {
          ...prev,
          agtCode: data.agtCode ?? prev.agtCode,
          agtStatus: (data.agtStatus as CreditNote['agtStatus']) ?? prev.agtStatus,
        } : prev));
      }
      await refreshCreditNotes();
      const res = await api.fiscalDocuments.listCreditNotes(apiBranchId);
      const updated = (res.data || []).find((n: CreditNote) => n.id === note.id);
      if (updated) setViewCreditNote(updated);
    } catch {
      /* toast handled in hook */
    }
  };

  const handleCreateDebitNote = async (payload: {
    sale: Sale;
    reason: DebitNote['reason'];
    description: string;
    items: DebitNoteItem[];
  }) => {
    if (!currentBranch || !user) return;

    setDebitNoteSubmitting(true);
    try {
      await createDebitNote(
        currentBranch.id,
        currentBranch.code,
        payload.sale,
        payload.reason,
        payload.description,
        payload.items,
        user.id,
        payload.sale.customerNif,
        payload.sale.customerName,
      );
      toast({
        title: t.fiscalDocumentsUi.debitNoteCreatedTitle,
        description: t.fiscalDocumentsUi.documentIssuedSuccess,
      });
      setDebitNoteDialog(false);
      setInitialDebitSaleId(null);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : t.fiscalDocumentsUi.documentIssuedSuccess,
      });
      throw err;
    } finally {
      setDebitNoteSubmitting(false);
    }
  };

  const handleTransmitDebitNote = async (note: DebitNote) => {
    try {
      const data = await transmitAgt('debit_note', note.id, {
        onSuccess: () => refreshDebitNotes(),
      });
      if (data?.agtCode || data?.agtStatus) {
        setViewDebitNote((prev) => (prev?.id === note.id ? {
          ...prev,
          agtCode: data.agtCode ?? prev.agtCode,
          agtStatus: (data.agtStatus as DebitNote['agtStatus']) ?? prev.agtStatus,
        } : prev));
      }
      await refreshDebitNotes();
      const res = await api.fiscalDocuments.listDebitNotes(apiBranchId);
      const updated = (res.data || []).find((n: DebitNote) => n.id === note.id);
      if (updated) setViewDebitNote(updated);
    } catch {
      /* toast handled in hook */
    }
  };

  const handleAddProductToTransport = (product: Product) => {
    if (transportItems.find(i => i.productId === product.id)) return;
    setTransportItems([...transportItems, {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      quantity: 1,
      unit: product.unit,
    }]);
  };

  const handleCreateTransportDoc = async () => {
    if (!currentBranch || !user || transportItems.length === 0) return;

    try {
      await createTransportDocument(
        currentBranch.id,
        currentBranch.code,
        transportType,
        originAddress,
        originCity,
        destAddress,
        destCity,
        loadingDate,
        loadingTime,
        transportItems,
        user.id,
        {
          destinationNif: destNif,
          destinationName: destName,
          vehiclePlate,
          transporterName,
          notes: transportNotes,
        },
      );

      toast({
        title: t.fiscalDocumentsUi.transportDocCreatedTitle,
        description: t.fiscalDocumentsUi.documentIssuedSuccess,
      });

      setTransportDocDialog(false);
      resetTransportForm();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : t.fiscalDocumentsUi.documentIssuedSuccess,
      });
    }
  };

  const handleExportSAFT = async () => {
    if (!user) return;

    try {
      await generateSAFT(saftStartDate, saftEndDate, user.id, currentBranch?.id);
      toast({
        title: t.fiscalDocumentsUi.saftExportedTitle,
        description: t.fiscalDocumentsUi.xmlDownloaded,
      });
      setSaftDialog(false);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : t.fiscalDocumentsUi.saftExportedTitle,
      });
    }
  };

  const handleSaveCompanyInfo = () => {
    saveCompanyInfo(editCompanyInfo);
    api.companySettings.save(editCompanyInfo).catch(() => {});
    toast({
      title: t.fiscalDocumentsUi.companyInfoUpdatedTitle,
      description: t.fiscalDocumentsUi.companyInfoSavedSuccess,
    });
    setCompanyDialog(false);
  };

  const resetTransportForm = () => {
    setTransportType('delivery');
    setOriginAddress(currentBranch?.address || '');
    setOriginCity('Luanda');
    setDestAddress('');
    setDestCity('');
    setDestNif('');
    setDestName('');
    setLoadingDate(new Date().toISOString().split('T')[0]);
    setLoadingTime('08:00');
    setVehiclePlate('');
    setTransporterName('');
    setTransportItems([]);
    setTransportNotes('');
  };

  // Supplier Return handlers
  const handleSelectPOForReturn = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setReturnItems(po.items.map(item => ({
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      quantity: 0,
      unitCost: item.unitCost,
      taxRate: item.taxRate,
      taxAmount: 0,
      subtotal: 0,
    })));
  };

  const updateReturnItemQuantity = (productId: string, quantity: number) => {
    setReturnItems(prev => prev.map(item => {
      if (item.productId === productId) {
        const subtotal = quantity * item.unitCost;
        const taxAmount = subtotal * (item.taxRate / 100);
        return { ...item, quantity, subtotal, taxAmount };
      }
      return item;
    }));
  };

  const handleCreateSupplierReturn = async () => {
    if (!selectedPO || !currentBranch || !user) return;

    const itemsToReturn = returnItems.filter((i) => i.quantity > 0);
    if (itemsToReturn.length === 0) {
      toast({
        title: t.common.error,
        description: t.fiscalDocumentsUi.selectAtLeastOneItemToReturn,
        variant: 'destructive',
      });
      return;
    }

    try {
      await createSupplierReturn(
        currentBranch.id,
        currentBranch.code || currentBranch.name?.slice(0, 4).toUpperCase() || 'SEDE',
        selectedPO,
        returnReason,
        returnDescription,
        itemsToReturn,
        user.id,
        returnNotes,
        deductStock,
      );

      toast({
        title: t.fiscalDocumentsUi.supplierReturnCreatedTitle,
        description: t.fiscalDocumentsUi.supplierReturnCreatedSuccess,
      });

      setSupplierReturnDialog(false);
      resetSupplierReturnForm();
    } catch (error) {
      toast({
        title: t.common.error,
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const openPurchaseInvoiceReturns = () => {
    navigate('/purchase-invoices', { state: { openReturns: true } });
  };

  const resetSupplierReturnForm = () => {
    setSelectedPO(null);
    setReturnReason('damaged');
    setReturnDescription('');
    setReturnItems([]);
    setReturnNotes('');
    setDeductStock(true);
  };

  const getReturnStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="secondary">{fd.returnStatusPending}</Badge>;
      case 'approved': return <Badge variant="default">{fd.returnStatusApproved}</Badge>;
      case 'shipped': return <Badge className="bg-blue-500">{fd.returnStatusShipped}</Badge>;
      case 'completed': return <Badge className="bg-green-500">{fd.returnStatusCompleted}</Badge>;
      case 'cancelled': return <Badge variant="destructive">{fd.returnStatusCancelled}</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getDebitReasonLabel = (reason: DebitNote['reason']) => {
    if (reason === 'price_adjustment') return t.fiscalDocumentsUi.debitReasonPriceAdjustmentShort;
    if (reason === 'additional_charge') return t.fiscalDocumentsUi.debitReasonAdditionalChargeShort;
    if (reason === 'interest') return t.fiscalDocumentsUi.debitReasonInterestShort;
    return t.fiscalDocumentsUi.other;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t.nav.fiscalDocuments}</h1>
          <p className="text-muted-foreground">
            {fd.pageSubtitle}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="modern-outline" size="lg" onClick={() => setCompanyDialog(true)}>
            <Building2 />
            {fd.companyDataBtn}
          </Button>
          {canExportSaft && (
          <Button variant="modern" size="lg" onClick={() => setSaftDialog(true)}>
            <Download />
            {fd.exportSaftBtn}
          </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{fd.statCreditNotes}</CardTitle>
            <FileMinus className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{creditNotes.length}</div>
            <p className="text-xs text-muted-foreground">
              {fd.kzTotal.replace('{amount}', creditNotes.reduce((sum, n) => sum + n.total, 0).toLocaleString(uiLocale))}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{fd.statDebitNotes}</CardTitle>
            <FilePlus className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{debitNotes.length}</div>
            <p className="text-xs text-muted-foreground">
              {fd.kzTotal.replace('{amount}', debitNotes.reduce((sum, n) => sum + n.total, 0).toLocaleString(uiLocale))}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{fd.statTransport}</CardTitle>
            <Truck className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{transportDocs.length}</div>
            <p className="text-xs text-muted-foreground">
              {fd.inTransit.replace('{count}', String(transportDocs.filter(d => d.status === 'in_transit').length))}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{fd.statSupplierReturns}</CardTitle>
            <RotateCcw className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{supplierReturns.length}</div>
            <p className="text-xs text-muted-foreground">
              {fd.kzTotal.replace('{amount}', supplierReturns.reduce((sum, r) => sum + r.total, 0).toLocaleString(uiLocale))}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{fd.statTotalInvoices}</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sales.length}</div>
            <p className="text-xs text-muted-foreground">
              {sales.reduce((sum, s) => sum + s.total, 0).toLocaleString(uiLocale)} Kz
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="credit" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="credit">
            <FileMinus className="w-4 h-4 mr-2" />
            {fd.tabCreditNotes}
          </TabsTrigger>
          <TabsTrigger value="debit">
            <FilePlus className="w-4 h-4 mr-2" />
            {fd.tabDebitNotes}
          </TabsTrigger>
          <TabsTrigger value="supplier-returns">
            <RotateCcw className="w-4 h-4 mr-2" />
            {fd.tabSupplierReturns}
          </TabsTrigger>
          <TabsTrigger value="transport">
            <Truck className="w-4 h-4 mr-2" />
            {fd.tabTransport}
          </TabsTrigger>
        </TabsList>

        {/* Credit Notes Tab */}
        <TabsContent value="credit" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{fd.creditNotesTitle}</CardTitle>
                <CardDescription>{fd.creditNotesDesc}</CardDescription>
              </div>
              {canCreateCreditNote && (
              <Button variant="modern" size="lg" onClick={openCreditNoteCreateDialog}>
                <Plus />
                {fd.newCreditNote}
              </Button>
              )}
            </CardHeader>
            <CardContent>
              {creditNotes.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileMinus className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p>{fd.noCreditNotes}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                <Table className="min-w-[960px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{fd.colDocNumber}</TableHead>
                      <TableHead>{fd.colDate}</TableHead>
                      <TableHead>{fd.colOriginalInvoice}</TableHead>
                      <TableHead>{fd.colReason}</TableHead>
                      <TableHead>{fd.colCustomer}</TableHead>
                      <TableHead className="text-right">{fd.colTotal}</TableHead>
                      <TableHead>{fd.colRestoreStock}</TableHead>
                      <TableHead>AGT</TableHead>
                      <TableHead>{fd.colStatus}</TableHead>
                      <TableHead className="text-right">{fd.colActions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditNotes.map(note => (
                      <TableRow
                        key={note.id}
                        className="hover:bg-muted/50"
                      >
                        <TableCell
                          className="font-medium cursor-pointer"
                          onClick={() => setViewCreditNote(note)}
                        >
                          {note.documentNumber}
                        </TableCell>
                        <TableCell
                          className="cursor-pointer"
                          onClick={() => setViewCreditNote(note)}
                        >
                          {format(new Date(note.createdAt), 'dd/MM/yyyy HH:mm', { locale: dfLocale })}
                        </TableCell>
                        <TableCell
                          className="cursor-pointer"
                          onClick={() => setViewCreditNote(note)}
                        >
                          {note.originalInvoiceNumber}
                        </TableCell>
                        <TableCell
                          className="cursor-pointer"
                          onClick={() => setViewCreditNote(note)}
                        >
                          <Badge variant="outline">
                            {note.reason === 'return' ? t.fiscalDocumentsUi.creditReasonReturn :
                             note.reason === 'discount' ? t.fiscalDocumentsUi.creditReasonDiscount :
                             note.reason === 'error' ? t.fiscalDocumentsUi.creditReasonError :
                             t.fiscalDocumentsUi.other}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className="cursor-pointer"
                          onClick={() => setViewCreditNote(note)}
                        >
                          {note.customerName || t.fiscalDocumentsUi.finalConsumer}
                        </TableCell>
                        <TableCell
                          className="text-right font-bold cursor-pointer"
                          onClick={() => setViewCreditNote(note)}
                        >
                          {note.total.toLocaleString(uiLocale)} Kz
                        </TableCell>
                        <TableCell
                          className="cursor-pointer"
                          onClick={() => setViewCreditNote(note)}
                        >
                          {note.restoreStock !== false ? (
                            <Badge variant="outline" className="text-green-700 border-green-600">
                              <RotateCcw className="w-3 h-3 mr-1" />
                              {fd.restoreStockYes}
                            </Badge>
                          ) : (
                            <Badge variant="outline">{fd.restoreStockNo}</Badge>
                          )}
                        </TableCell>
                        <TableCell
                          className="cursor-pointer"
                          onClick={() => setViewCreditNote(note)}
                        >
                          <Badge variant={note.agtStatus === 'validated' ? 'default' : 'outline'}>
                            {note.agtStatus === 'validated' ? t.agtUi.agtValidatedLabel : (note.agtStatus || '—')}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className="cursor-pointer"
                          onClick={() => setViewCreditNote(note)}
                        >
                          <Badge variant={note.status === 'issued' ? 'default' : 'destructive'}>
                            {note.status === 'issued' ? t.fiscalDocumentsUi.statusIssued : t.fiscalDocumentsUi.statusCancelled}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setViewCreditNote(note)}
                            >
                              {fd.actionView}
                            </Button>
                            {canSendAgt && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              disabled={agtTransmitting || note.agtStatus === 'validated'}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleTransmitCreditNote(note);
                              }}
                            >
                              <Send className="h-3 w-3" />
                              {fd.actionSendAgt}
                            </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Debit Notes Tab */}
        <TabsContent value="debit" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{fd.debitNotesTitle}</CardTitle>
                <CardDescription>{fd.debitNotesDesc}</CardDescription>
              </div>
              <Button variant="modern" size="lg" onClick={openDebitNoteCreateDialog}>
                <Plus />
                {fd.newDebitNote}
              </Button>
            </CardHeader>
            <CardContent>
              {debitNotes.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FilePlus className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p>{fd.noDebitNotes}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{fd.colDocNumber}</TableHead>
                      <TableHead>{fd.colDate}</TableHead>
                      <TableHead>{fd.colRefInvoice}</TableHead>
                      <TableHead>{fd.colReason}</TableHead>
                      <TableHead>{fd.colCustomer}</TableHead>
                      <TableHead className="text-right">{fd.colTotal}</TableHead>
                      <TableHead>{fd.colStatus}</TableHead>
                      <TableHead>{fd.colActions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debitNotes.map(note => (
                      <TableRow key={note.id}>
                        <TableCell className="font-medium">{note.documentNumber}</TableCell>
                        <TableCell>{format(new Date(note.createdAt), 'dd/MM/yyyy HH:mm', { locale: dfLocale })}</TableCell>
                        <TableCell>{note.originalInvoiceNumber || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {getDebitReasonLabel(note.reason)}
                          </Badge>
                        </TableCell>
                        <TableCell>{note.customerName || t.fiscalDocumentsUi.finalConsumer}</TableCell>
                        <TableCell className="text-right font-bold">{note.total.toLocaleString(uiLocale)} Kz</TableCell>
                        <TableCell>
                          <Badge variant={note.status === 'issued' ? 'default' : 'destructive'}>
                            {note.status === 'issued' ? t.fiscalDocumentsUi.statusIssued : t.fiscalDocumentsUi.statusCancelled}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => setViewDebitNote(note)}>
                            {fd.actionView}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Supplier Returns Tab */}
        <TabsContent value="supplier-returns" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{fd.supplierReturnsTitle}</CardTitle>
                <CardDescription>{fd.supplierReturnsDesc}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="lg" onClick={openPurchaseInvoiceReturns}>
                  <FileText className="h-4 w-4" />
                  {fd.openPurchaseReturns}
                </Button>
                <Button variant="modern" size="lg" onClick={() => setSupplierReturnDialog(true)}>
                  <Plus />
                  {fd.newSupplierReturn}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {supplierReturns.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <RotateCcw className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p>{fd.noSupplierReturnsRegistered}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{fd.colReturnNumber}</TableHead>
                      <TableHead>{fd.colDate}</TableHead>
                      <TableHead>{fd.colOriginOrder}</TableHead>
                      <TableHead>{fd.colSupplier}</TableHead>
                      <TableHead>{fd.colReason}</TableHead>
                      <TableHead className="text-right">{fd.colTotal}</TableHead>
                      <TableHead>{fd.colStatus}</TableHead>
                      <TableHead>{fd.colActions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplierReturns.map(ret => (
                      <TableRow key={ret.id}>
                        <TableCell className="font-medium">{ret.returnNumber}</TableCell>
                        <TableCell>{format(new Date(ret.createdAt), 'dd/MM/yyyy', { locale: pt })}</TableCell>
                        <TableCell>{ret.purchaseOrderNumber}</TableCell>
                        <TableCell>{ret.supplierName}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {ret.reason === 'damaged' ? fd.returnReasonDamaged :
                             ret.reason === 'wrong_item' ? fd.returnReasonWrongItem :
                             ret.reason === 'quality' ? fd.returnReasonQuality :
                             ret.reason === 'overstock' ? fd.returnReasonOverstock : fd.other}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold">{ret.total.toLocaleString(uiLocale)} Kz</TableCell>
                        <TableCell>{getReturnStatusBadge(ret.status)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {ret.status === 'pending' && (
                              <>
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => approveReturn(ret.id, user?.id || '')}
                                  title={fd.actionApprove}
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => cancelReturn(ret.id, user?.id || '')}
                                  title={fd.actionCancel}
                                >
                                  <XCircle className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                            {ret.status === 'approved' && (
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => markAsShipped(ret.id)}
                                title={fd.actionMarkShipped}
                              >
                                <Truck className="w-4 h-4" />
                              </Button>
                            )}
                            {ret.status === 'shipped' && (
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => completeReturn(ret.id)}
                                title={fd.actionComplete}
                              >
                                <CheckCircle className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transport Documents Tab */}
        <TabsContent value="transport" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{fd.transportTitle}</CardTitle>
                <CardDescription>{fd.transportDesc}</CardDescription>
              </div>
              <Button variant="modern" size="lg" onClick={() => setTransportDocDialog(true)}>
                <Plus />
                {fd.newTransportShort}
              </Button>
            </CardHeader>
            <CardContent>
              {transportDocs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Truck className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p>{fd.noTransport}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{fd.colDocNumber}</TableHead>
                      <TableHead>{fd.colType}</TableHead>
                      <TableHead>{fd.colLoadingDate}</TableHead>
                      <TableHead>{fd.colOrigin}</TableHead>
                      <TableHead>{fd.colDestination}</TableHead>
                      <TableHead>{fd.colItems}</TableHead>
                      <TableHead>{fd.colStatus}</TableHead>
                      <TableHead>{fd.colActions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transportDocs.map(doc => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium">{doc.documentNumber}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {doc.type === 'delivery' ? t.fiscalDocumentsUi.transportTypeDelivery :
                             doc.type === 'transfer' ? t.fiscalDocumentsUi.transportTypeTransfer :
                             doc.type === 'return' ? t.fiscalDocumentsUi.transportTypeReturn :
                             t.fiscalDocumentsUi.transportTypeConsignment}
                          </Badge>
                        </TableCell>
                        <TableCell>{doc.loadingDate} {doc.loadingTime}</TableCell>
                        <TableCell>{doc.originCity}</TableCell>
                        <TableCell>{doc.destinationCity}</TableCell>
                        <TableCell>{doc.items.length} produtos</TableCell>
                        <TableCell>
                          <Badge variant={
                            doc.status === 'delivered' ? 'default' : 
                            doc.status === 'in_transit' ? 'secondary' :
                            doc.status === 'cancelled' ? 'destructive' : 'outline'
                          }>
                            {doc.status === 'issued' ? t.fiscalDocumentsUi.statusIssued :
                             doc.status === 'in_transit' ? t.fiscalDocumentsUi.statusInTransit :
                             doc.status === 'delivered' ? t.fiscalDocumentsUi.statusDelivered :
                             t.fiscalDocumentsUi.statusCancelled}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {doc.status === 'issued' && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => updateTransportStatus(doc.id, 'in_transit')}
                            >
                              {t.fiscalDocumentsUi.start}
                            </Button>
                          )}
                          {doc.status === 'in_transit' && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => updateTransportStatus(doc.id, 'delivered')}
                            >
                              {t.fiscalDocumentsUi.deliver}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Credit Note Detail (read-only) */}
      <Dialog open={!!viewCreditNote} onOpenChange={(open) => !open && setViewCreditNote(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-3">
            <DialogTitle>{fd.creditNoteDetailTitle}</DialogTitle>
            <DialogDescription>{fd.creditNoteImmutableHint}</DialogDescription>
          </DialogHeader>

          {viewCreditNote && (
            <div className="px-6 pb-4 border-b bg-muted/40 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {canSendAgt && (
                <Button
                  className="gap-2"
                  disabled={agtTransmitting || viewCreditNote.agtStatus === 'validated'}
                  onClick={() => void handleTransmitCreditNote(viewCreditNote)}
                >
                  <Send className="h-4 w-4" />
                  {viewCreditNote.agtStatus === 'validated' ? t.agtUi.agtValidatedLabel : fd.actionSendAgt}
                </Button>
                )}
                {viewCreditNote.agtCode && (
                  <Badge variant="default" className="font-mono">
                    CUCE: {viewCreditNote.agtCode}
                  </Badge>
                )}
                {viewCreditNote.agtStatus && (
                  <Badge variant="outline">
                    AGT: {viewCreditNote.agtStatus === 'validated' ? t.agtUi.agtValidatedLabel : viewCreditNote.agtStatus}
                  </Badge>
                )}
              </div>
              <div
                className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                  viewCreditNote.restoreStock !== false
                    ? 'border-green-500/40 bg-green-500/10'
                    : 'border-muted bg-muted/30'
                }`}
              >
                <RotateCcw className="h-5 w-5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">{fd.colRestoreStock}</p>
                  <p className="text-muted-foreground text-xs">
                    {viewCreditNote.restoreStock !== false ? fd.stockWillBeRestored : fd.stockWillNotBeRestored}
                  </p>
                </div>
                <Badge variant={viewCreditNote.restoreStock !== false ? 'default' : 'outline'}>
                  {viewCreditNote.restoreStock !== false ? fd.restoreStockYes : fd.restoreStockNo}
                </Badge>
              </div>
            </div>
          )}

          {viewCreditNote && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground">{fd.colDocNumber}</p>
                  <p className="font-medium">{viewCreditNote.documentNumber}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{fd.colOriginalInvoice}</p>
                  <p className="font-medium">{viewCreditNote.originalInvoiceNumber}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{fd.colTotal}</p>
                  <p className="font-medium">{viewCreditNote.total.toLocaleString(uiLocale)} Kz</p>
                </div>
                {viewCreditNote.saftHash && (
                  <div>
                    <p className="text-muted-foreground">Hash</p>
                    <p className="font-mono text-xs break-all">{viewCreditNote.saftHash}</p>
                  </div>
                )}
              </div>
              {viewCreditNote.reasonDescription && (
                <div>
                  <p className="text-muted-foreground">{t.common.description}</p>
                  <p>{viewCreditNote.reasonDescription}</p>
                </div>
              )}
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{fd.colProduct}</TableHead>
                      <TableHead className="text-right">{fd.colQty}</TableHead>
                      <TableHead className="text-right">{fd.colTotal}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewCreditNote.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{item.productName}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          {(item.subtotal + item.taxAmount).toLocaleString(uiLocale)} Kz
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter className="px-6 py-4 border-t">
            <Button variant="outline" onClick={() => setViewCreditNote(null)}>
              {t.common.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreditNoteCreateDialog
        open={creditNoteDialog && canCreateCreditNote}
        initialSaleId={initialCreditSaleId}
        sales={sales}
        creditNotes={creditNotes}
        branchId={apiBranchId}
        submitting={creditNoteSubmitting}
        onOpenChange={(open) => {
          if (open && !canCreateCreditNote) {
            notifyCreditNoteDenied();
            return;
          }
          setCreditNoteDialog(open);
          if (!open) setInitialCreditSaleId(null);
        }}
        onSubmit={handleCreateCreditNote}
      />

      <DebitNoteCreateDialog
        open={debitNoteDialog && canCreateDebitNote}
        initialSaleId={initialDebitSaleId}
        sales={sales}
        debitNotes={debitNotes}
        submitting={debitNoteSubmitting}
        onOpenChange={(open) => {
          if (open && !canCreateDebitNote) {
            notifyDebitNoteDenied();
            return;
          }
          setDebitNoteDialog(open);
          if (!open) setInitialDebitSaleId(null);
        }}
        onSubmit={handleCreateDebitNote}
      />

      {/* Debit Note Detail (read-only) */}
      <Dialog open={!!viewDebitNote} onOpenChange={(open) => !open && setViewDebitNote(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-3">
            <DialogTitle>{fd.debitNoteDetailTitle}</DialogTitle>
            <DialogDescription>{fd.debitNoteImmutableHint}</DialogDescription>
          </DialogHeader>

          {viewDebitNote && (
            <div className="px-6 pb-4 border-b bg-muted/40 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {canSendAgt && (
                  <Button
                    className="gap-2"
                    disabled={agtTransmitting || viewDebitNote.agtStatus === 'validated'}
                    onClick={() => void handleTransmitDebitNote(viewDebitNote)}
                  >
                    <Send className="h-4 w-4" />
                    {viewDebitNote.agtStatus === 'validated' ? t.agtUi.agtValidatedLabel : fd.actionSendAgt}
                  </Button>
                )}
                {viewDebitNote.agtCode && (
                  <Badge variant="default" className="font-mono">
                    CUCE: {viewDebitNote.agtCode}
                  </Badge>
                )}
                {viewDebitNote.agtStatus && (
                  <Badge variant="outline">
                    AGT: {viewDebitNote.agtStatus === 'validated' ? t.agtUi.agtValidatedLabel : viewDebitNote.agtStatus}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {viewDebitNote && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground">{fd.colDocNumber}</p>
                  <p className="font-medium">{viewDebitNote.documentNumber}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{fd.colOriginalInvoice}</p>
                  <p className="font-medium">{viewDebitNote.originalInvoiceNumber || '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{fd.colCustomer}</p>
                  <p className="font-medium">{viewDebitNote.customerName || fd.finalConsumer}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{fd.colReason}</p>
                  <p className="font-medium">{getDebitReasonLabel(viewDebitNote.reason)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{fd.colTotal}</p>
                  <p className="font-medium">{viewDebitNote.total.toLocaleString(uiLocale)} Kz</p>
                </div>
                {viewDebitNote.saftHash && (
                  <div>
                    <p className="text-muted-foreground">Hash</p>
                    <p className="font-mono text-xs break-all">{viewDebitNote.saftHash}</p>
                  </div>
                )}
              </div>
              {viewDebitNote.reasonDescription && (
                <div>
                  <p className="text-muted-foreground">{t.common.description}</p>
                  <p>{viewDebitNote.reasonDescription}</p>
                </div>
              )}
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{fd.colProduct}</TableHead>
                      <TableHead className="text-right">{fd.colQty}</TableHead>
                      <TableHead className="text-right">{fd.colUnitPrice}</TableHead>
                      <TableHead className="text-right">{fd.colTaxRate}</TableHead>
                      <TableHead className="text-right">{fd.colTotal}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewDebitNote.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{item.description}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">{item.unitPrice.toLocaleString(uiLocale)}</TableCell>
                        <TableCell className="text-right">{item.taxRate}%</TableCell>
                        <TableCell className="text-right">
                          {(item.subtotal + item.taxAmount).toLocaleString(uiLocale)} Kz
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter className="px-6 py-4 border-t">
            <Button variant="outline" onClick={() => setViewDebitNote(null)}>
              {t.common.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transport Document Dialog */}
      <Dialog open={transportDocDialog} onOpenChange={setTransportDocDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{fd.newTransportTitle}</DialogTitle>
            <DialogDescription>{fd.newTransportSubtitle}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{fd.transportTypeLabel}</Label>
                <Select value={transportType} onValueChange={(v: any) => setTransportType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delivery">{fd.transportTypeDeliveryFull}</SelectItem>
                    <SelectItem value="transfer">{fd.transportTypeTransferFull}</SelectItem>
                    <SelectItem value="return">{fd.transportTypeReturnFull}</SelectItem>
                    <SelectItem value="consignment">{t.fiscalDocumentsUi.transportTypeConsignment}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{fd.vehiclePlateLabel}</Label>
                <Input 
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value)}
                  placeholder={fd.vehiclePlatePlaceholder}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                <h4 className="font-medium">{fd.originTitle}</h4>
                <div className="space-y-2">
                  <Label>{fd.addressLabel}</Label>
                  <Input value={originAddress} onChange={(e) => setOriginAddress(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{fd.cityLabel}</Label>
                  <Input value={originCity} onChange={(e) => setOriginCity(e.target.value)} />
                </div>
              </div>
              <div className="space-y-4">
                <h4 className="font-medium">{fd.destinationTitle}</h4>
                <div className="space-y-2">
                  <Label>{fd.addressLabel}</Label>
                  <Input value={destAddress} onChange={(e) => setDestAddress(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{fd.cityLabel}</Label>
                  <Input value={destCity} onChange={(e) => setDestCity(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label>{fd.destNifLabel}</Label>
                    <Input value={destNif} onChange={(e) => setDestNif(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{fd.nameLabel}</Label>
                    <Input value={destName} onChange={(e) => setDestName(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{fd.loadingDateLabel}</Label>
                <Input 
                  type="date"
                  value={loadingDate}
                  onChange={(e) => setLoadingDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{fd.loadingTimeLabel}</Label>
                <Input 
                  type="time"
                  value={loadingTime}
                  onChange={(e) => setLoadingTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{fd.transporterLabel}</Label>
              <Input 
                value={transporterName}
                onChange={(e) => setTransporterName(e.target.value)}
                placeholder={fd.transporterPlaceholder}
              />
            </div>

            <div className="space-y-2">
              <Label>{fd.productsToTransport}</Label>
              <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto border rounded p-2">
                {products.map(product => (
                  <Button
                    key={product.id}
                    variant={transportItems.find(i => i.productId === product.id) ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => handleAddProductToTransport(product)}
                  >
                    {product.name}
                  </Button>
                ))}
              </div>
              {transportItems.length > 0 && (
                <div className="border rounded-lg mt-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{fd.colProduct}</TableHead>
                        <TableHead>{fd.colSku}</TableHead>
                        <TableHead className="text-right">{fd.colQuantity}</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transportItems.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{item.productName}</TableCell>
                          <TableCell>{item.sku}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => {
                                const updated = [...transportItems];
                                updated[idx].quantity = parseInt(e.target.value) || 1;
                                setTransportItems(updated);
                              }}
                              className="w-20 text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setTransportItems(transportItems.filter((_, i) => i !== idx))}
                            >
                              ✕
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{fd.notesLabel}</Label>
              <Textarea 
                value={transportNotes}
                onChange={(e) => setTransportNotes(e.target.value)}
                placeholder={fd.additionalNotesPlaceholder}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setTransportDocDialog(false); resetTransportForm(); }}>
              {t.common.cancel}
            </Button>
            <Button 
              onClick={handleCreateTransportDoc}
              disabled={transportItems.length === 0 || !destAddress}
            >
              {fd.issueTransport}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SAF-T Export Dialog */}
      <Dialog open={saftDialog} onOpenChange={setSaftDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{fd.exportSaftTitle}</DialogTitle>
            <DialogDescription>{fd.exportSaftSubtitle}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm">{fd.saftWarning}</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{fd.startDateLabel}</Label>
                <Input 
                  type="date"
                  value={saftStartDate}
                  onChange={(e) => setSaftStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{fd.endDateLabel}</Label>
                <Input 
                  type="date"
                  value={saftEndDate}
                  onChange={(e) => setSaftEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="p-3 bg-muted rounded-lg text-sm">
              <p><strong>{fd.companyLabel}</strong> {companyInfo.name}</p>
              <p><strong>NIF:</strong> {companyInfo.nif}</p>
              <p><strong>{fd.branchLabel}</strong> {currentBranch?.name || fd.allBranches}</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSaftDialog(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleExportSAFT}>
              <Download className="w-4 h-4 mr-2" />
              {fd.exportXml}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Company Info Dialog */}
      <Dialog open={companyDialog} onOpenChange={setCompanyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{fd.companyDialogTitle}</DialogTitle>
            <DialogDescription>{fd.companyDialogSubtitle}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{fd.companyNameLabel}</Label>
                <Input 
                  value={editCompanyInfo.name}
                  onChange={(e) => setEditCompanyInfo({...editCompanyInfo, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>NIF</Label>
                <Input 
                  value={editCompanyInfo.nif}
                  onChange={(e) => setEditCompanyInfo({...editCompanyInfo, nif: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{fd.addressLabel}</Label>
              <Input 
                value={editCompanyInfo.address}
                onChange={(e) => setEditCompanyInfo({...editCompanyInfo, address: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input 
                  value={editCompanyInfo.city}
                  onChange={(e) => setEditCompanyInfo({...editCompanyInfo, city: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>{fd.postalCodeLabel}</Label>
                <Input 
                  value={editCompanyInfo.postalCode}
                  onChange={(e) => setEditCompanyInfo({...editCompanyInfo, postalCode: e.target.value})}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{fd.phoneLabel}</Label>
                <Input 
                  value={editCompanyInfo.phone}
                  onChange={(e) => setEditCompanyInfo({...editCompanyInfo, phone: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>{fd.emailLabel}</Label>
                <Input 
                  value={editCompanyInfo.email}
                  onChange={(e) => setEditCompanyInfo({...editCompanyInfo, email: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Código CAE</Label>
              <Input 
                value={editCompanyInfo.activityCode}
                onChange={(e) => setEditCompanyInfo({...editCompanyInfo, activityCode: e.target.value})}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCompanyDialog(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleSaveCompanyInfo}>
              {fd.saveCompany}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supplier Return Dialog */}
      <Dialog open={supplierReturnDialog} onOpenChange={setSupplierReturnDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{fd.newSupplierReturnTitle}</DialogTitle>
            <DialogDescription>{fd.newSupplierReturnSubtitle}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!selectedPO ? (
              <div className="space-y-4">
                <Label>{fd.selectReceivedOrder}</Label>
                {receivedOrders.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">{fd.noOrdersAvailable}</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {receivedOrders.map(po => (
                      <div 
                        key={po.id}
                        className="p-3 border rounded-lg cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSelectPOForReturn(po)}
                      >
                        <div className="flex justify-between">
                          <span className="font-medium">{po.orderNumber}</span>
                          <span>{po.total.toLocaleString(uiLocale)} Kz</span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {po.supplierName} • {format(new Date(po.createdAt), 'dd/MM/yyyy')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="font-medium">{selectedPO.orderNumber} - {selectedPO.supplierName}</p>
                  <Button variant="link" className="p-0 h-auto" onClick={() => setSelectedPO(null)}>Alterar</Button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{fd.reasonLabel}</Label>
                    <Select value={returnReason} onValueChange={(v: any) => setReturnReason(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="damaged">Danificado</SelectItem>
                        <SelectItem value="wrong_item">Item Errado</SelectItem>
                        <SelectItem value="quality">Problema de Qualidade</SelectItem>
                        <SelectItem value="overstock">Excesso de Stock</SelectItem>
                        <SelectItem value="other">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Descrição</Label>
                    <Input value={returnDescription} onChange={(e) => setReturnDescription(e.target.value)} placeholder={fd.returnDescriptionPlaceholder} />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox checked={deductStock} onCheckedChange={(c) => setDeductStock(!!c)} />
                  <Label>{fd.deductStockAuto}</Label>
                </div>

                <div>
                  <Label>{fd.itemsToReturnLabel}</Label>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{fd.colProduct}</TableHead>
                        <TableHead className="text-right">{fd.colReceived}</TableHead>
                        <TableHead className="text-right">A Devolver</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {returnItems.map(item => {
                        const poItem = selectedPO.items.find(i => i.productId === item.productId);
                        return (
                          <TableRow key={item.productId}>
                            <TableCell>{item.productName}</TableCell>
                            <TableCell className="text-right">{poItem?.receivedQuantity || poItem?.quantity}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min="0"
                                max={poItem?.receivedQuantity || poItem?.quantity}
                                className="w-20 ml-auto"
                                value={item.quantity}
                                onChange={(e) => updateReturnItemQuantity(item.productId, parseInt(e.target.value) || 0)}
                              />
                            </TableCell>
                            <TableCell className="text-right">{item.subtotal.toLocaleString(uiLocale)} Kz</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div>
                  <Label>Notas</Label>
                  <Textarea value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} rows={2} />
                </div>

                <div className="text-right text-lg font-bold">
                  {t.fiscalDocumentsUi.totalLabel} {returnItems.reduce((s, i) => s + i.subtotal + i.taxAmount, 0).toLocaleString(uiLocale)} Kz
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setSupplierReturnDialog(false); resetSupplierReturnForm(); }}>{t.common.cancel}</Button>
            <Button onClick={handleCreateSupplierReturn} disabled={!selectedPO || returnItems.every(i => i.quantity === 0)}>
              <RotateCcw className="w-4 h-4 mr-2" />
              {fd.createReturn}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}