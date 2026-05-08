import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from '@/i18n';
import { useBranchContext } from '@/contexts/BranchContext';
import { useProducts, useClients, useAuth } from '@/hooks/useERP';
import { useProForma, productToProFormaItem } from '@/hooks/useProForma';
import { ProForma, ProFormaItem } from '@/types/proforma';
import { Product, Client } from '@/types/erp';
import { printProFormaA4 } from '@/lib/proformaA4';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Plus,
  FileText,
  Printer,
  Eye,
  Copy,
  ArrowRight,
  Trash2,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Send,
  RefreshCw,
  Package,
} from 'lucide-react';

export default function ProFormaPage() {
  const { t } = useTranslation();
  const { currentBranch } = useBranchContext();
  const { user } = useAuth();
  const { products } = useProducts(currentBranch?.id);
  const { clients } = useClients();
  const {
    proformas,
    refresh,
    createProForma,
    updateProFormaStatus,
    convertToInvoice,
    duplicateProForma,
    deleteProForma,
    getStats,
  } = useProForma(currentBranch?.id);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [selectedProforma, setSelectedProforma] = useState<ProForma | null>(null);
  const [stats, setStats] = useState({ total: 0, draft: 0, sent: 0, accepted: 0, converted: 0, expired: 0, totalValue: 0, pendingValue: 0 });

  useEffect(() => {
    getStats().then(setStats);
  }, [proformas, getStats]);

  // Create form state
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerNif, setCustomerNif] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [validDays, setValidDays] = useState(30);
  const [notes, setNotes] = useState('');
  const [selectedItems, setSelectedItems] = useState<ProFormaItem[]>([]);
  const [productSearch, setProductSearch] = useState('');

  // Convert form state
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [amountPaid, setAmountPaid] = useState(0);

  // stats loaded via useEffect above

  const filteredProformas = useMemo(() => {
    return proformas.filter(p => {
      const matchesSearch = 
        p.documentNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.customerName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [proformas, searchTerm, statusFilter]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products.slice(0, 20);
    return products.filter(p =>
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(productSearch.toLowerCase())
    ).slice(0, 20);
  }, [products, productSearch]);

  const formatMoney = (value: number) => 
    value.toLocaleString('pt-AO', { minimumFractionDigits: 2 }) + ' Kz';

  const formatDate = (date: string) => 
    new Date(date).toLocaleDateString('pt-AO');

  const getStatusBadge = (status: ProForma['status']) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any }> = {
      draft: { variant: 'secondary', icon: Clock },
      sent: { variant: 'default', icon: Send },
      accepted: { variant: 'default', icon: CheckCircle },
      rejected: { variant: 'destructive', icon: XCircle },
      converted: { variant: 'outline', icon: ArrowRight },
      expired: { variant: 'destructive', icon: Clock },
    };
    const labels: Record<string, string> = {
      draft: 'Rascunho',
      sent: 'Enviado',
      accepted: 'Aceite',
      rejected: 'Rejeitado',
      converted: 'Convertido',
      expired: 'Expirado',
    };
    const { variant, icon: Icon } = variants[status];
    return (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {labels[status]}
      </Badge>
    );
  };

  const handleSelectClient = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      setSelectedClient(client);
      setCustomerName(client.name);
      setCustomerNif(client.nif);
      setCustomerEmail(client.email || '');
      setCustomerPhone(client.phone || '');
      setCustomerAddress(client.address || '');
    }
  };

  const handleAddProduct = (product: Product) => {
    const existing = selectedItems.find(i => i.productId === product.id);
    if (existing) {
      setSelectedItems(prev => prev.map(i =>
        i.productId === product.id
          ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unitPrice * (1 + i.taxRate / 100) }
          : i
      ));
    } else {
      setSelectedItems(prev => [...prev, productToProFormaItem(product, 1)]);
    }
  };

  const handleUpdateItemQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setSelectedItems(prev => prev.filter(i => i.productId !== productId));
    } else {
      setSelectedItems(prev => prev.map(i =>
        i.productId === productId
          ? { ...i, quantity: qty, subtotal: qty * i.unitPrice * (1 + i.taxRate / 100), taxAmount: qty * i.unitPrice * (i.taxRate / 100) }
          : i
      ));
    }
  };

  const handleRemoveItem = (productId: string) => {
    setSelectedItems(prev => prev.filter(i => i.productId !== productId));
  };

  const itemsTotal = useMemo(() => {
    return selectedItems.reduce((sum, item) => sum + item.subtotal, 0);
  }, [selectedItems]);

  const resetCreateForm = () => {
    setSelectedClient(null);
    setCustomerName('');
    setCustomerNif('');
    setCustomerEmail('');
    setCustomerPhone('');
    setCustomerAddress('');
    setValidDays(30);
    setNotes('');
    setSelectedItems([]);
    setProductSearch('');
  };

  const handleCreateProforma = () => {
    if (!currentBranch || !user) return;
    if (!customerName.trim()) {
      toast.error(t.proFormaUi.customerNameRequired);
      return;
    }
    if (selectedItems.length === 0) {
      toast.error('Adicione pelo menos um produto');
      return;
    }

    createProForma(
      currentBranch.id,
      currentBranch.code,
      currentBranch.name,
      selectedItems,
      {
        name: customerName,
        nif: customerNif || undefined,
        email: customerEmail || undefined,
        phone: customerPhone || undefined,
        address: customerAddress || undefined,
      },
      validDays,
      user.name,
      notes || undefined
    );

    toast.success('Pro Forma criada com sucesso');
    setShowCreateDialog(false);
    resetCreateForm();
  };

  const handlePrint = async (proforma: ProForma) => {
    if (!currentBranch) return;
    try {
      await printProFormaA4(proforma, currentBranch);
      toast.success(t.proFormaUi.sentToPrint);
    } catch (error) {
      toast.error('Erro ao imprimir');
    }
  };

  const handleConvert = async () => {
    if (!selectedProforma || !currentBranch || !user) return;
    
    const sale = await convertToInvoice(
      selectedProforma.id,
      currentBranch.code,
      user.id,
      user.name,
      paymentMethod,
      amountPaid || selectedProforma.total
    );

    if (sale) {
      toast.success(`Factura ${sale.invoiceNumber} criada com sucesso`);
      setShowConvertDialog(false);
      setSelectedProforma(null);
    } else {
      toast.error('Erro ao converter pro forma');
    }
  };

  const handleDuplicate = async (proforma: ProForma) => {
    if (!currentBranch || !user) return;
    const newProforma = await duplicateProForma(proforma.id, currentBranch.code, user.name);
    if (newProforma) {
      toast.success(`Pro Forma duplicada: ${newProforma.documentNumber}`);
    }
  };

  const handleDelete = (proforma: ProForma) => {
    if (proforma.status === 'converted') {
      toast.error(t.proFormaUi.cannotDeleteConverted);
      return;
    }
    if (confirm(t.proFormaUi.deleteConfirm)) {
      deleteProForma(proforma.id);
      toast.success('Pro Forma eliminada');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Pro Forma / Orçamentos</h1>
          <p className="text-muted-foreground">
            Gerencie orçamentos e converta em facturas
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Pro Forma
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-600">{stats.draft}</div>
            <p className="text-xs text-muted-foreground">Rascunhos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-600">{stats.sent}</div>
            <p className="text-xs text-muted-foreground">Enviados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">{stats.accepted}</div>
            <p className="text-xs text-muted-foreground">Aceites</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-600">{stats.converted}</div>
            <p className="text-xs text-muted-foreground">Convertidos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{formatMoney(stats.pendingValue)}</div>
            <p className="text-xs text-muted-foreground">Valor Pendente</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder={t.proFormaUi.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filtrar por status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="sent">Enviado</SelectItem>
            <SelectItem value="accepted">Aceite</SelectItem>
            <SelectItem value="converted">Convertido</SelectItem>
            <SelectItem value="expired">Expirado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Pro Formas Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProformas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-2 opacity-20" />
                    <p>Nenhuma pro forma encontrada</p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredProformas.map((proforma) => (
                  <TableRow key={proforma.id}>
                    <TableCell className="font-medium">{proforma.documentNumber}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{proforma.customerName}</div>
                        {proforma.customerNif && (
                          <div className="text-xs text-muted-foreground">NIF: {proforma.customerNif}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(proforma.createdAt)}</TableCell>
                    <TableCell>{formatDate(proforma.validUntil)}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(proforma.total)}</TableCell>
                    <TableCell>{getStatusBadge(proforma.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedProforma(proforma);
                            setShowViewDialog(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handlePrint(proforma)}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDuplicate(proforma)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        {['draft', 'sent', 'accepted'].includes(proforma.status) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedProforma(proforma);
                              setAmountPaid(proforma.total);
                              setShowConvertDialog(true);
                            }}
                          >
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        )}
                        {proforma.status !== 'converted' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(proforma)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Nova Pro Forma</DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto">
            <Tabs defaultValue="customer" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="customer">1. Cliente</TabsTrigger>
                <TabsTrigger value="products">2. Produtos</TabsTrigger>
                <TabsTrigger value="details">3. Detalhes</TabsTrigger>
              </TabsList>

              <TabsContent value="customer" className="space-y-4 mt-4">
                <div>
                  <Label>Selecionar Cliente Existente</Label>
                  <Select onValueChange={handleSelectClient}>
                    <SelectTrigger>
                      <SelectValue placeholder={t.proFormaUi.selectClientPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map(client => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name} - {client.nif}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="text-center text-muted-foreground">ou preencha manualmente</div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Nome *</Label>
                    <Input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder={t.proFormaUi.customerNamePlaceholder}
                    />
                  </div>
                  <div>
                    <Label>NIF</Label>
                    <Input
                      value={customerNif}
                      onChange={(e) => setCustomerNif(e.target.value)}
                      placeholder={t.proFormaUi.customerNifPlaceholder}
                    />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="email@exemplo.com"
                    />
                  </div>
                  <div>
                    <Label>Telefone</Label>
                    <Input
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+244 9XX XXX XXX"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>Endereço</Label>
                    <Input
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      placeholder={t.proFormaUi.customerAddressPlaceholder}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="products" className="space-y-4 mt-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder={t.proFormaUi.searchProductsPlaceholder}
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Product List */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Produtos Disponíveis</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[250px]">
                        <div className="space-y-2">
                          {filteredProducts.map(product => (
                            <div
                              key={product.id}
                              className="flex items-center justify-between p-2 border rounded cursor-pointer hover:bg-muted"
                              onClick={() => handleAddProduct(product)}
                            >
                              <div>
                                <div className="font-medium">{product.name}</div>
                                <div className="text-xs text-muted-foreground">{product.sku}</div>
                              </div>
                              <div className="text-right">
                                <div className="font-medium">{formatMoney(product.price)}</div>
                                <Button size="sm" variant="ghost">
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  {/* Selected Items */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Itens Selecionados ({selectedItems.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[250px]">
                        {selectedItems.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <Package className="h-8 w-8 mx-auto mb-2 opacity-20" />
                            <p>Nenhum produto selecionado</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {selectedItems.map(item => (
                              <div key={item.productId} className="flex items-center gap-2 p-2 border rounded">
                                <div className="flex-1">
                                  <div className="font-medium text-sm">{item.productName}</div>
                                  <div className="text-xs text-muted-foreground">{formatMoney(item.unitPrice)}</div>
                                </div>
                                <Input
                                  type="number"
                                  min="1"
                                  value={item.quantity}
                                  onChange={(e) => handleUpdateItemQty(item.productId, parseInt(e.target.value) || 0)}
                                  className="w-16 text-center"
                                />
                                <div className="w-24 text-right font-medium">
                                  {formatMoney(item.subtotal)}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveItem(item.productId)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                      <div className="mt-4 pt-4 border-t flex justify-between">
                        <span className="font-medium">Total:</span>
                        <span className="text-xl font-bold">{formatMoney(itemsTotal)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="details" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Validade (dias)</Label>
                    <Select value={validDays.toString()} onValueChange={(v) => setValidDays(parseInt(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7">7 dias</SelectItem>
                        <SelectItem value="15">15 dias</SelectItem>
                        <SelectItem value="30">30 dias</SelectItem>
                        <SelectItem value="60">60 dias</SelectItem>
                        <SelectItem value="90">90 dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Observações</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t.proFormaUi.notesPlaceholder}
                    rows={3}
                  />
                </div>

                {/* Summary */}
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <h4 className="font-medium mb-2">Resumo</h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>Cliente:</span>
                        <span className="font-medium">{customerName || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Itens:</span>
                        <span className="font-medium">{selectedItems.length}</span>
                      </div>
                      <div className="flex justify-between text-lg mt-2 pt-2 border-t">
                        <span>Total:</span>
                        <span className="font-bold">{formatMoney(itemsTotal)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateProforma}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Pro Forma
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes da Pro Forma</DialogTitle>
          </DialogHeader>
          
          {selectedProforma && (
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold">{selectedProforma.documentNumber}</h3>
                  <p className="text-muted-foreground">{formatDate(selectedProforma.createdAt)}</p>
                </div>
                {getStatusBadge(selectedProforma.status)}
              </div>

              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <h4 className="font-medium mb-1">Cliente</h4>
                  <p>{selectedProforma.customerName}</p>
                  {selectedProforma.customerNif && <p className="text-sm text-muted-foreground">NIF: {selectedProforma.customerNif}</p>}
                </div>
                <div>
                  <h4 className="font-medium mb-1">Validade</h4>
                  <p>{formatDate(selectedProforma.validUntil)}</p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedProforma.items.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{item.productName}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatMoney(item.unitPrice)}</TableCell>
                      <TableCell className="text-right">{formatMoney(item.subtotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex justify-end">
                <div className="w-64 space-y-2">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{formatMoney(selectedProforma.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>IVA:</span>
                    <span>{formatMoney(selectedProforma.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold pt-2 border-t">
                    <span>Total:</span>
                    <span>{formatMoney(selectedProforma.total)}</span>
                  </div>
                </div>
              </div>

              {selectedProforma.convertedToInvoiceNumber && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-green-700">
                    ✓ Convertido em Factura: <strong>{selectedProforma.convertedToInvoiceNumber}</strong>
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowViewDialog(false)}>
              Fechar
            </Button>
            {selectedProforma && (
              <>
                <Button variant="outline" onClick={() => handlePrint(selectedProforma)}>
                  <Printer className="h-4 w-4 mr-2" />
                  Imprimir
                </Button>
                {['draft', 'sent', 'accepted'].includes(selectedProforma.status) && (
                  <Button onClick={() => {
                    setShowViewDialog(false);
                    setAmountPaid(selectedProforma.total);
                    setShowConvertDialog(true);
                  }}>
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Converter em Factura
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Dialog */}
      <Dialog open={showConvertDialog} onOpenChange={setShowConvertDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Converter em Factura</DialogTitle>
          </DialogHeader>
          
          {selectedProforma && (
            <div className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex justify-between mb-2">
                  <span>Pro Forma:</span>
                  <span className="font-medium">{selectedProforma.documentNumber}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span>Cliente:</span>
                  <span className="font-medium">{selectedProforma.customerName}</span>
                </div>
                <div className="flex justify-between text-lg">
                  <span>Total:</span>
                  <span className="font-bold">{formatMoney(selectedProforma.total)}</span>
                </div>
              </div>

              <div>
                <Label>Método de Pagamento</Label>
                <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Numerário</SelectItem>
                    <SelectItem value="card">Cartão</SelectItem>
                    <SelectItem value="transfer">Transferência</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Valor Pago</Label>
                <Input
                  type="number"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(parseFloat(e.target.value) || 0)}
                />
              </div>

              {paymentMethod === 'cash' && amountPaid > selectedProforma.total && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                  <span className="text-blue-700">
                    Troco: <strong>{formatMoney(amountPaid - selectedProforma.total)}</strong>
                  </span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConvertDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConvert}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Confirmar Conversão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
