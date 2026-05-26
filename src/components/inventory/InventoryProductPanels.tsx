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

export function collectProductIdsForSku(
  product: Product,
  allBranchProducts?: Record<string, Product[]>,
  scopedBranchIds?: string[],
): Set<string> {
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
  return productIds;
}

export function isPurchaseInboundMovement(m: StockMovement): boolean {
  if (m.type !== 'IN') return false;
  const reason = String(m.reason || '').toLowerCase();
  if (reason === 'purchase' || reason.includes('purchase')) return true;
  const notes = String(m.notes || '').toLowerCase();
  return notes.includes('fatura de compra') || notes.includes('purchase invoice') || notes.includes('compra');
}

export function filterMovementsForProduct(
  movements: StockMovement[],
  product: Product | null,
  allBranchProducts?: Record<string, Product[]>,
  scopedBranchIds?: string[]
): StockMovement[] {
  if (!product) return [];
  const skuKey = (product.sku || '').trim().toLowerCase();
  const productIds = collectProductIdsForSku(product, allBranchProducts, scopedBranchIds);
  return movements.filter((m) => {
    if (productIds.has(m.productId)) return true;
    if (!skuKey) return false;
    return (m.sku || '').trim().toLowerCase() === skuKey;
  });
}

type PurchasePriceRow = {
  id: string;
  date: string;
  document: string;
  supplier: string;
  branch: string;
  quantity: number;
  unitCost: number;
  sourceLabel: string;
};

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

export function InventoryPurchasePricePanel({
  product,
  movements,
  allBranchProducts,
  scopedBranchIds,
  uiLocale,
  getReasonLabel,
}: PanelProps) {
  const { t } = useTranslation();
  const [invoiceRows, setInvoiceRows] = useState<PurchasePriceRow[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const movementRows = useMemo((): PurchasePriceRow[] => {
    if (!product) return [];
    return filterMovementsForProduct(movements, product, allBranchProducts, scopedBranchIds)
      .filter(isPurchaseInboundMovement)
      .map((m) => ({
        id: `sm-${m.id}`,
        date: m.createdAt,
        document: m.referenceNumber || '—',
        supplier: '—',
        branch: m.branchName || m.branchId || '—',
        quantity: m.quantity,
        unitCost: m.costAtTime || 0,
        sourceLabel: getReasonLabel(m.reason),
      }));
  }, [movements, product, allBranchProducts, scopedBranchIds, getReasonLabel]);

  useEffect(() => {
    if (!product) {
      setInvoiceRows([]);
      return;
    }
    let cancelled = false;
    const productIds = collectProductIdsForSku(product, allBranchProducts, scopedBranchIds);
    const skuKey = (product.sku || '').trim().toLowerCase();

    (async () => {
      setLoadingInvoices(true);
      try {
        const branchIds = scopedBranchIds?.length ? [...scopedBranchIds] : [];
        const allInvoices: any[] = [];
        const seenInvoiceIds = new Set<string>();

        const addInvoices = (list: any[]) => {
          for (const inv of list) {
            if (!inv?.id || seenInvoiceIds.has(inv.id)) continue;
            seenInvoiceIds.add(inv.id);
            allInvoices.push(inv);
          }
        };

        if (branchIds.length > 0) {
          for (const branchId of branchIds) {
            const result = await api.purchaseInvoices.list({ branchId, status: 'confirmed' });
            addInvoices(result.data || []);
          }
        } else {
          const result = await api.purchaseInvoices.list({ status: 'confirmed' });
          addInvoices(result.data || []);
        }

        const rows: PurchasePriceRow[] = [];
        for (const inv of allInvoices) {
          if (String(inv.status || '').toLowerCase() === 'cancelled') continue;
          const lines = Array.isArray(inv.lines) ? inv.lines : [];
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineSku = String(line.sku || line.productSku || line.product_sku || '').trim().toLowerCase();
            const linePid = line.productId || line.product_id;
            if (!productIds.has(linePid) && !(skuKey && lineSku === skuKey)) continue;
            const qty = Number(line.totalQty ?? line.total_qty ?? line.quantity ?? 0);
            const unitCost = Number(line.unitPrice ?? line.unit_price ?? line.cost ?? 0);
            if (qty <= 0) continue;
            rows.push({
              id: `pi-${inv.id}-${i}`,
              date: inv.date || inv.createdAt || inv.created_at || '',
              document: inv.invoiceNumber || inv.invoice_number || '—',
              supplier: inv.supplierName || inv.supplier_name || '—',
              branch: inv.warehouseName || inv.warehouse_name || inv.branchName || inv.branch_name || '—',
              quantity: qty,
              unitCost,
              sourceLabel: t.inventoryPageUi.panel.purchaseInvoiceSource,
            });
          }
        }

        if (!cancelled) setInvoiceRows(rows);
      } catch {
        if (!cancelled) setInvoiceRows([]);
      } finally {
        if (!cancelled) setLoadingInvoices(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [product, allBranchProducts, scopedBranchIds, t]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const merged: PurchasePriceRow[] = [];
    const add = (row: PurchasePriceRow) => {
      const day = row.date ? String(row.date).slice(0, 10) : '';
      const key = `${day}|${row.document}|${row.quantity}|${row.unitCost}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(row);
    };
    for (const row of movementRows) add(row);
    for (const row of invoiceRows) add(row);
    return merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [movementRows, invoiceRows]);

  if (!product) {
    return <SelectProductHint message={t.inventoryPageUi.selectProductToViewStatement} />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t.inventoryPageUi.tabs.purchasePrice}</CardTitle>
        <CardDescription>{t.inventoryPageUi.purchasePriceHistory} — {product.sku}</CardDescription>
      </CardHeader>
      <CardContent>
        {loadingInvoices && rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-6">{t.common.loading}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.inventoryPageUi.table.dateTime}</TableHead>
                <TableHead>{t.inventoryPageUi.table.document}</TableHead>
                <TableHead>{t.inventoryPageUi.panel.supplier}</TableHead>
                <TableHead>{t.inventoryPageUi.table.branch}</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">{t.inventoryPageUi.table.cost}</TableHead>
                <TableHead>{t.inventoryPageUi.panel.source}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.date ? new Date(row.date).toLocaleString(uiLocale) : '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.document}</TableCell>
                  <TableCell className="text-xs">{row.supplier}</TableCell>
                  <TableCell className="text-xs">{row.branch}</TableCell>
                  <TableCell className="text-right font-mono">{row.quantity}</TableCell>
                  <TableCell className="text-right font-mono">
                    {row.unitCost.toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-xs">{row.sourceLabel}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && !loadingInvoices && (
                <EmptyTableRow colSpan={7} message={t.inventoryPageUi.panel.noPurchasePriceHistory} />
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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

type ProductAuditRow = {
  id: string;
  timestamp: string;
  action: string;
  userName: string;
  branchLabel: string;
  description: string;
};

function matchesProductAudit(
  product: Product,
  productIds: Set<string>,
  skuKey: string,
  fields: {
    entityId?: string;
    entityNumber?: string;
    entityName?: string;
    description?: string;
  },
): boolean {
  if (fields.entityId && productIds.has(fields.entityId)) return true;
  if (skuKey && fields.entityNumber?.trim().toLowerCase() === skuKey) return true;
  if (skuKey && fields.description?.toLowerCase().includes(skuKey)) return true;
  const name = (product.name || '').trim().toLowerCase();
  if (name && fields.entityName?.trim().toLowerCase() === name) return true;
  if (name && fields.description?.toLowerCase().includes(name)) return true;
  return false;
}

export function InventoryProductAuditPanel({
  product,
  movements,
  allBranchProducts,
  scopedBranchIds,
  uiLocale,
  getReasonLabel,
}: PanelProps) {
  const { t } = useTranslation();
  const [serverAuditRows, setServerAuditRows] = useState<ProductAuditRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!product) {
      setServerAuditRows([]);
      return;
    }
    let cancelled = false;
    const productIds = collectProductIdsForSku(product, allBranchProducts, scopedBranchIds);

    (async () => {
      setLoading(true);
      try {
        const rows: ProductAuditRow[] = [];
        const seen = new Set<string>();

        const push = (row: ProductAuditRow) => {
          const key = `${row.timestamp}|${row.action}|${row.description}`;
          if (seen.has(key)) return;
          seen.add(key);
          rows.push(row);
        };

        for (const pid of productIds) {
          const result = await api.audit.recordHistory('products', pid);
          const list = result.data || [];
          for (const entry of list) {
            push({
              id: `audit-${entry.id}`,
              timestamp: entry.created_at || entry.createdAt || entry.timestamp || '',
              action: entry.action || '—',
              userName: entry.user_name || entry.userName || '—',
              branchLabel: entry.branch_id || '—',
              description:
                entry.description ||
                entry.new_values ||
                entry.newValues ||
                entry.old_values ||
                entry.oldValues ||
                '—',
            });
          }
        }

        const skuKey = (product.sku || '').trim().toLowerCase();
        const broad = await api.audit.list({ limit: 500 });
        for (const entry of broad.data || []) {
          const desc = String(
            entry.description || entry.new_values || entry.newValues || '',
          ).toLowerCase();
          const recordId = entry.record_id || entry.recordId || '';
          const matchesId = recordId && productIds.has(recordId);
          const matchesSkuInText = skuKey && desc.includes(skuKey);
          if (!matchesId && !matchesSkuInText) continue;
          push({
            id: `audit-b-${entry.id}`,
            timestamp: entry.created_at || entry.createdAt || '',
            action: entry.action || '—',
            userName: entry.user_name || entry.userName || '—',
            branchLabel: entry.branch_name || entry.branch_id || '—',
            description: entry.description || desc || '—',
          });
        }

        if (!cancelled) setServerAuditRows(rows);
      } catch {
        if (!cancelled) setServerAuditRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [product, allBranchProducts, scopedBranchIds]);

  const rows = useMemo((): ProductAuditRow[] => {
    if (!product) return [];
    const productIds = collectProductIdsForSku(product, allBranchProducts, scopedBranchIds);
    const skuKey = (product.sku || '').trim().toLowerCase();
    const seen = new Set<string>();
    const merged: ProductAuditRow[] = [];

    const push = (row: ProductAuditRow) => {
      const key = `${row.timestamp}|${row.action}|${row.description}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(row);
    };

    for (const m of filterMovementsForProduct(movements, product, allBranchProducts, scopedBranchIds)) {
      const typeLabel = m.type === 'IN' ? t.inventoryUi.entry : t.inventoryUi.exit;
      push({
        id: `sm-${m.id}`,
        timestamp: m.createdAt,
        action: `${typeLabel} · ${getReasonLabel(m.reason)}`,
        userName: m.createdByName || m.createdBy || t.inventoryPageUi.table.systemUser,
        branchLabel: m.branchName || m.branchId || '—',
        description: [m.referenceNumber, m.notes].filter(Boolean).join(' — ') || '—',
      });
    }

    for (const r of getTransactionHistory()) {
      if (!matchesProductAudit(product, productIds, skuKey, r)) continue;
      push({
        id: `txn-${r.id}`,
        timestamp: r.timestamp,
        action: r.action,
        userName: r.userName || '—',
        branchLabel: r.branchName || r.branchId || '—',
        description: r.description,
      });
    }

    for (const row of serverAuditRows) push(row);

    return merged
      .filter((r) => r.timestamp && !Number.isNaN(new Date(r.timestamp).getTime()))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 200);
  }, [product, movements, allBranchProducts, scopedBranchIds, serverAuditRows, getReasonLabel, t]);

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
        {loading && rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-6">{t.common.loading}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.inventoryPageUi.table.dateTime}</TableHead>
                <TableHead>{t.inventoryPageUi.panel.action}</TableHead>
                <TableHead>{t.inventoryPageUi.table.user}</TableHead>
                <TableHead>{t.inventoryPageUi.table.branch}</TableHead>
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
                  <TableCell className="text-xs">{r.userName}</TableCell>
                  <TableCell className="text-xs">{r.branchLabel}</TableCell>
                  <TableCell className="text-xs">{r.description}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && !loading && (
                <EmptyTableRow colSpan={5} message={t.inventoryPageUi.panel.noAuditEntries} />
              )}
            </TableBody>
          </Table>
        )}
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
