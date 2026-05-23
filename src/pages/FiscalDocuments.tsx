import { useState, useEffect } from 'react';
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
import { Sale, CreditNoteItem, DebitNoteItem, TransportDocumentItem, Product, PurchaseOrder } from '@/types/erp';
import { DEFAULT_VAT_RATE } from '@/lib/taxUtils';
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
  Search,
  Calendar,
  Building2,
  AlertCircle,
  RotateCcw,
  Package,
  CheckCircle,
  XCircle
} from 'lucide-react';
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
  const { currentBranch, apiBranchId } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  const { products } = useProducts(apiBranchId);
  const { orders } = usePurchaseOrders(apiBranchId);
  const { creditNotes, createCreditNote } = useCreditNotes(apiBranchId);
  const { debitNotes, createDebitNote } = useDebitNotes(apiBranchId);
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

  // Form states
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [creditReason, setCreditReason] = useState<'return' | 'discount' | 'error' | 'other'>('return');
  const [creditDescription, setCreditDescription] = useState('');
  const [creditItems, setCreditItems] = useState<CreditNoteItem[]>([]);
  const [restoreStock, setRestoreStock] = useState(true);

  const [debitReason, setDebitReason] = useState<'price_adjustment' | 'additional_charge' | 'interest' | 'other'>('price_adjustment');
  const [debitDescription, setDebitDescription] = useState('');
  const [debitItems, setDebitItems] = useState<DebitNoteItem[]>([{ description: '', quantity: 1, unitPrice: 0, taxRate: DEFAULT_VAT_RATE, taxAmount: 0, subtotal: 0 }]);
  const [debitCustomerNif, setDebitCustomerNif] = useState('');
  const [debitCustomerName, setDebitCustomerName] = useState('');

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
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const st = location.state as { openSaft?: boolean } | null;
    if (!st?.openSaft) return;
    setSaftDialog(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);

  // Received POs for supplier returns
  const receivedOrders = orders.filter(o => o.status === 'received' || o.status === 'partial');

  // Handlers
  const handleSelectSaleForCredit = (sale: Sale) => {
    setSelectedSale(sale);
    setCreditItems(sale.items.map(item => ({
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate,
      taxAmount: item.taxAmount,
      subtotal: item.subtotal,
    })));
  };

  const handleCreateCreditNote = () => {
    if (!selectedSale || !currentBranch || !user) return;
    
    createCreditNote(
      currentBranch.id,
      currentBranch.code,
      selectedSale,
      creditReason,
      creditDescription,
      creditItems,
      user.id,
      restoreStock
    );

    toast({
      title: t.fiscalDocumentsUi.creditNoteCreatedTitle,
      description: t.fiscalDocumentsUi.documentIssuedSuccess,
    });

    setCreditNoteDialog(false);
    resetCreditForm();
  };

  const handleCreateDebitNote = () => {
    if (!currentBranch || !user) return;
    
    createDebitNote(
      currentBranch.id,
      currentBranch.code,
      selectedSale,
      debitReason,
      debitDescription,
      debitItems.filter(i => i.description && i.subtotal > 0),
      user.id,
      debitCustomerNif,
      debitCustomerName
    );

    toast({
      title: t.fiscalDocumentsUi.debitNoteCreatedTitle,
      description: t.fiscalDocumentsUi.documentIssuedSuccess,
    });

    setDebitNoteDialog(false);
    resetDebitForm();
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

  const handleCreateTransportDoc = () => {
    if (!currentBranch || !user || transportItems.length === 0) return;
    
    createTransportDocument(
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
      }
    );

    toast({
      title: t.fiscalDocumentsUi.transportDocCreatedTitle,
      description: t.fiscalDocumentsUi.documentIssuedSuccess,
    });

    setTransportDocDialog(false);
    resetTransportForm();
  };

  const handleExportSAFT = () => {
    if (!user) return;
    
    generateSAFT(saftStartDate, saftEndDate, user.id, currentBranch?.id);
    
    toast({
      title: t.fiscalDocumentsUi.saftExportedTitle,
      description: t.fiscalDocumentsUi.xmlDownloaded,
    });
    
    setSaftDialog(false);
  };

  const handleSaveCompanyInfo = () => {
    saveCompanyInfo(editCompanyInfo);
    toast({
      title: t.fiscalDocumentsUi.companyInfoUpdatedTitle,
      description: t.fiscalDocumentsUi.companyInfoSavedSuccess,
    });
    setCompanyDialog(false);
  };

  const resetCreditForm = () => {
    setSelectedSale(null);
    setCreditReason('return');
    setCreditDescription('');
    setCreditItems([]);
    setRestoreStock(true);
  };

  const resetDebitForm = () => {
    setSelectedSale(null);
    setDebitReason('price_adjustment');
    setDebitDescription('');
    setDebitItems([{ description: '', quantity: 1, unitPrice: 0, taxRate: DEFAULT_VAT_RATE, taxAmount: 0, subtotal: 0 }]);
    setDebitCustomerNif('');
    setDebitCustomerName('');
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

  const updateDebitItem = (index: number, field: keyof DebitNoteItem, value: string | number) => {
    const updated = [...debitItems];
    (updated[index] as any)[field] = value;
    
    if (field === 'quantity' || field === 'unitPrice' || field === 'taxRate') {
      const qty = updated[index].quantity;
      const price = updated[index].unitPrice;
      const taxRate = updated[index].taxRate;
      updated[index].subtotal = qty * price;
      updated[index].taxAmount = updated[index].subtotal * (taxRate / 100);
    }
    
    setDebitItems(updated);
  };

  const addDebitItem = () => {
    setDebitItems([...debitItems, { description: '', quantity: 1, unitPrice: 0, taxRate: DEFAULT_VAT_RATE, taxAmount: 0, subtotal: 0 }]);
  };

  const filteredSales = sales.filter(s => 
    s.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.customerName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
          <Button variant="modern" size="lg" onClick={() => setSaftDialog(true)}>
            <Download />
            {fd.exportSaftBtn}
          </Button>
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
              <Button variant="modern" size="lg" onClick={() => setCreditNoteDialog(true)}>
                <Plus />
                {fd.newCreditNote}
              </Button>
            </CardHeader>
            <CardContent>
              {creditNotes.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileMinus className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p>{fd.noCreditNotes}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{fd.colDocNumber}</TableHead>
                      <TableHead>{fd.colDate}</TableHead>
                      <TableHead>{fd.colOriginalInvoice}</TableHead>
                      <TableHead>{fd.colReason}</TableHead>
                      <TableHead>{fd.colCustomer}</TableHead>
                      <TableHead className="text-right">{fd.colTotal}</TableHead>
                      <TableHead>{fd.colStatus}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditNotes.map(note => (
                      <TableRow key={note.id}>
                        <TableCell className="font-medium">{note.documentNumber}</TableCell>
                        <TableCell>{format(new Date(note.createdAt), 'dd/MM/yyyy HH:mm', { locale: dfLocale })}</TableCell>
                        <TableCell>{note.originalInvoiceNumber}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {note.reason === 'return' ? t.fiscalDocumentsUi.creditReasonReturn :
                             note.reason === 'discount' ? t.fiscalDocumentsUi.creditReasonDiscount :
                             note.reason === 'error' ? t.fiscalDocumentsUi.creditReasonError :
                             t.fiscalDocumentsUi.other}
                          </Badge>
                        </TableCell>
                        <TableCell>{note.customerName || t.fiscalDocumentsUi.finalConsumer}</TableCell>
                        <TableCell className="text-right font-bold">{note.total.toLocaleString(uiLocale)} Kz</TableCell>
                        <TableCell>
                          <Badge variant={note.status === 'issued' ? 'default' : 'destructive'}>
                            {note.status === 'issued' ? t.fiscalDocumentsUi.statusIssued : t.fiscalDocumentsUi.statusCancelled}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
              <Button variant="modern" size="lg" onClick={() => setDebitNoteDialog(true)}>
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debitNotes.map(note => (
                      <TableRow key={note.id}>
                        <TableCell className="font-medium">{note.documentNumber}</TableCell>
                        <TableCell>{format(new Date(note.createdAt), 'dd/MM/yyyy HH:mm', { locale: pt })}</TableCell>
                        <TableCell>{note.originalInvoiceNumber || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {note.reason === 'price_adjustment' ? t.fiscalDocumentsUi.debitReasonPriceAdjustmentShort :
                             note.reason === 'additional_charge' ? t.fiscalDocumentsUi.debitReasonAdditionalChargeShort :
                             note.reason === 'interest' ? t.fiscalDocumentsUi.debitReasonInterestShort :
                             t.fiscalDocumentsUi.other}
                          </Badge>
                        </TableCell>
                        <TableCell>{note.customerName || t.fiscalDocumentsUi.finalConsumer}</TableCell>
                        <TableCell className="text-right font-bold">{note.total.toLocaleString(uiLocale)} Kz</TableCell>
                        <TableCell>
                          <Badge variant={note.status === 'issued' ? 'default' : 'destructive'}>
                            {note.status === 'issued' ? t.fiscalDocumentsUi.statusIssued : t.fiscalDocumentsUi.statusCancelled}
                          </Badge>
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

      {/* Credit Note Dialog */}
      <Dialog open={creditNoteDialog} onOpenChange={setCreditNoteDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{fd.newCreditNoteTitle}</DialogTitle>
            <DialogDescription>{fd.newCreditNoteSubtitle}</DialogDescription>
          </DialogHeader>

          {!selectedSale ? (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t.fiscalDocumentsUi.searchInvoicePlaceholder}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="max-h-64 overflow-y-auto border rounded-lg">
                {filteredSales.map(sale => (
                  <div 
                    key={sale.id}
                    className="p-3 border-b hover:bg-muted cursor-pointer"
                    onClick={() => handleSelectSaleForCredit(sale)}
                  >
                    <div className="flex justify-between">
                      <span className="font-medium">{sale.invoiceNumber}</span>
                      <span>{sale.total.toLocaleString(uiLocale)} Kz</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {sale.customerName || fd.finalConsumer} • {format(new Date(sale.createdAt), 'dd/MM/yyyy')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{fd.invoiceLabel} {selectedSale.invoiceNumber}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedSale.customerName || t.fiscalDocumentsUi.finalConsumer} • {selectedSale.total.toLocaleString(uiLocale)} Kz
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedSale(null)}>
                    {fd.changeInvoice}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{fd.reasonLabel}</Label>
                  <Select value={creditReason} onValueChange={(v: any) => setCreditReason(v)}>
                    <SelectTrigger>
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

                <div className="space-y-2">
                  <Label>{fd.restoreStockLabel}</Label>
                  <Select value={restoreStock ? 'yes' : 'no'} onValueChange={(v) => setRestoreStock(v === 'yes')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">{fd.restoreStockYes}</SelectItem>
                      <SelectItem value="no">{fd.restoreStockNo}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t.common.description}</Label>
                <Textarea 
                  value={creditDescription}
                  onChange={(e) => setCreditDescription(e.target.value)}
                  placeholder={t.fiscalDocumentsUi.creditNoteReasonPlaceholder}
                />
              </div>

              <div className="space-y-2">
                <Label>{fd.itemsToCredit}</Label>
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{fd.colProduct}</TableHead>
                        <TableHead className="text-right">{fd.colQty}</TableHead>
                        <TableHead className="text-right">{fd.colPrice}</TableHead>
                        <TableHead className="text-right">{fd.colTotal}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {creditItems.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{item.productName}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0"
                              max={selectedSale.items.find(i => i.productId === item.productId)?.quantity || item.quantity}
                              value={item.quantity}
                              onChange={(e) => {
                                const updated = [...creditItems];
                                const qty = parseInt(e.target.value) || 0;
                                updated[idx].quantity = qty;
                                updated[idx].subtotal = qty * item.unitPrice;
                                updated[idx].taxAmount = updated[idx].subtotal * (item.taxRate / 100);
                                setCreditItems(updated);
                              }}
                              className="w-20 text-right"
                            />
                          </TableCell>
                          <TableCell className="text-right">{item.unitPrice.toLocaleString(uiLocale)} Kz</TableCell>
                          <TableCell className="text-right">{item.subtotal.toLocaleString(uiLocale)} Kz</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="text-right font-bold">
                  {t.fiscalDocumentsUi.totalLabel} {creditItems.reduce((sum, i) => sum + i.subtotal + i.taxAmount, 0).toLocaleString(uiLocale)} Kz
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreditNoteDialog(false); resetCreditForm(); }}>
              {t.common.cancel}
            </Button>
            <Button 
              onClick={handleCreateCreditNote}
              disabled={!selectedSale || creditItems.every(i => i.quantity === 0)}
            >
              {fd.issueCreditNote}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Debit Note Dialog */}
      <Dialog open={debitNoteDialog} onOpenChange={setDebitNoteDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.fiscalDocumentsUi.newDebitNoteTitle}</DialogTitle>
            <DialogDescription>{t.fiscalDocumentsUi.newDebitNoteSubtitle}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{fd.customerNifLabel}</Label>
                <Input 
                  value={debitCustomerNif}
                  onChange={(e) => setDebitCustomerNif(e.target.value)}
                  placeholder="000000000"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.common.name}</Label>
                <Input 
                  value={debitCustomerName}
                  onChange={(e) => setDebitCustomerName(e.target.value)}
                  placeholder={t.fiscalDocumentsUi.customerNamePlaceholder}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Motivo</Label>
                <Select value={debitReason} onValueChange={(v: any) => setDebitReason(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="price_adjustment">{t.fiscalDocumentsUi.debitReasonPriceAdjustment}</SelectItem>
                    <SelectItem value="additional_charge">{t.fiscalDocumentsUi.debitReasonAdditionalCharge}</SelectItem>
                    <SelectItem value="interest">{fd.debitReasonInterest}</SelectItem>
                    <SelectItem value="other">{fd.other}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t.common.description}</Label>
              <Textarea 
                value={debitDescription}
                onChange={(e) => setDebitDescription(e.target.value)}
                placeholder={t.fiscalDocumentsUi.debitNoteReasonPlaceholder}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>{fd.itemsLabel}</Label>
                <Button variant="outline" size="sm" onClick={addDebitItem}>
                  <Plus className="w-4 h-4 mr-1" /> {fd.addBtn}
                </Button>
              </div>
              <div className="space-y-2">
                {debitItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-5 gap-2 items-center">
                    <Input
                      placeholder={t.common.description}
                      value={item.description}
                      onChange={(e) => updateDebitItem(idx, 'description', e.target.value)}
                      className="col-span-2"
                    />
                    <Input
                      type="number"
                      placeholder={fd.colQty}
                      value={item.quantity}
                      onChange={(e) => updateDebitItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                    />
                    <Input
                      type="number"
                      placeholder={t.fiscalDocumentsUi.pricePlaceholder}
                      value={item.unitPrice}
                      onChange={(e) => updateDebitItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                    />
                    <div className="text-right font-medium">
                      {(item.subtotal + item.taxAmount).toLocaleString(uiLocale)} Kz
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-right font-bold">
                {t.fiscalDocumentsUi.totalLabel} {debitItems.reduce((sum, i) => sum + i.subtotal + i.taxAmount, 0).toLocaleString(uiLocale)} Kz
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDebitNoteDialog(false); resetDebitForm(); }}>
              {t.common.cancel}
            </Button>
            <Button 
              onClick={handleCreateDebitNote}
              disabled={debitItems.every(i => !i.description || i.subtotal === 0)}
            >
              {fd.issueDebitNote}
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