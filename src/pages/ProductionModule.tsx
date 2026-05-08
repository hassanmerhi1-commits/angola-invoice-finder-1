// NEXOR ERP - Production Module
// BOM, Production Orders, Material Consumption, Finished Goods

import { useState, useMemo } from 'react';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth, useProducts } from '@/hooks/useERP';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import {
  Plus, Search, Trash2, RefreshCw, Factory, Package,
  Play, CheckCircle, XCircle, Layers, Settings, DollarSign
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Types
interface BOMItem {
  id: string;
  materialId: string;
  materialName: string;
  materialSku: string;
  quantity: number;
  unit: string;
  unitCost: number;
  wastagePercent: number;
}

interface BillOfMaterials {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  version: string;
  items: BOMItem[];
  laborCost: number;
  overheadCost: number;
  outputQuantity: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

interface ProductionOrder {
  id: string;
  orderNumber: string;
  bomId: string;
  productId: string;
  productName: string;
  quantity: number;
  branchId: string;
  branchName: string;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  startDate: string;
  endDate?: string;
  completedDate?: string;
  completedQuantity: number;
  wastedQuantity: number;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

interface MaterialConsumption {
  id: string;
  orderId: string;
  orderNumber: string;
  materialId: string;
  materialName: string;
  materialSku: string;
  quantityUsed: number;
  quantityWasted: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  date: string;
}

// Storage
const STORAGE_KEYS = {
  boms: 'kwanzaerp_boms',
  orders: 'kwanzaerp_production_orders',
  consumption: 'kwanzaerp_material_consumption',
};
function getStored<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function setStored<T>(key: string, data: T[]) { localStorage.setItem(key, JSON.stringify(data)); }

// Helpers
function getBOMTotalMaterialCost(bom: BillOfMaterials): number {
  return bom.items.reduce((sum, item) => {
    const effectiveQty = item.quantity * (1 + item.wastagePercent / 100);
    return sum + effectiveQty * item.unitCost;
  }, 0);
}

function getBOMTotalCost(bom: BillOfMaterials): number {
  return getBOMTotalMaterialCost(bom) + bom.laborCost + bom.overheadCost;
}

function getBOMUnitCost(bom: BillOfMaterials): number {
  return bom.outputQuantity > 0 ? getBOMTotalCost(bom) / bom.outputQuantity : 0;
}

export default function ProductionModule() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { user } = useAuth();
  const { currentBranch } = useBranchContext();
  const { products } = useProducts(currentBranch?.id);
  const [activeTab, setActiveTab] = useState('ordens');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // BOM form state
  const [bomFormOpen, setBomFormOpen] = useState(false);
  const [bomProduct, setBomProduct] = useState('');
  const [bomVersion, setBomVersion] = useState('1.0');
  const [bomLabor, setBomLabor] = useState(0);
  const [bomOverhead, setBomOverhead] = useState(0);
  const [bomOutputQty, setBomOutputQty] = useState(1);
  const [bomItems, setBomItems] = useState<BOMItem[]>([]);
  const [bomItemMaterial, setBomItemMaterial] = useState('');
  const [bomItemQty, setBomItemQty] = useState(1);
  const [bomItemWastage, setBomItemWastage] = useState(0);

  // Order form state
  const [orderFormOpen, setOrderFormOpen] = useState(false);
  const [orderProduct, setOrderProduct] = useState('');
  const [orderQty, setOrderQty] = useState(1);

  // Complete dialog
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeQty, setCompleteQty] = useState(0);
  const [completeWaste, setCompleteWaste] = useState(0);

  const refresh = () => setRefreshKey(k => k + 1);

  const orders = useMemo(() => {
    const all = getStored<ProductionOrder>(STORAGE_KEYS.orders);
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [refreshKey]);

  const boms = useMemo(() => getStored<BillOfMaterials>(STORAGE_KEYS.boms), [refreshKey]);
  const consumptions = useMemo(() => getStored<MaterialConsumption>(STORAGE_KEYS.consumption), [refreshKey]);

  const filteredOrders = useMemo(() => {
    if (!searchTerm) return orders;
    const q = searchTerm.toLowerCase();
    return orders.filter(o => o.orderNumber.toLowerCase().includes(q) || o.productName.toLowerCase().includes(q));
  }, [orders, searchTerm]);

  const filteredBOMs = useMemo(() => {
    if (!searchTerm) return boms;
    const q = searchTerm.toLowerCase();
    return boms.filter(b => b.productName.toLowerCase().includes(q) || b.productSku.toLowerCase().includes(q));
  }, [boms, searchTerm]);

  const summary = useMemo(() => ({
    total: orders.length,
    planned: orders.filter(o => o.status === 'planned').length,
    inProgress: orders.filter(o => o.status === 'in_progress').length,
    completed: orders.filter(o => o.status === 'completed').length,
  }), [orders]);

  // --- BOM Actions ---
  const addBomItem = () => {
    if (!bomItemMaterial) { toast.error(t.productionUi.selectMaterial); return; }
    const mat = products.find(p => p.id === bomItemMaterial);
    if (!mat) return;
    if (bomItems.some(i => i.materialId === mat.id)) { toast.error(t.productionUi.materialAlreadyAdded); return; }
    setBomItems(prev => [...prev, {
      id: `bi_${Date.now()}`,
      materialId: mat.id,
      materialName: mat.name,
      materialSku: mat.sku,
      quantity: bomItemQty,
      unit: mat.unit || 'un',
      unitCost: mat.cost || mat.avgCost || 0,
      wastagePercent: bomItemWastage,
    }]);
    setBomItemMaterial('');
    setBomItemQty(1);
    setBomItemWastage(0);
  };

  const removeBomItem = (id: string) => setBomItems(prev => prev.filter(i => i.id !== id));

  const saveBOM = () => {
    if (!bomProduct) { toast.error(t.productionUi.selectFinalProduct); return; }
    if (bomItems.length === 0) { toast.error('Adicione pelo menos um material'); return; }
    const prod = products.find(p => p.id === bomProduct);
    if (!prod) return;
    const all = getStored<BillOfMaterials>(STORAGE_KEYS.boms);
    const bom: BillOfMaterials = {
      id: `bom_${Date.now()}`,
      productId: prod.id,
      productName: prod.name,
      productSku: prod.sku,
      version: bomVersion,
      items: bomItems,
      laborCost: bomLabor,
      overheadCost: bomOverhead,
      outputQuantity: bomOutputQty,
      isActive: true,
      createdBy: user?.id || '',
      createdAt: new Date().toISOString(),
    };
    all.push(bom);
    setStored(STORAGE_KEYS.boms, all);
    toast.success(`BOM criada para ${prod.name}`);
    setBomFormOpen(false);
    resetBomForm();
    refresh();
  };

  const resetBomForm = () => {
    setBomProduct('');
    setBomVersion('1.0');
    setBomLabor(0);
    setBomOverhead(0);
    setBomOutputQty(1);
    setBomItems([]);
  };

  const deleteBOM = (id: string) => {
    const all = getStored<BillOfMaterials>(STORAGE_KEYS.boms).filter(b => b.id !== id);
    setStored(STORAGE_KEYS.boms, all);
    toast.success('BOM removida');
    refresh();
  };

  // --- Order Actions ---
  const createOrder = () => {
    if (!orderProduct) { toast.error(t.productionUi.selectProduct); return; }
    const product = products.find(p => p.id === orderProduct);
    if (!product) return;
    const bom = boms.find(b => b.productId === product.id && b.isActive);
    const all = getStored<ProductionOrder>(STORAGE_KEYS.orders);
    const seq = all.length + 1;
    const now = new Date();
    const order: ProductionOrder = {
      id: `po_${Date.now()}`,
      orderNumber: `PO-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(seq).padStart(3, '0')}`,
      bomId: bom?.id || '',
      productId: product.id,
      productName: product.name,
      quantity: orderQty,
      branchId: currentBranch?.id || '',
      branchName: currentBranch?.name || '',
      status: 'planned',
      startDate: now.toISOString(),
      completedQuantity: 0,
      wastedQuantity: 0,
      createdBy: user?.id || '',
      createdAt: now.toISOString(),
    };
    all.push(order);
    setStored(STORAGE_KEYS.orders, all);
    toast.success(`Ordem ${order.orderNumber} criada`);
    setOrderFormOpen(false);
    setOrderProduct('');
    setOrderQty(1);
    refresh();
  };

  const startOrder = (orderId: string) => {
    const all = getStored<ProductionOrder>(STORAGE_KEYS.orders);
    const idx = all.findIndex(o => o.id === orderId);
    if (idx >= 0) {
      all[idx].status = 'in_progress';
      setStored(STORAGE_KEYS.orders, all);
      toast.success(t.productionUi.productionStarted);
      refresh();
    }
  };

  const selectedOrder = orders.find(o => o.id === selectedId);

  const openComplete = () => {
    if (!selectedOrder || selectedOrder.status !== 'in_progress') return;
    setCompleteQty(selectedOrder.quantity);
    setCompleteWaste(0);
    setCompleteOpen(true);
  };

  const completeOrder = () => {
    if (!selectedOrder) return;
    const allOrders = getStored<ProductionOrder>(STORAGE_KEYS.orders);
    const idx = allOrders.findIndex(o => o.id === selectedOrder.id);
    if (idx < 0) return;

    allOrders[idx].status = 'completed';
    allOrders[idx].completedDate = new Date().toISOString();
    allOrders[idx].completedQuantity = completeQty;
    allOrders[idx].wastedQuantity = completeWaste;
    setStored(STORAGE_KEYS.orders, allOrders);

    // Record material consumption if BOM exists
    const bom = boms.find(b => b.id === selectedOrder.bomId);
    if (bom) {
      const allConsumption = getStored<MaterialConsumption>(STORAGE_KEYS.consumption);
      const ratio = selectedOrder.quantity / (bom.outputQuantity || 1);
      bom.items.forEach(item => {
        const qtyUsed = item.quantity * ratio;
        const qtyWasted = qtyUsed * (item.wastagePercent / 100);
        allConsumption.push({
          id: `mc_${Date.now()}_${item.id}`,
          orderId: selectedOrder.id,
          orderNumber: selectedOrder.orderNumber,
          materialId: item.materialId,
          materialName: item.materialName,
          materialSku: item.materialSku,
          quantityUsed: qtyUsed,
          quantityWasted: qtyWasted,
          unit: item.unit,
          unitCost: item.unitCost,
          totalCost: (qtyUsed + qtyWasted) * item.unitCost,
          date: new Date().toISOString(),
        });
      });
      setStored(STORAGE_KEYS.consumption, allConsumption);
    }

    toast.success(`Ordem concluída: ${completeQty} produzidas, ${completeWaste} desperdício`);
    setCompleteOpen(false);
    refresh();
  };

  const cancelOrder = (orderId: string) => {
    const all = getStored<ProductionOrder>(STORAGE_KEYS.orders);
    const idx = all.findIndex(o => o.id === orderId);
    if (idx >= 0) {
      all[idx].status = 'cancelled';
      setStored(STORAGE_KEYS.orders, all);
      toast.success('Ordem cancelada');
      refresh();
    }
  };

  // --- Cost Analysis ---
  const costAnalysis = useMemo(() => {
    const completedOrders = orders.filter(o => o.status === 'completed');
    let totalMaterialCost = 0;
    let totalLaborCost = 0;
    let totalOverheadCost = 0;
    let totalProduced = 0;

    completedOrders.forEach(order => {
      const bom = boms.find(b => b.id === order.bomId);
      if (bom) {
        const ratio = order.quantity / (bom.outputQuantity || 1);
        totalMaterialCost += getBOMTotalMaterialCost(bom) * ratio;
        totalLaborCost += bom.laborCost * ratio;
        totalOverheadCost += bom.overheadCost * ratio;
      }
      totalProduced += order.completedQuantity;
    });

    // Per-product breakdown
    const byProduct: Record<string, { name: string; produced: number; materialCost: number; laborCost: number; overheadCost: number; totalCost: number }> = {};
    completedOrders.forEach(order => {
      if (!byProduct[order.productId]) {
        byProduct[order.productId] = { name: order.productName, produced: 0, materialCost: 0, laborCost: 0, overheadCost: 0, totalCost: 0 };
      }
      const entry = byProduct[order.productId];
      entry.produced += order.completedQuantity;
      const bom = boms.find(b => b.id === order.bomId);
      if (bom) {
        const ratio = order.quantity / (bom.outputQuantity || 1);
        entry.materialCost += getBOMTotalMaterialCost(bom) * ratio;
        entry.laborCost += bom.laborCost * ratio;
        entry.overheadCost += bom.overheadCost * ratio;
      }
      entry.totalCost = entry.materialCost + entry.laborCost + entry.overheadCost;
    });

    return {
      totalMaterialCost,
      totalLaborCost,
      totalOverheadCost,
      totalCost: totalMaterialCost + totalLaborCost + totalOverheadCost,
      totalProduced,
      completedCount: completedOrders.length,
      byProduct: Object.values(byProduct),
    };
  }, [orders, boms]);

  const fmt = (v: number) => v.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b flex-wrap">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setOrderFormOpen(true)}>
          <Plus className="w-3 h-3" /> Nova Ordem
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { resetBomForm(); setBomFormOpen(true); }}>
          <Layers className="w-3 h-3" /> Nova BOM
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-blue-600 border-blue-200"
          disabled={!selectedOrder || selectedOrder.status !== 'planned'}
          onClick={() => selectedOrder && startOrder(selectedOrder.id)}>
          <Play className="w-3 h-3" /> Iniciar
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-green-600 border-green-200"
          disabled={!selectedOrder || selectedOrder.status !== 'in_progress'}
          onClick={openComplete}>
          <CheckCircle className="w-3 h-3" /> Concluir
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive"
          disabled={!selectedOrder || selectedOrder.status === 'completed' || selectedOrder.status === 'cancelled'}
          onClick={() => selectedOrder && cancelOrder(selectedOrder.id)}>
          <XCircle className="w-3 h-3" /> Cancelar
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={refresh}><RefreshCw className="w-3 h-3" /></Button>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-[10px] mr-2">
          <Badge variant="outline" className="gap-1"><Factory className="w-3 h-3" /> {summary.total}</Badge>
          <Badge variant="outline" className="gap-1 text-blue-600">{summary.planned} planeadas</Badge>
          <Badge variant="outline" className="gap-1 text-amber-600">{summary.inProgress} em curso</Badge>
          <Badge variant="outline" className="gap-1 text-green-600">{summary.completed} concluídas</Badge>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input placeholder="Pesquisar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-7 text-xs pl-7 w-40" />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 h-auto p-0">
          {[
            { key: 'ordens', labelKey: 'tabOrders', icon: Factory },
            { key: 'bom', label: 'Bill of Materials', icon: Layers },
            { key: 'consumo', labelKey: 'tabConsumption', icon: Package },
            { key: 'custos', labelKey: 'tabCosts', icon: Settings },
          ].map(tab => (
            <TabsTrigger key={tab.key} value={tab.key}
              className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-1.5 gap-1">
              <tab.icon className="w-3 h-3" /> {'labelKey' in tab ? (t.productionUi[tab.labelKey as keyof typeof t.productionUi] as string) : tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* === Orders Tab === */}
        <TabsContent value="ordens" className="flex-1 m-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-32">Nº Ordem</th>
                <th className="px-3 py-2 text-left font-semibold">Produto</th>
                <th className="px-3 py-2 text-right font-semibold w-16">Qtd</th>
                <th className="px-3 py-2 text-right font-semibold w-20">Concluído</th>
                <th className="px-3 py-2 text-right font-semibold w-20">Desperd.</th>
                <th className="px-3 py-2 text-left font-semibold w-20">Filial</th>
                <th className="px-3 py-2 text-left font-semibold w-24">Início</th>
                <th className="px-3 py-2 text-left font-semibold w-24">Conclusão</th>
                <th className="px-3 py-2 text-center font-semibold w-20">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredOrders.map(order => (
                <tr key={order.id} className={cn("cursor-pointer hover:bg-accent/50", selectedId === order.id && "bg-primary/15")}
                  onClick={() => setSelectedId(order.id)}>
                  <td className="px-3 py-1.5 font-mono">{order.orderNumber}</td>
                  <td className="px-3 py-1.5 font-medium">{order.productName}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{order.quantity}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{order.completedQuantity}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-destructive">{order.wastedQuantity || 0}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{order.branchName}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{new Date(order.startDate).toLocaleDateString(uiLocale)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{order.completedDate ? new Date(order.completedDate).toLocaleDateString(uiLocale) : '-'}</td>
                  <td className="px-3 py-1.5 text-center">
                    <Badge variant={
                      order.status === 'completed' ? 'default' :
                      order.status === 'in_progress' ? 'secondary' :
                      order.status === 'cancelled' ? 'destructive' : 'outline'
                    } className="text-[9px] px-1.5 py-0">
                      {order.status === 'planned' ? t.productionUi.statusPlanned :
                        order.status === 'in_progress' ? t.productionUi.statusInProgress :
                        order.status === 'completed' ? t.productionUi.statusCompleted :
                        t.productionUi.statusCancelled}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredOrders.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Factory className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t.productionUi.noProductionOrders}</p>
            </div>
          )}
        </TabsContent>

        {/* === BOM Tab === */}
        <TabsContent value="bom" className="flex-1 m-0 overflow-auto">
          {filteredBOMs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhuma BOM definida</p>
              <p className="text-xs mt-1">Clique em "Nova BOM" para definir a lista de materiais</p>
            </div>
          ) : (
            <div className="p-3 space-y-3">
              {filteredBOMs.map(bom => (
                <Card key={bom.id} className="border">
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-sm">{bom.productName} <span className="text-muted-foreground font-normal">({bom.productSku})</span></CardTitle>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Versão {bom.version} · Produz {bom.outputQuantity} un · Criada {new Date(bom.createdAt).toLocaleDateString('pt-AO')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          <DollarSign className="w-3 h-3 mr-0.5" /> Custo Total: {fmt(getBOMTotalCost(bom))} Kz
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          Custo/Un: {fmt(getBOMUnitCost(bom))} Kz
                        </Badge>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteBOM(bom.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="px-2 py-1 text-left">Material</th>
                          <th className="px-2 py-1 text-left">SKU</th>
                          <th className="px-2 py-1 text-right">Qtd</th>
                          <th className="px-2 py-1 text-right">Desperd. %</th>
                          <th className="px-2 py-1 text-right">Custo Unit.</th>
                          <th className="px-2 py-1 text-right">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {bom.items.map(item => {
                          const effectiveQty = item.quantity * (1 + item.wastagePercent / 100);
                          return (
                            <tr key={item.id}>
                              <td className="px-2 py-1">{item.materialName}</td>
                              <td className="px-2 py-1 font-mono text-muted-foreground">{item.materialSku}</td>
                              <td className="px-2 py-1 text-right font-mono">{item.quantity} {item.unit}</td>
                              <td className="px-2 py-1 text-right">{item.wastagePercent}%</td>
                              <td className="px-2 py-1 text-right font-mono">{fmt(item.unitCost)}</td>
                              <td className="px-2 py-1 text-right font-mono">{fmt(effectiveQty * item.unitCost)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t bg-muted/20 text-[10px]">
                        <tr><td colSpan={5} className="px-2 py-1 text-right font-semibold">Materiais:</td><td className="px-2 py-1 text-right font-mono">{fmt(getBOMTotalMaterialCost(bom))} Kz</td></tr>
                        <tr><td colSpan={5} className="px-2 py-1 text-right">Mão-de-obra:</td><td className="px-2 py-1 text-right font-mono">{fmt(bom.laborCost)} Kz</td></tr>
                        <tr><td colSpan={5} className="px-2 py-1 text-right">Overhead:</td><td className="px-2 py-1 text-right font-mono">{fmt(bom.overheadCost)} Kz</td></tr>
                      </tfoot>
                    </table>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* === Material Consumption Tab === */}
        <TabsContent value="consumo" className="flex-1 m-0 overflow-auto">
          {consumptions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum consumo registado</p>
              <p className="text-xs mt-1">Os consumos são registados automaticamente ao concluir ordens</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/60 border-b sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Ordem</th>
                  <th className="px-3 py-2 text-left font-semibold">Material</th>
                  <th className="px-3 py-2 text-left font-semibold">SKU</th>
                  <th className="px-3 py-2 text-right font-semibold">Usado</th>
                  <th className="px-3 py-2 text-right font-semibold">Desperdício</th>
                  <th className="px-3 py-2 text-right font-semibold">Custo Unit.</th>
                  <th className="px-3 py-2 text-right font-semibold">Custo Total</th>
                  <th className="px-3 py-2 text-left font-semibold">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {consumptions.map(c => (
                  <tr key={c.id} className="hover:bg-accent/50">
                    <td className="px-3 py-1.5 font-mono">{c.orderNumber}</td>
                    <td className="px-3 py-1.5">{c.materialName}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{c.materialSku}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(c.quantityUsed)} {c.unit}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-destructive">{fmt(c.quantityWasted)} {c.unit}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(c.unitCost)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmt(c.totalCost)} Kz</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{new Date(c.date).toLocaleDateString('pt-AO')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/30">
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-right font-semibold text-xs">Total Consumido:</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-xs">{fmt(consumptions.reduce((s, c) => s + c.totalCost, 0))} Kz</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </TabsContent>

        {/* === Production Costs Tab === */}
        <TabsContent value="custos" className="flex-1 m-0 overflow-auto p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Card><CardContent className="pt-4 pb-3 text-center">
              <p className="text-[10px] text-muted-foreground">Custo Total Materiais</p>
              <p className="text-lg font-bold font-mono">{fmt(costAnalysis.totalMaterialCost)} <span className="text-xs font-normal">Kz</span></p>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 text-center">
              <p className="text-[10px] text-muted-foreground">Custo Mão-de-Obra</p>
              <p className="text-lg font-bold font-mono">{fmt(costAnalysis.totalLaborCost)} <span className="text-xs font-normal">Kz</span></p>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 text-center">
              <p className="text-[10px] text-muted-foreground">Overhead</p>
              <p className="text-lg font-bold font-mono">{fmt(costAnalysis.totalOverheadCost)} <span className="text-xs font-normal">Kz</span></p>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 text-center">
              <p className="text-[10px] text-muted-foreground">Custo Total Produção</p>
              <p className="text-lg font-bold font-mono text-primary">{fmt(costAnalysis.totalCost)} <span className="text-xs font-normal">Kz</span></p>
            </CardContent></Card>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <Card><CardContent className="pt-4 pb-3 text-center">
              <p className="text-[10px] text-muted-foreground">{t.productionUi.completedOrders}</p>
              <p className="text-2xl font-bold">{costAnalysis.completedCount}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 text-center">
              <p className="text-[10px] text-muted-foreground">Unidades Produzidas</p>
              <p className="text-2xl font-bold">{costAnalysis.totalProduced}</p>
            </CardContent></Card>
          </div>

          {costAnalysis.byProduct.length > 0 && (
            <Card>
              <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Custos por Produto</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Produto</th>
                      <th className="px-2 py-1.5 text-right">Produzido</th>
                      <th className="px-2 py-1.5 text-right">Materiais</th>
                      <th className="px-2 py-1.5 text-right">Mão-de-obra</th>
                      <th className="px-2 py-1.5 text-right">Overhead</th>
                      <th className="px-2 py-1.5 text-right">Total</th>
                      <th className="px-2 py-1.5 text-right">Custo/Un</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {costAnalysis.byProduct.map((p, i) => (
                      <tr key={i} className="hover:bg-accent/50">
                        <td className="px-2 py-1.5 font-medium">{p.name}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{p.produced}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(p.materialCost)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(p.laborCost)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(p.overheadCost)}</td>
                        <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmt(p.totalCost)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-primary">{fmt(p.produced > 0 ? p.totalCost / p.produced : 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {costAnalysis.completedCount === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Settings className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Sem dados de custos</p>
              <p className="text-xs mt-1">Conclua ordens de produção com BOM para ver a análise</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Order Dialog */}
      <Dialog open={orderFormOpen} onOpenChange={setOrderFormOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova Ordem de Produção</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Produto a Produzir</Label>
              <Select value={orderProduct} onValueChange={setOrderProduct}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t.productionUi.selectProductPlaceholder} /></SelectTrigger>
                <SelectContent>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {orderProduct && boms.find(b => b.productId === orderProduct && b.isActive) && (
                <p className="text-[10px] text-green-600">✓ BOM encontrada — consumo será calculado automaticamente</p>
              )}
              {orderProduct && !boms.find(b => b.productId === orderProduct && b.isActive) && (
                <p className="text-[10px] text-amber-600">⚠ Sem BOM — consumo não será registado</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quantidade</Label>
              <Input type="number" value={orderQty} onChange={e => setOrderQty(Number(e.target.value))} className="h-8 text-xs" min={1} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderFormOpen(false)}>Cancelar</Button>
            <Button onClick={createOrder}>Criar Ordem</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BOM Form Dialog */}
      <Dialog open={bomFormOpen} onOpenChange={setBomFormOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nova Bill of Materials</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Produto Final</Label>
                <Select value={bomProduct} onValueChange={setBomProduct}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Versão</Label>
                <Input value={bomVersion} onChange={e => setBomVersion(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Qtd. Produzida</Label>
                <Input type="number" value={bomOutputQty} onChange={e => setBomOutputQty(Number(e.target.value))} className="h-8 text-xs" min={1} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mão-de-Obra (Kz)</Label>
                <Input type="number" value={bomLabor} onChange={e => setBomLabor(Number(e.target.value))} className="h-8 text-xs" min={0} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Overhead (Kz)</Label>
                <Input type="number" value={bomOverhead} onChange={e => setBomOverhead(Number(e.target.value))} className="h-8 text-xs" min={0} />
              </div>
            </div>

            {/* Add material */}
            <div className="border rounded p-3 space-y-2 bg-muted/20">
              <p className="text-xs font-semibold">Adicionar Material</p>
              <div className="flex gap-2">
                <Select value={bomItemMaterial} onValueChange={setBomItemMaterial}>
                  <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Material..." /></SelectTrigger>
                  <SelectContent>
                    {products.filter(p => p.id !== bomProduct).map(p => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" value={bomItemQty} onChange={e => setBomItemQty(Number(e.target.value))} className="h-8 text-xs w-20" placeholder="Qtd" min={0.01} step={0.01} />
                <Input type="number" value={bomItemWastage} onChange={e => setBomItemWastage(Number(e.target.value))} className="h-8 text-xs w-20" placeholder="Desp.%" min={0} />
                <Button size="sm" className="h-8" onClick={addBomItem}><Plus className="w-3 h-3" /></Button>
              </div>
            </div>

            {/* Materials list */}
            {bomItems.length > 0 && (
              <table className="w-full text-xs border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-2 py-1 text-left">Material</th>
                    <th className="px-2 py-1 text-right">Qtd</th>
                    <th className="px-2 py-1 text-right">Desp.%</th>
                    <th className="px-2 py-1 text-right">Custo</th>
                    <th className="px-2 py-1 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bomItems.map(item => (
                    <tr key={item.id}>
                      <td className="px-2 py-1">{item.materialName}</td>
                      <td className="px-2 py-1 text-right font-mono">{item.quantity} {item.unit}</td>
                      <td className="px-2 py-1 text-right">{item.wastagePercent}%</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(item.quantity * (1 + item.wastagePercent / 100) * item.unitCost)}</td>
                      <td className="px-2 py-1 text-center"><Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => removeBomItem(item.id)}><Trash2 className="w-3 h-3" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBomFormOpen(false)}>Cancelar</Button>
            <Button onClick={saveBOM}>Guardar BOM</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Order Dialog */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Concluir Ordem {selectedOrder?.orderNumber}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Quantidade Produzida</Label>
              <Input type="number" value={completeQty} onChange={e => setCompleteQty(Number(e.target.value))} className="h-8 text-xs" min={0} max={selectedOrder?.quantity || 0} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quantidade Desperdiçada</Label>
              <Input type="number" value={completeWaste} onChange={e => setCompleteWaste(Number(e.target.value))} className="h-8 text-xs" min={0} />
            </div>
            {selectedOrder?.bomId && boms.find(b => b.id === selectedOrder.bomId) && (
              <p className="text-[10px] text-green-600">✓ Consumo de materiais será registado automaticamente</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpen(false)}>Cancelar</Button>
            <Button onClick={completeOrder}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
