import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  PackageMinus, 
  Search, 
  Plus, 
  Trash2,
  Save,
  AlertTriangle
} from 'lucide-react';
import { Product, Branch } from '@/types/erp';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';

const exitReasonColors: Record<string, string> = {
  expired: 'text-amber-600',
  damaged: 'text-red-600',
  loss: 'text-destructive',
  internal_use: 'text-blue-600',
  sample: 'text-purple-600',
  donation: 'text-emerald-600',
};

interface ExitItem {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  currentStock: number;
  quantity: number;
  cost: number;
}

interface StockExitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  currentBranch: Branch | null;
  onApplyExit: (items: ExitItem[], reason: string, notes: string, reference: string) => void;
}

export function StockExitDialog({
  open,
  onOpenChange,
  products,
  currentBranch,
  onApplyExit,
}: StockExitDialogProps) {
  const { toast } = useToast();
  const { t, language } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [reason, setReason] = useState<string>('expired');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ExitItem[]>([]);
  const [newItemQty, setNewItemQty] = useState<Record<string, number>>({});

  const EXIT_REASONS = useMemo(() => ([
    { value: 'expired', label: t.stockExitUi.reasonExpired, color: exitReasonColors.expired },
    { value: 'damaged', label: t.stockExitUi.reasonDamaged, color: exitReasonColors.damaged },
    { value: 'loss', label: t.stockExitUi.reasonLoss, color: exitReasonColors.loss },
    { value: 'internal_use', label: t.stockExitUi.reasonInternalUse, color: exitReasonColors.internal_use },
    { value: 'sample', label: t.stockExitUi.reasonSample, color: exitReasonColors.sample },
    { value: 'donation', label: t.stockExitUi.reasonDonation, color: exitReasonColors.donation },
  ]), [t]);

  // Search products
  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    const term = searchTerm.toLowerCase();
    return products
      .filter(p => 
        p.stock > 0 && (
          p.sku.toLowerCase().includes(term) || 
          p.name.toLowerCase().includes(term) ||
          p.barcode?.toLowerCase().includes(term)
        )
      )
      .slice(0, 10);
  }, [products, searchTerm]);

  // Generate exit number
  const exitNumber = useMemo(() => {
    const date = format(new Date(), 'yyyyMMdd');
    const seq = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `SAI-${currentBranch?.code || 'XX'}-${date}-${seq}`;
  }, [currentBranch]);

  // Add item to list
  const handleAddItem = (product: Product) => {
    const qty = newItemQty[product.id] || 1;
    const existing = items.find(i => i.productId === product.id);
    
    if (existing) {
      const newQty = Math.min(existing.quantity + qty, product.stock);
      setItems(prev => prev.map(i => 
        i.productId === product.id 
          ? { ...i, quantity: newQty }
          : i
      ));
    } else {
      setItems(prev => [...prev, {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        currentStock: product.stock,
        quantity: Math.min(qty, product.stock),
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
    const item = items.find(i => i.productId === productId);
    if (!item) return;
    
    if (quantity <= 0) {
      handleRemoveItem(productId);
      return;
    }
    
    // Can't remove more than current stock
    const maxQty = item.currentStock;
    const validQty = Math.min(quantity, maxQty);
    
    setItems(prev => prev.map(i => 
      i.productId === productId ? { ...i, quantity: validQty } : i
    ));
  };

  // Calculate totals
  const totals = useMemo(() => ({
    items: items.length,
    units: items.reduce((sum, i) => sum + i.quantity, 0),
    value: items.reduce((sum, i) => sum + (i.quantity * i.cost), 0),
  }), [items]);

  // Apply exit
  const handleApply = () => {
    if (items.length === 0) {
      toast({
        title: t.stockExitUi.noItemsTitle,
        description: t.stockExitUi.addAtLeastOne,
        variant: 'destructive',
      });
      return;
    }

    const reasonLabel = EXIT_REASONS.find(r => r.value === reason)?.label || reason;
    onApplyExit(items, reasonLabel, notes, reference || exitNumber);
    
    toast({
      title: t.stockExitUi.exitRecorded,
      description: t.stockExitUi.productsRemovedDesc.replace('{count}', String(items.length)),
    });

    // Reset form
    setItems([]);
    setReason('expired');
    setReference('');
    setNotes('');
    onOpenChange(false);
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(language === 'pt' ? 'pt-AO' : 'en-GB', { style: 'currency', currency: 'AOA' }).format(value);

  const selectedReason = EXIT_REASONS.find(r => r.value === reason);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="w-5 h-5 text-destructive" />
            {t.stockExitUi.title}
          </DialogTitle>
          <DialogDescription>
            {t.stockExitUi.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Exit Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/30">
            <div className="space-y-2">
              <Label>{t.stockExitUi.exitNo}</Label>
              <Input value={exitNumber} readOnly className="font-mono bg-muted" />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {t.stockExitUi.exitReason} *
              </Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border shadow-lg z-50">
                  {EXIT_REASONS.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      <span className={r.color}>{r.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.stockExitUi.reference}</Label>
              <Input 
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Nº documento..."
              />
            </div>
          </div>

          {/* Warning for loss/theft */}
          {reason === 'loss' && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t.stockExitUi.lossWarning}
              </AlertDescription>
            </Alert>
          )}

          {/* Search Products */}
          <div className="space-y-2">
            <Label>Adicionar Produtos (apenas com stock &gt; 0)</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t.stockExitUi.searchPlaceholder}
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
                      <span className="text-xs text-muted-foreground ml-2">(Stock: {p.stock})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        max={p.stock}
                        value={newItemQty[p.id] || 1}
                        onChange={(e) => setNewItemQty(prev => ({ 
                          ...prev, 
                          [p.id]: Math.min(parseInt(e.target.value) || 1, p.stock)
                        }))}
                        className="w-20 h-8"
                      />
                      <Button 
                        size="sm" 
                        variant="destructive"
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
                  <TableHead className="w-[60px] text-center">Un.</TableHead>
                  <TableHead className="w-[100px] text-center">Stock Atual</TableHead>
                  <TableHead className="w-[120px] text-center">Qtd a Sair</TableHead>
                  <TableHead className="w-[120px] text-right">Custo Un.</TableHead>
                  <TableHead className="w-[120px] text-right">Valor Perda</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      <PackageMinus className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>Nenhum produto adicionado</p>
                      <p className="text-xs">Pesquise e adicione produtos acima</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.productId} className="bg-red-50 dark:bg-red-950/20">
                      <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                      <TableCell>{item.name}</TableCell>
                      <TableCell className="text-center">{item.unit}</TableCell>
                      <TableCell className="text-center">{item.currentStock}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="1"
                          max={item.currentStock}
                          value={item.quantity}
                          onChange={(e) => handleUpdateQuantity(item.productId, parseInt(e.target.value) || 0)}
                          className="h-8 text-center"
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(item.cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium text-destructive">
                        -{formatCurrency(item.quantity * item.cost)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          onClick={() => handleRemoveItem(item.productId)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 p-4 border rounded-lg bg-red-50 dark:bg-red-950/30">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Itens</p>
              <p className="text-xl font-bold">{totals.items}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Total Unidades</p>
              <p className="text-xl font-bold">{totals.units}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Valor da Perda</p>
              <p className="text-xl font-bold text-destructive">-{formatCurrency(totals.value)}</p>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Observações / Justificação *</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.stockExitUi.detailedReasonPlaceholder}
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
            variant="destructive"
            disabled={items.length === 0}
          >
            <Save className="w-4 h-4 mr-2" />
            Confirmar Saída ({items.length} itens)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
