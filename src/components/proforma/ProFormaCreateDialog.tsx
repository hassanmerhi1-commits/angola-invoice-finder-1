import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useProducts, useClients, useAuth } from '@/hooks/useERP';
import { useProForma, productToProFormaItem } from '@/hooks/useProForma';
import { ProFormaItem } from '@/types/proforma';
import { Product, Client } from '@/types/erp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Trash2, Search, Package } from 'lucide-react';

type ProFormaCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
};

export function ProFormaCreateDialog({ open, onOpenChange, onCreated }: ProFormaCreateDialogProps) {
  const { t, language } = useTranslation();
  const p = t.proFormaUi;
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { currentBranch, apiBranchId } = useBranchScope();
  const { user } = useAuth();
  const branchId = apiBranchId || currentBranch?.id;
  const { products } = useProducts(branchId, { light: true, enabled: open });
  const { clients } = useClients(!open);
  const { createProForma } = useProForma(branchId);

  const [customerName, setCustomerName] = useState('');
  const [customerNif, setCustomerNif] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [validDays, setValidDays] = useState(30);
  const [notes, setNotes] = useState('');
  const [selectedItems, setSelectedItems] = useState<ProFormaItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientPickerOpen, setClientPickerOpen] = useState(false);

  const resetCreateForm = () => {
    setCustomerName('');
    setCustomerNif('');
    setCustomerEmail('');
    setCustomerPhone('');
    setCustomerAddress('');
    setValidDays(30);
    setNotes('');
    setSelectedItems([]);
    setProductSearch('');
    setClientSearch('');
    setClientPickerOpen(false);
  };

  useEffect(() => {
    if (open) resetCreateForm();
  }, [open]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products.slice(0, 20);
    return products.filter((product) =>
      product.name.toLowerCase().includes(productSearch.toLowerCase())
      || product.sku.toLowerCase().includes(productSearch.toLowerCase()),
    ).slice(0, 20);
  }, [products, productSearch]);

  const filteredClients = useMemo(() => {
    const active = clients.filter((c) => c.isActive !== false);
    const q = clientSearch.trim().toLowerCase();
    if (!q) return active.slice(0, 25);
    return active
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q)
          || (c.nif && c.nif.toLowerCase().includes(q))
          || (c.email && c.email.toLowerCase().includes(q))
          || (c.phone && c.phone.includes(q)),
      )
      .slice(0, 25);
  }, [clients, clientSearch]);

  const formatMoney = (value: number) =>
    `${value.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} ${t.common.currency}`;

  const handleSelectClient = (client: Client) => {
    setCustomerName(client.name);
    setCustomerNif(client.nif);
    setCustomerEmail(client.email || '');
    setCustomerPhone(client.phone || '');
    setCustomerAddress(client.address || '');
    setClientSearch(client.name);
    setClientPickerOpen(false);
  };

  const handleAddProduct = (product: Product) => {
    const existing = selectedItems.find((i) => i.productId === product.id);
    if (existing) {
      setSelectedItems((prev) => prev.map((i) =>
        i.productId === product.id
          ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unitPrice * (1 + i.taxRate / 100) }
          : i,
      ));
    } else {
      setSelectedItems((prev) => [...prev, productToProFormaItem(product, 1)]);
    }
  };

  const handleUpdateItemQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setSelectedItems((prev) => prev.filter((i) => i.productId !== productId));
    } else {
      setSelectedItems((prev) => prev.map((i) =>
        i.productId === productId
          ? { ...i, quantity: qty, subtotal: qty * i.unitPrice * (1 + i.taxRate / 100), taxAmount: qty * i.unitPrice * (i.taxRate / 100) }
          : i,
      ));
    }
  };

  const handleRemoveItem = (productId: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.productId !== productId));
  };

  const itemsTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.subtotal, 0),
    [selectedItems],
  );

  const handleCreateProforma = async () => {
    if (!currentBranch || !user) return;
    if (!customerName.trim()) {
      toast.error(p.customerNameRequired);
      return;
    }
    if (selectedItems.length === 0) {
      toast.error(p.addAtLeastOneProduct);
      return;
    }

    try {
      await createProForma(
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
        notes || undefined,
      );
      toast.success(p.createdSuccess);
      onOpenChange(false);
      resetCreateForm();
      onCreated?.();
    } catch {
      toast.error(p.createFailed);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{p.createTitle}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          <Tabs defaultValue="customer" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="customer">{p.tabCustomer}</TabsTrigger>
              <TabsTrigger value="products">{p.tabProducts}</TabsTrigger>
              <TabsTrigger value="details">{p.tabDetails}</TabsTrigger>
            </TabsList>

            <TabsContent value="customer" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>{p.selectExistingClient}</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      setClientPickerOpen(true);
                    }}
                    onFocus={() => setClientPickerOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setClientPickerOpen(false), 150);
                    }}
                    placeholder={p.searchClientPlaceholder}
                    className="pl-10"
                    autoComplete="off"
                  />
                  {clientPickerOpen && filteredClients.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-0.5 border rounded-md bg-popover shadow-md max-h-48 overflow-y-auto">
                      {filteredClients.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 flex justify-between gap-2 border-b last:border-b-0"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectClient(client)}
                        >
                          <span className="truncate font-medium">{client.name}</span>
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {client.nif || client.phone || '—'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{p.searchClientHint}</p>
              </div>

              <div className="text-center text-muted-foreground">{p.orFillManually}</div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t.common.name} *</Label>
                  <Input
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                    }}
                    placeholder={p.customerNamePlaceholder}
                  />
                </div>
                <div>
                  <Label>NIF</Label>
                  <Input
                    value={customerNif}
                    onChange={(e) => setCustomerNif(e.target.value)}
                    placeholder={p.customerNifPlaceholder}
                  />
                </div>
                <div>
                  <Label>{t.common.email}</Label>
                  <Input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder={p.emailPlaceholder}
                  />
                </div>
                <div>
                  <Label>{t.common.phone}</Label>
                  <Input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder={p.phonePlaceholder}
                  />
                </div>
                <div className="col-span-2">
                  <Label>{t.common.address}</Label>
                  <Input
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder={p.customerAddressPlaceholder}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="products" className="space-y-4 mt-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder={p.searchProductsPlaceholder}
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{p.availableProducts}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[250px]">
                      <div className="space-y-2">
                        {filteredProducts.map((product) => (
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

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{p.selectedItems.replace('{count}', String(selectedItems.length))}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[250px]">
                      {selectedItems.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Package className="h-8 w-8 mx-auto mb-2 opacity-20" />
                          <p>{p.noProductSelected}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {selectedItems.map((item) => (
                            <div key={item.productId} className="flex items-center gap-2 p-2 border rounded">
                              <div className="flex-1">
                                <div className="font-medium text-sm">{item.productName}</div>
                                <div className="text-xs text-muted-foreground">{formatMoney(item.unitPrice)}</div>
                              </div>
                              <Input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) => handleUpdateItemQty(item.productId, parseInt(e.target.value, 10) || 0)}
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
                      <span className="font-medium">{t.common.total}:</span>
                      <span className="text-xl font-bold">{formatMoney(itemsTotal)}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="details" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{p.validityDays}</Label>
                  <Select value={validDays.toString()} onValueChange={(v) => setValidDays(parseInt(v, 10))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">{p.validity7}</SelectItem>
                      <SelectItem value="15">{p.validity15}</SelectItem>
                      <SelectItem value="30">{p.validity30}</SelectItem>
                      <SelectItem value="60">{p.validity60}</SelectItem>
                      <SelectItem value="90">{p.validity90}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>{t.common.notes}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={p.notesPlaceholder}
                  rows={3}
                />
              </div>

              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  <h4 className="font-medium mb-2">{p.summary}</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>{p.summaryCustomer}</span>
                      <span className="font-medium">{customerName || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{p.summaryItems}</span>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void handleCreateProforma()}>
            <Plus className="h-4 w-4 mr-2" />
            {p.createProForma}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
