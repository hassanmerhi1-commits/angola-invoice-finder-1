// NEXOR ERP - Import/Export (Importação) Module
// Customs, shipping, landed cost, forex

import { useMemo, useState } from 'react';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth, useImportOrders, type ImportOrder } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Plus, Search, RefreshCw, Globe, Ship, Plane,
  FileText, DollarSign, Package, Truck, CheckCircle, Clock,
  ArrowRight, Calculator,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NEXOR_TOOLBAR_BTN_SM } from '@/lib/nexorToolbarStyles';

export default function ImportModule() {
  const { user } = useAuth();
  const { currentBranch } = useBranchContext();
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { orders, loading, refreshOrders, createOrder, updateStatus, receiveOrder } = useImportOrders(currentBranch?.id);

  const [activeTab, setActiveTab] = useState('importacoes');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    supplierName: '', supplierCountry: '', transportMode: 'sea' as ImportOrder['transportMode'],
    incoterm: 'FOB' as ImportOrder['incoterm'], portOfOrigin: '', portOfDestination: 'Luanda',
    currency: 'USD' as ImportOrder['currency'], exchangeRate: 920,
    fobValue: 0, freightCost: 0, insuranceCost: 0,
    customsDutyRate: 10, portCharges: 0, transportLocal: 0, otherCosts: 0,
    notes: '',
  });

  const filteredOrders = useMemo(() => {
    if (!searchTerm) return orders;
    const q = searchTerm.toLowerCase();
    return orders.filter(o => o.orderNumber.toLowerCase().includes(q) || o.supplierName.toLowerCase().includes(q));
  }, [orders, searchTerm]);

  const summary = useMemo(() => ({
    total: orders.length,
    inTransit: orders.filter(o => o.status === 'shipped').length,
    inCustoms: orders.filter(o => o.status === 'in_customs').length,
    received: orders.filter(o => o.status === 'received').length,
    totalValue: orders.reduce((s, o) => s + o.totalLandedCost, 0),
  }), [orders]);

  const createImport = async () => {
    if (!form.supplierName) { toast.error(t.importsUi.supplierRequired); return; }
    setSaving(true);
    try {
      const order = await createOrder({
        supplierName: form.supplierName,
        supplierCountry: form.supplierCountry,
        transportMode: form.transportMode,
        incoterm: form.incoterm,
        portOfOrigin: form.portOfOrigin,
        portOfDestination: form.portOfDestination,
        currency: form.currency,
        exchangeRate: form.exchangeRate,
        fobValue: form.fobValue,
        freightCost: form.freightCost,
        insuranceCost: form.insuranceCost,
        customsDutyRate: form.customsDutyRate,
        portCharges: form.portCharges,
        transportLocal: form.transportLocal,
        otherCosts: form.otherCosts,
        notes: form.notes,
        branchId: currentBranch?.id,
        createdBy: user?.id,
      });
      toast.success(t.importsUi.importCreated.replace('{number}', order.orderNumber));
      setFormOpen(false);
      setSelectedId(order.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.importsUi.importCreated);
    } finally {
      setSaving(false);
    }
  };

  const advanceStatus = async (order: ImportOrder, status: ImportOrder['status']) => {
    try {
      if (status === 'received') {
        await receiveOrder(order.id, user?.id || '', currentBranch?.id);
      } else {
        await updateStatus(order.id, status);
      }
      toast.success(t.importsUi.statusUpdated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.importsUi.statusUpdated);
    }
  };

  const selectedOrder = orders.find(o => o.id === selectedId);

  const transportIcon = (mode: string) => mode === 'sea' ? Ship : mode === 'air' ? Plane : Truck;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-3 py-2 border-b bg-card/40 shrink-0">
        <h1 className="text-lg font-bold">{t.importsUi.moduleTitle}</h1>
        <p className="text-xs text-muted-foreground">{t.importsUi.moduleSubtitle}</p>
      </div>
      <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b flex-wrap">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setFormOpen(true)}>
          <Plus className="w-3 h-3" /> {t.importsUi.newImport}
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        {selectedOrder && selectedOrder.status !== 'received' && selectedOrder.status !== 'cancelled' && (
          <>
            {selectedOrder.status === 'draft' && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => void advanceStatus(selectedOrder, 'ordered')}>
                <ArrowRight className="w-3 h-3" /> {t.importsUi.statusOrdered}
              </Button>
            )}
            {selectedOrder.status === 'ordered' && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => void advanceStatus(selectedOrder, 'shipped')}>
                <Ship className="w-3 h-3" /> {t.importsUi.statusShipped}
              </Button>
            )}
            {selectedOrder.status === 'shipped' && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => void advanceStatus(selectedOrder, 'in_customs')}>
                <Globe className="w-3 h-3" /> {t.importsUi.statusInCustoms}
              </Button>
            )}
            {selectedOrder.status === 'in_customs' && (
              <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} onClick={() => void advanceStatus(selectedOrder, 'cleared')}>
                <CheckCircle className="w-3 h-3" /> {t.importsUi.statusCleared}
              </Button>
            )}
            {selectedOrder.status === 'cleared' && (
              <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} onClick={() => void advanceStatus(selectedOrder, 'received')}>
                <Package className="w-3 h-3" /> {t.importsUi.statusReceived}
              </Button>
            )}
          </>
        )}
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => void refreshOrders()} disabled={loading}>
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
        </Button>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-[10px] mr-2">
          <Badge variant="outline" className="gap-1"><Globe className="w-3 h-3" /> {summary.total}</Badge>
          <Badge variant="outline" className="gap-1 text-blue-600">{t.importsUi.inTransitCount.replace('{count}', String(summary.inTransit))}</Badge>
          <Badge variant="outline" className="gap-1 text-amber-600">{t.importsUi.inCustomsCount.replace('{count}', String(summary.inCustoms))}</Badge>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input placeholder={t.common.search} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-7 text-xs pl-7 w-40" />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 h-auto p-0">
          {[
            { key: 'importacoes', labelKey: 'tabImports', icon: Globe },
          ].map(tab => (
            <TabsTrigger key={tab.key} value={tab.key}
              className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-1.5 gap-1">
              <tab.icon className="w-3 h-3" /> {t.importsUi[tab.labelKey as keyof typeof t.importsUi] as string}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="importacoes" className="flex-1 m-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-32">{t.importsUi.importNo}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.importsUi.supplier}</th>
                <th className="px-3 py-2 text-left font-semibold w-20">{t.importsUi.country}</th>
                <th className="px-3 py-2 text-center font-semibold w-14">{t.importsUi.via}</th>
                <th className="px-3 py-2 text-left font-semibold w-14">{t.importsUi.currency}</th>
                <th className="px-3 py-2 text-right font-semibold w-24">FOB</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.importsUi.totalCostKz}</th>
                <th className="px-3 py-2 text-center font-semibold w-24">{t.common.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredOrders.map(order => {
                const TransportIcon = transportIcon(order.transportMode);
                return (
                  <tr key={order.id} className={cn("cursor-pointer hover:bg-accent/50", selectedId === order.id && "nexor-row-selected")}
                    onClick={() => setSelectedId(order.id)}>
                    <td className="px-3 py-1.5 font-mono">{order.orderNumber}</td>
                    <td className="px-3 py-1.5 font-medium">{order.supplierName}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{order.supplierCountry}</td>
                    <td className="px-3 py-1.5 text-center"><TransportIcon className="w-3.5 h-3.5 inline text-muted-foreground" /></td>
                    <td className="px-3 py-1.5">{order.currency}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{order.fobValue.toLocaleString(uiLocale)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-medium">{order.totalLandedCost.toLocaleString(uiLocale)}</td>
                    <td className="px-3 py-1.5 text-center">
                      <Badge variant={
                        order.status === 'received' ? 'default' :
                        order.status === 'shipped' || order.status === 'in_customs' ? 'secondary' :
                        order.status === 'cancelled' ? 'destructive' : 'outline'
                      } className="text-[9px] px-1.5 py-0">
                        {order.status === 'draft' ? t.importsUi.statusDraft :
                          order.status === 'ordered' ? t.importsUi.statusOrdered :
                          order.status === 'shipped' ? t.importsUi.statusShipped :
                          order.status === 'in_customs' ? t.importsUi.statusInCustomsShort :
                          order.status === 'cleared' ? t.importsUi.statusCleared :
                          order.status === 'received' ? t.importsUi.statusReceived :
                          t.importsUi.statusCancelled}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredOrders.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t.importsUi.noImports}</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {selectedOrder && (
        <div className="h-7 bg-primary/10 border-t flex items-center px-3 text-[10px] gap-4">
          <span className="font-bold">{selectedOrder.orderNumber}</span>
          <span>{selectedOrder.supplierName} ({selectedOrder.supplierCountry})</span>
          <span>{t.importsUi.fobLabel.replace('{amount}', selectedOrder.fobValue.toLocaleString(uiLocale)).replace('{currency}', selectedOrder.currency)}</span>
          <span>{t.importsUi.exchangeRateLabel.replace('{rate}', String(selectedOrder.exchangeRate))}</span>
          <span>{t.importsUi.totalCostLabel.replace('{amount}', selectedOrder.totalLandedCost.toLocaleString(uiLocale))}</span>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t.importsUi.newImportTitle}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.supplier} *</Label>
                <Input value={form.supplierName} onChange={e => setForm(p => ({ ...p, supplierName: e.target.value }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.country}</Label>
                <Input value={form.supplierCountry} onChange={e => setForm(p => ({ ...p, supplierCountry: e.target.value }))} placeholder={t.importsUi.countryPlaceholder} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.transportMode}</Label>
                <Select value={form.transportMode} onValueChange={v => setForm(p => ({ ...p, transportMode: v as ImportOrder['transportMode'] }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sea">{t.importsUi.transportSea}</SelectItem>
                    <SelectItem value="air">{t.importsUi.transportAir}</SelectItem>
                    <SelectItem value="land">{t.importsUi.transportLand}</SelectItem>
                  </SelectContent>
                </Select></div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.currency}</Label>
                <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v as ImportOrder['currency'] }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="EUR">EUR</SelectItem><SelectItem value="CNY">CNY</SelectItem></SelectContent>
                </Select></div>
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.exchangeRate}</Label>
                <Input type="number" value={form.exchangeRate} onChange={e => setForm(p => ({ ...p, exchangeRate: Number(e.target.value) }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.incoterm}</Label>
                <Select value={form.incoterm} onValueChange={v => setForm(p => ({ ...p, incoterm: v as ImportOrder['incoterm'] }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="FOB">FOB</SelectItem><SelectItem value="CIF">CIF</SelectItem><SelectItem value="EXW">EXW</SelectItem><SelectItem value="DDP">DDP</SelectItem></SelectContent>
                </Select></div>
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.customsDutyRate} %</Label>
                <Input type="number" value={form.customsDutyRate} onChange={e => setForm(p => ({ ...p, customsDutyRate: Number(e.target.value) }))} className="h-8 text-xs" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.fobValue} ({form.currency})</Label>
                <Input type="number" value={form.fobValue} onChange={e => setForm(p => ({ ...p, fobValue: Number(e.target.value) }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.freight} ({form.currency})</Label>
                <Input type="number" value={form.freightCost} onChange={e => setForm(p => ({ ...p, freightCost: Number(e.target.value) }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.insurance} ({form.currency})</Label>
                <Input type="number" value={form.insuranceCost} onChange={e => setForm(p => ({ ...p, insuranceCost: Number(e.target.value) }))} className="h-8 text-xs" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.portCharges} (Kz)</Label>
                <Input type="number" value={form.portCharges} onChange={e => setForm(p => ({ ...p, portCharges: Number(e.target.value) }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.localTransport} (Kz)</Label>
                <Input type="number" value={form.transportLocal} onChange={e => setForm(p => ({ ...p, transportLocal: Number(e.target.value) }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.importsUi.otherCosts} (Kz)</Label>
                <Input type="number" value={form.otherCosts} onChange={e => setForm(p => ({ ...p, otherCosts: Number(e.target.value) }))} className="h-8 text-xs" /></div>
            </div>
            <div className="bg-muted/30 rounded p-3 text-xs space-y-1 border">
              <div className="flex justify-between"><span>{t.importsUi.cifForeignLabel.replace('{currency}', form.currency)}:</span><span className="font-mono">{(form.fobValue + form.freightCost + form.insuranceCost).toLocaleString(uiLocale)}</span></div>
              <div className="flex justify-between"><span>{t.importsUi.cifKzLabel}:</span><span className="font-mono">{((form.fobValue + form.freightCost + form.insuranceCost) * form.exchangeRate).toLocaleString(uiLocale)}</span></div>
              <div className="flex justify-between"><span>{t.importsUi.customsDutyLabel.replace('{rate}', String(form.customsDutyRate))}:</span><span className="font-mono">{(((form.fobValue + form.freightCost + form.insuranceCost) * form.exchangeRate) * form.customsDutyRate / 100).toLocaleString(uiLocale)}</span></div>
              <div className="flex justify-between font-bold border-t pt-1"><span>{t.importsUi.totalCost}:</span>
                <span className="font-mono">{(((form.fobValue + form.freightCost + form.insuranceCost) * form.exchangeRate) * (1 + form.customsDutyRate / 100) + form.portCharges + form.transportLocal + form.otherCosts).toLocaleString(uiLocale)} Kz</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={() => void createImport()} disabled={saving}>
              {saving ? t.common.saving : t.importsUi.createImport}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
