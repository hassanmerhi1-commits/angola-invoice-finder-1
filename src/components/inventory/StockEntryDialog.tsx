import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { 
  PackagePlus, 
  Search, 
  Plus, 
  Trash2,
  Save,
  Building2,
  Truck,
  DollarSign
} from 'lucide-react';
import { Product, Branch } from '@/types/erp';
import { useBranches } from '@/hooks/useERP';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';

interface EntryItem {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  cost: number;
  freightAllocation?: number;
  effectiveCost?: number;
}

interface StockEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  currentBranch: Branch | null;
  onApplyEntry: (items: EntryItem[], sourceBranch: string, reference: string, notes: string) => void;
}

export function StockEntryDialog({
  open,
  onOpenChange,
  products,
  currentBranch,
  onApplyEntry,
}: StockEntryDialogProps) {
  const { toast } = useToast();
  const { t, language } = useTranslation();
  const { branches } = useBranches();
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceBranch, setSourceBranch] = useState<string>('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<EntryItem[]>([]);
  const [newItemQty, setNewItemQty] = useState<Record<string, number>>({});
  
  // Freight/transportation costs
  const [freightCost, setFreightCost] = useState<number>(0);
  const [otherCosts, setOtherCosts] = useState<number>(0);
  const [otherCostsDescription, setOtherCostsDescription] = useState<string>('');

  // Filter out current branch from source options
  const sourceBranches = useMemo(() => 
    branches.filter(b => b.id !== currentBranch?.id),
    [branches, currentBranch]
  );

  // Search products
  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    const term = searchTerm.toLowerCase();
    return products
      .filter(p => 
        p.sku.toLowerCase().includes(term) || 
        p.name.toLowerCase().includes(term) ||
        p.barcode?.toLowerCase().includes(term)
      )
      .slice(0, 10);
  }, [products, searchTerm]);

  // Generate entry number
  const entryNumber = useMemo(() => {
    const date = format(new Date(), 'yyyyMMdd');
    const seq = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `ENT-${currentBranch?.code || 'XX'}-${date}-${seq}`;
  }, [currentBranch]);

  // Add item to list
  const handleAddItem = (product: Product) => {
    const qty = newItemQty[product.id] || 1;
    const existing = items.find(i => i.productId === product.id);
    
    if (existing) {
      setItems(prev => prev.map(i => 
        i.productId === product.id 
          ? { ...i, quantity: i.quantity + qty }
          : i
      ));
    } else {
      setItems(prev => [...prev, {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        quantity: qty,
        cost: product.cost || 0,
      }]);
    }
    
    setNewItemQty(prev => ({ ...prev, [product.id]: 1 }));
    setSearchTerm('');
  };

  // Remove item from list
  const handleRemoveItem = (productId: string) => {
    setItems(prev => prev.filter(i => i.productId !== productId));
  };

  // Update quantity
  const handleUpdateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveItem(productId);
      return;
    }
    setItems(prev => prev.map(i => 
      i.productId === productId ? { ...i, quantity } : i
    ));
  };

  // Calculate totals
  const itemsValue = useMemo(() => 
    items.reduce((sum, i) => sum + (i.quantity * i.cost), 0), 
    [items]
  );
  
  const totalLandingCosts = freightCost + otherCosts;
  const grandTotal = itemsValue + totalLandingCosts;

  // Calculate freight allocation per unit (proportional to value)
  const freightAllocations = useMemo(() => {
    if (itemsValue === 0 || totalLandingCosts === 0) return {};
    const allocations: Record<string, number> = {};
    items.forEach(item => {
      const itemValue = item.quantity * item.cost;
      const proportion = itemValue / itemsValue;
      allocations[item.productId] = (totalLandingCosts * proportion) / item.quantity;
    });
    return allocations;
  }, [items, itemsValue, totalLandingCosts]);

  const totals = useMemo(() => ({
    items: items.length,
    units: items.reduce((sum, i) => sum + i.quantity, 0),
    value: grandTotal,
  }), [items, grandTotal]);

  // Apply entry with freight allocation
  const handleApply = () => {
    if (items.length === 0) {
      toast({
        title: t.stockEntryUi.noItemsTitle,
        description: t.stockEntryUi.addAtLeastOne,
        variant: 'destructive',
      });
      return;
    }

    if (!sourceBranch) {
      toast({
        title: t.stockEntryUi.sourceBranchRequiredTitle,
        description: t.stockEntryUi.selectSourceBranchDesc,
        variant: 'destructive',
      });
      return;
    }

    // Add freight allocation to each item
    const itemsWithFreight = items.map(item => ({
      ...item,
      freightAllocation: freightAllocations[item.productId] || 0,
      effectiveCost: item.cost + (freightAllocations[item.productId] || 0),
    }));

    onApplyEntry(itemsWithFreight, sourceBranch, reference || entryNumber, notes);
    
    toast({
      title: t.stockEntryUi.entryRecorded,
      description: t.stockEntryUi.productsAddedDesc.replace('{count}', String(items.length)),
    });

    // Reset form
    setItems([]);
    setSourceBranch('');
    setReference('');
    setNotes('');
    setFreightCost(0);
    setOtherCosts(0);
    setOtherCostsDescription('');
    onOpenChange(false);
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(language === 'pt' ? 'pt-AO' : 'en-GB', { style: 'currency', currency: 'AOA' }).format(value);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="w-5 h-5 text-primary" />
            {t.stockEntryUi.title}
          </DialogTitle>
          <DialogDescription>
            {t.stockEntryUi.description.replace('{branch}', currentBranch?.name || t.stockEntryUi.thisBranch)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Entry Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/30">
            <div className="space-y-2">
              <Label>{t.stockEntryUi.entryNo}</Label>
              <Input value={entryNumber} readOnly className="font-mono bg-muted" />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                {t.stockEntryUi.sourceBranch} *
              </Label>
              <Select value={sourceBranch} onValueChange={setSourceBranch}>
                <SelectTrigger>
                  <SelectValue placeholder={t.stockEntryUi.selectSource} />
                </SelectTrigger>
                <SelectContent className="bg-background border shadow-lg z-50">
                  {sourceBranches.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Referência / Guia</Label>
              <Input 
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Nº guia de remessa..."
              />
            </div>
          </div>

          {/* Search Products */}
          <div className="space-y-2">
            <Label>Adicionar Produtos</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t.stockEntryUi.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            {/* Search Results */}
            {filteredProducts.length > 0 && (
              <div className="border rounded-lg max-h-48 overflow-auto">
                {filteredProducts.map(p => (
                  <div 
                    key={p.id} 
                    className="flex items-center justify-between p-2 hover:bg-muted border-b last:border-b-0"
                  >
                    <div className="flex-1">
                      <span className="font-mono text-sm mr-2">{p.sku}</span>
                      <span className="text-sm">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        value={newItemQty[p.id] || 1}
                        onChange={(e) => setNewItemQty(prev => ({ 
                          ...prev, 
                          [p.id]: parseInt(e.target.value) || 1 
                        }))}
                        className="w-20 h-8"
                      />
                      <Button 
                        size="sm" 
                        className="h-8"
                        onClick={() => handleAddItem(p)}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Items Table */}
          <ScrollArea className="flex-1 border rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[100px]">Código</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-[50px] text-center">Un.</TableHead>
                  <TableHead className="w-[100px] text-center">Qtd</TableHead>
                  <TableHead className="w-[100px] text-right">Custo</TableHead>
                  <TableHead className="w-[80px] text-right">Frete</TableHead>
                  <TableHead className="w-[100px] text-right">Custo Efetivo</TableHead>
                  <TableHead className="w-[100px] text-right">Total</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      <PackagePlus className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>Nenhum produto adicionado</p>
                      <p className="text-xs">Pesquise e adicione produtos acima</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const freightPerUnit = freightAllocations[item.productId] || 0;
                    const effectiveCost = item.cost + freightPerUnit;
                    return (
                      <TableRow key={item.productId}>
                        <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                        <TableCell className="truncate max-w-[150px]" title={item.name}>{item.name}</TableCell>
                        <TableCell className="text-center">{item.unit}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleUpdateQuantity(item.productId, parseInt(e.target.value) || 0)}
                            className="h-8 text-center"
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(item.cost)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {freightPerUnit > 0 ? `+${formatCurrency(freightPerUnit)}` : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium text-primary">
                          {formatCurrency(effectiveCost)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(item.quantity * effectiveCost)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveItem(item.productId)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          {/* Freight and Landing Costs */}
          <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Truck className="w-4 h-4" />
              Custos de Transporte / Frete
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Frete (Kz)</Label>
                <Input
                  type="number"
                  min="0"
                  value={freightCost || ''}
                  onChange={(e) => setFreightCost(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Outros Custos (Kz)</Label>
                <Input
                  type="number"
                  min="0"
                  value={otherCosts || ''}
                  onChange={(e) => setOtherCosts(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Descrição Outros</Label>
                <Input
                  value={otherCostsDescription}
                  onChange={(e) => setOtherCostsDescription(e.target.value)}
                  placeholder="Descarga, seguro..."
                />
              </div>
            </div>
            {totalLandingCosts > 0 && items.length > 0 && (
              <div className="text-xs text-muted-foreground bg-background p-2 rounded">
                <DollarSign className="w-3 h-3 inline mr-1" />
                Custo adicional será distribuído proporcionalmente entre os {items.length} produtos
                ({formatCurrency(totalLandingCosts / totals.units)} por unidade média)
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-4 p-4 border rounded-lg bg-primary/5">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Itens</p>
              <p className="text-xl font-bold">{totals.items}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Unidades</p>
              <p className="text-xl font-bold">{totals.units}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Valor Produtos</p>
              <p className="text-lg font-medium">{formatCurrency(itemsValue)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Total c/ Frete</p>
              <p className="text-xl font-bold text-primary">{formatCurrency(totals.value)}</p>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas adicionais sobre esta entrada..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            onClick={handleApply}
            disabled={items.length === 0}
          >
            <Save className="w-4 h-4 mr-2" />
            Confirmar Entrada ({items.length} itens)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
