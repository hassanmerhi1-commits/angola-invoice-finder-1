import { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Package, ArrowRightLeft } from 'lucide-react';
import { Product, StockMovement, StockTransfer } from '@/types/erp';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api/client';
import { getTransactionHistory } from '@/lib/transactionHistory';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useBranchContext } from '@/contexts/BranchContext';
import { STOCK_TRANSFERS_CHANGED_EVENT } from '@/lib/storage';
import { onTableSync } from '@/lib/realtime/socket';
import {
  buildPendingTransferRows,
  mapStockTransferRow,
} from '@/lib/stockTransferUtils';
import { formatBranchDisplayName } from '@/lib/branchDisplay';
import { useTranslation } from '@/i18n';

export function filterMovementsForProduct(
  movements: StockMovement[],
  product: Product | null,
  allBranchProducts?: Record<string, Product[]>,
  scopedBranchIds?: string[]
): StockMovement[] {
  if (!product) return [];
  const skuKey = (product.sku || '').trim().toLowerCase();
  const productIds = new Set<string>([product.id]);
  if (allBranchProducts) {
    const branchKeys = scopedBranchIds?.length
      ? scopedBranchIds
      : Object.keys(allBranchProducts);
    for (const branchId of branchKeys) {
      const rows = allBranchProducts[branchId] || [];
      for (const row of rows) {
        const rowSku = (row.sku || '').trim().toLowerCase();
        if (row.id === product.id || (skuKey && rowSku === skuKey)) {
          productIds.add(row.id);
        }
      }
    }
  }
  return movements.filter((m) => {
    if (productIds.has(m.productId)) return true;
    if (!skuKey) return false;
    return (m.sku || '').trim().toLowerCase() === skuKey;
  });
}

function SelectProductHint({ message }: { message: string }) {
  return (
    <Card className="h-full min-h-[200px] flex items-center justify-center">
      <CardContent className="text-center py-12">
        <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
        <p className="text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}

type PanelProps = {
  product: Product | null;
  movements: StockMovement[];
  allBranchProducts?: Record<string, Product[]>;
  scopedBranchIds?: string[];
  uiLocale: string;
  getReasonLabel: (reason: StockMovement['reason']) => string;
};

export function InventoryMonthlyMovementsPanel({
  product,
  movements,
  allBranchProducts,
  scopedBranchIds,
}: Pick<PanelProps, 'product' | 'movements' | 'allBranchProducts' | 'scopedBranchIds'>) {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    const filtered = filterMovementsForProduct(movements, product, allBranchProducts, scopedBranchIds);
    const byMonth = new Map<string, { entries: number; exits: number }>();
    for (const m of filtered) {
      const d = new Date(m.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = byMonth.get(key) || { entries: 0, exits: 0 };
      if (m.type === 'IN') bucket.entries += m.quantity;
      else bucket.exits += m.quantity;
      byMonth.set(key, bucket);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, data]) => ({
        month,
        entries: data.entries,
        exits: data.exits,
        balance: data.entries - data.exits,
      }));
  }, [movements, product, allBranchProducts, scopedBranchIds]);

  if (!product) {
    return <SelectProductHint message={t.inventoryPageUi.selectProductToViewStatement} />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{product.sku} — {product.name}</CardTitle>
        <CardDescription>{t.inventoryPageUi.monthlyMovements}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.inventoryPageUi.panel.month}</TableHead>
              <TableHead className="text-right">{t.inventoryPageUi.entriesLabel.replace(':', '')}</TableHead>
              <TableHead className="text-right">{t.inventoryPageUi.exitsLabel.replace(':', '')}</TableHead>
              <TableHead className="text-right">{t.inventoryPageUi.movementBalanceLabel.replace(':', '')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.month}>
                <TableCell className="font-mono">{row.month}</TableCell>
                <TableCell className="text-right text-green-600">{row.entries}</TableCell>
                <TableCell className="text-right text-destructive">{row.exits}</TableCell>
                <TableCell className="text-right font-medium">{row.balance}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <EmptyTableRow colSpan={4} message={t.inventoryUi.noMovementsForProduct} />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function InventoryMovementChartPanel({
  product,
  movements,
  allBranchProducts,
  scopedBranchIds,
}: Pick<PanelProps, 'product' | 'movements' | 'allBranchProducts' | 'scopedBranchIds'>) {
  const { t } = useTranslation();
  const chartData = useMemo(() => {
    const filtered = filterMovementsForProduct(movements, product, allBranchProducts, scopedBranchIds);
    const byMonth = new Map<string, { entries: number; exits: number }>();
    for (const m of filtered) {
      const d = new Date(m.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = byMonth.get(key) || { entries: 0, exits: 0 };
      if (m.type === 'IN') bucket.entries += m.quantity;
      else bucket.exits += m.quantity;
      byMonth.set(key, bucket);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, data]) => ({
        month,
        entries: data.entries,
        exits: data.exits,
      }));
  }, [movements, product, allBranchProducts, scopedBranchIds]);

  if (!product) {
    return <SelectProductHint message={t.inventoryPageUi.selectProductToViewStatement} />;
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">{t.inventoryUi.noMovementsForProduct}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{product.name}</CardTitle>
        <CardDescription>{t.inventoryPageUi.movementCharts}</CardDescription>
      </CardHeader>
      <CardContent className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="entries" name={t.inventoryUi.entry} fill="hsl(var(--chart-2))" />
            <Bar dataKey="exits" name={t.inventoryUi.exit} fill="hsl(var(--destructive))" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function MovementCostTable({
  product,
  movements,
  allBranchProducts,
  scopedBranchIds,
  uiLocale,
  getReasonLabel,
  filter,
  title,
  description,
}: PanelProps & {
  filter: (m: StockMovement) => boolean;
  title: string;
  description: string;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    return filterMovementsForProduct(movements, product, allBranchProducts, scopedBranchIds)
      .filter(filter)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [movements, product, allBranchProducts, scopedBranchIds, filter]);

  if (!product) {
    return <SelectProductHint message={t.inventoryPageUi.selectProductToViewStatement} />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description} — {product.sku}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.inventoryPageUi.table.dateTime}</TableHead>
              <TableHead>{t.inventoryPageUi.table.document}</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">{t.inventoryPageUi.table.cost}</TableHead>
              <TableHead>{t.inventoryPageUi.table.reason}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(m.createdAt).toLocaleString(uiLocale)}
                </TableCell>
                <TableCell className="font-mono text-xs">{m.referenceNumber || '—'}</TableCell>
                <TableCell className="text-right font-mono">{m.quantity}</TableCell>
                <TableCell className="text-right font-mono">
                  {(m.costAtTime || 0).toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell>{getReasonLabel(m.reason)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <EmptyTableRow colSpan={5} message={t.inventoryUi.noMovementsForProduct} />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function InventoryCostHistoryPanel(props: PanelProps) {
  const { t } = useTranslation();
  return (
    <MovementCostTable
      {...props}
      title={t.inventoryPageUi.tabs.costHistory}
      description={t.inventoryPageUi.costHistoryPlaceholder}
      filter={(m) => m.type === 'IN' && (m.costAtTime || 0) > 0}
    />
  );
}

export function InventoryPurchasePricePanel(props: PanelProps) {
  const { t } = useTranslation();
  const purchaseFilter = (m: StockMovement) => {
    if (m.type !== 'IN') return false;
    const reason = String(m.reason || '').toLowerCase();
    return reason.includes('purchase') || reason === 'purchase_invoice';
  };
  return (
    <MovementCostTable
      {...props}
      title={t.inventoryPageUi.tabs.purchasePrice}
      description={t.inventoryPageUi.purchasePriceHistory}
      filter={purchaseFilter}
    />
  );
}

export function InventoryMonthlySalesPanel({
  product,
  movements,
  allBranchProducts,
  scopedBranchIds,
  uiLocale,
}: Pick<PanelProps, 'product' | 'movements' | 'allBranchProducts' | 'scopedBranchIds' | 'uiLocale'>) {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    const filtered = filterMovementsForProduct(movements, product, allBranchProducts, scopedBranchIds).filter((m) => {
      if (m.type !== 'OUT') return false;
      const reason = String(m.reason || '').toLowerCase();
      return reason.includes('sale') || reason === 'sale';
    });
    const byMonth = new Map<string, { qty: number; value: number }>();
    for (const m of filtered) {
      const d = new Date(m.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = byMonth.get(key) || { qty: 0, value: 0 };
      bucket.qty += m.quantity;
      bucket.value += m.quantity * (m.costAtTime || 0);
      byMonth.set(key, bucket);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, data]) => ({ month, qty: data.qty, value: data.value }));
  }, [movements, product, allBranchProducts, scopedBranchIds]);

  if (!product) {
    return <SelectProductHint message={t.inventoryPageUi.selectProductToViewStatement} />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t.inventoryPageUi.monthlyProductSales}</CardTitle>
        <CardDescription>{product.sku} — {product.name}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.inventoryPageUi.panel.month}</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">{t.inventoryPageUi.panel.costValue}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.month}>
                <TableCell className="font-mono">{row.month}</TableCell>
                <TableCell className="text-right">{row.qty}</TableCell>
                <TableCell className="text-right font-mono">
                  {row.value.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} Kz
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <EmptyTableRow colSpan={3} message={t.inventoryPageUi.panel.noSalesMovements} />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function InventoryProductOrdersPanel({ product }: { product: Product | null }) {
  const { t } = useTranslation();
  const { currentBranch } = useBranchContext();
  const [orders, setOrders] = useState<
    Array<{
      orderNumber: string;
      supplierName: string;
      status: string;
      quantity: number;
      unitCost: number;
      date: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!product) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await api.purchaseOrders.list(currentBranch?.id);
        const raw = result.data || [];
        const skuKey = (product.sku || '').trim().toLowerCase();
        const matched: typeof orders = [];
        for (const order of raw) {
          const items = order.items || [];
          for (const item of items) {
            const itemSku = String(item.sku || item.product_sku || '').trim().toLowerCase();
            const itemProductId = item.product_id || item.productId;
            if (itemProductId !== product.id && itemSku !== skuKey) continue;
            matched.push({
              orderNumber: order.order_number || order.orderNumber || '—',
              supplierName: order.supplier_name || order.supplierName || '—',
              status: order.status || '—',
              quantity: Number(item.quantity || 0),
              unitCost: Number(item.unit_cost || item.unitCost || item.effective_cost || 0),
              date: order.created_at || order.createdAt || '',
            });
          }
        }
        if (!cancelled) setOrders(matched);
      } catch {
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product, currentBranch?.id]);

  if (!product) {
    return <SelectProductHint message={t.inventoryPageUi.selectProductToViewInfo} />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t.inventoryPageUi.relatedOrders}</CardTitle>
        <CardDescription>{product.sku}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground text-center py-6">{t.common.loading}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.inventoryPageUi.table.document}</TableHead>
                <TableHead>{t.inventoryPageUi.panel.supplier}</TableHead>
                <TableHead>{t.inventoryPageUi.panel.status}</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">{t.inventoryPageUi.table.cost}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((row, idx) => (
                <TableRow key={`${row.orderNumber}-${idx}`}>
                  <TableCell className="font-mono text-xs">{row.orderNumber}</TableCell>
                  <TableCell>{row.supplierName}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell className="text-right">{row.quantity}</TableCell>
                  <TableCell className="text-right font-mono">{row.unitCost.toFixed(2)}</TableCell>
                </TableRow>
              ))}
              {!loading && orders.length === 0 && (
                <EmptyTableRow colSpan={5} message={t.inventoryPageUi.panel.noPurchaseOrders} />
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function InventoryBarcodeQtyPanel({
  product,
  allBranchProducts,
}: {
  product: Product | null;
  allBranchProducts?: Record<string, Product[]>;
}) {
  const { t } = useTranslation();
  const { branches } = useBranchScope();

  const rows = useMemo(() => {
    if (!product) return [];
    const skuKey = (product.sku || '').trim().toLowerCase();
    return branches.map((branch) => {
      const branchRows = allBranchProducts?.[branch.id] || [];
      const match = branchRows.find(
        (p) => p.id === product.id || (p.sku || '').trim().toLowerCase() === skuKey
      );
      return {
        branchId: branch.id,
        branchName: formatBranchDisplayName(branch),
        barcode: match?.barcode || product.barcode || '—',
        stock: match?.stock ?? 0,
      };
    });
  }, [product, allBranchProducts, branches]);

  if (!product) {
    return <SelectProductHint message={t.inventoryPageUi.selectProductToViewInfo} />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t.inventoryPageUi.barcodeQuantities}</CardTitle>
        <CardDescription>
          {product.sku} — {product.barcode || t.inventoryPageUi.panel.noBarcode}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.inventoryPageUi.panel.branch}</TableHead>
              <TableHead>{t.inventoryPageUi.panel.barcode}</TableHead>
              <TableHead className="text-right">{t.inventoryPageUi.productInfo.stock}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.branchId}>
                <TableCell>{row.branchName}</TableCell>
                <TableCell className="font-mono text-xs">{row.barcode}</TableCell>
                <TableCell className="text-right font-mono">{row.stock}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function InventoryProductAuditPanel({ product }: { product: Product | null }) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const rows = useMemo(() => {
    if (!product) return [];
    const sku = (product.sku || '').trim().toLowerCase();
    return getTransactionHistory()
      .filter((r) => {
        if (r.entityId === product.id) return true;
        if (r.entityNumber && r.entityNumber.toLowerCase() === sku) return true;
        if (r.entityName && r.entityName.toLowerCase() === product.name.toLowerCase()) return true;
        return false;
      })
      .slice(0, 100);
  }, [product]);

  if (!product) {
    return <SelectProductHint message={t.inventoryPageUi.selectProductToViewInfo} />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t.inventoryPageUi.auditHistory}</CardTitle>
        <CardDescription>{product.sku}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.inventoryPageUi.table.dateTime}</TableHead>
              <TableHead>{t.inventoryPageUi.panel.action}</TableHead>
              <TableHead>{t.inventoryPageUi.table.notes}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(r.timestamp).toLocaleString(uiLocale)}
                </TableCell>
                <TableCell className="text-xs">{r.action}</TableCell>
                <TableCell className="text-xs">{r.description}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <EmptyTableRow colSpan={3} message={t.inventoryPageUi.panel.noAuditEntries} />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function InventorySerialNumbersPanel({ product }: { product: Product | null }) {
  const { t } = useTranslation();
  if (!product) {
    return <SelectProductHint message={t.inventoryPageUi.selectProductToViewInfo} />;
  }
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-muted-foreground text-center">{t.inventoryPageUi.panel.serialNotTracked}</p>
      </CardContent>
    </Card>
  );
}

type PendingTransfersPanelProps = {
  product: Product | null;
  allBranchProducts?: Record<string, Product[]>;
  scopedBranchIds?: string[];
  isInventoryConsolidated: boolean;
  inventoryListBranchId?: string;
  isActive?: boolean;
};

export function InventoryPendingTransfersPanel({
  product,
  allBranchProducts,
  scopedBranchIds,
  isInventoryConsolidated,
  inventoryListBranchId,
  isActive = true,
}: PendingTransfersPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.stockTransfers.list();
      if (res.error) throw new Error(res.error);
      setTransfers((res.data || []).map((row) => mapStockTransferRow(row as Record<string, unknown>)));
    } catch (error) {
      console.error('[InventoryPendingTransfers] load failed:', error);
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void loadTransfers();
  }, [isActive, loadTransfers, product?.id, inventoryListBranchId, isInventoryConsolidated]);

  useEffect(() => {
    if (!isActive) return;
    const onChanged = () => { void loadTransfers(); };
    window.addEventListener(STOCK_TRANSFERS_CHANGED_EVENT, onChanged);
    const unsubSocket = onTableSync('stock_transfers', onChanged);
    return () => {
      window.removeEventListener(STOCK_TRANSFERS_CHANGED_EVENT, onChanged);
      unsubSocket();
    };
  }, [isActive, loadTransfers]);

  const rows = useMemo(
    () =>
      buildPendingTransferRows(transfers, {
        isConsolidated: isInventoryConsolidated,
        branchId: inventoryListBranchId,
        product,
        allBranchProducts,
        scopedBranchIds,
      }),
    [transfers, isInventoryConsolidated, inventoryListBranchId, product, allBranchProducts, scopedBranchIds],
  );

  const showProductColumn = !product;

  if (loading && rows.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          {t.common.loading}
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-4 text-center">
          <p className="text-muted-foreground">
            {product
              ? t.inventoryPageUi.panel.noPendingTransfers
              : t.inventoryPageUi.panel.noPendingTransfersAny}
          </p>
          <Button onClick={() => navigate('/stock-transfer')}>
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            {t.inventoryPageUi.goToTransfers}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.inventoryPageUi.tabs.pendingTransfer}</CardTitle>
        <CardDescription>
          {product ? product.sku : t.inventoryPageUi.panel.allPendingTransfers}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.inventoryPageUi.table.document}</TableHead>
              {showProductColumn && <TableHead>{t.inventoryPageUi.table.product}</TableHead>}
              {showProductColumn && <TableHead>{t.inventoryPageUi.table.code}</TableHead>}
              <TableHead>{t.inventoryPageUi.panel.status}</TableHead>
              <TableHead>{t.inventoryPageUi.panel.from}</TableHead>
              <TableHead>{t.inventoryPageUi.panel.to}</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={`${row.transferNumber}-${row.sku}-${idx}`}>
                <TableCell className="font-mono text-xs">{row.transferNumber}</TableCell>
                {showProductColumn && <TableCell>{row.productName}</TableCell>}
                {showProductColumn && <TableCell className="font-mono text-xs">{row.sku || '—'}</TableCell>}
                <TableCell>{row.status}</TableCell>
                <TableCell>{row.from}</TableCell>
                <TableCell>{row.to}</TableCell>
                <TableCell className="text-right">{row.quantity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={() => navigate('/stock-transfer')}>
            {t.inventoryPageUi.goToTransfers}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
