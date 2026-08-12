import { useEffect, useMemo, useState } from 'react';
import { Product, Branch } from '@/types/erp';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatBranchDisplayName } from '@/lib/branchDisplay';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';

interface BranchStockDetailProps {
  selectedProduct: Product | null;
  /** Kept for call-site compatibility; qty now loads via stock-by-sku. */
  allBranchProducts?: Record<string, Product[]>;
  branchList: Branch[];
}

type BranchStockRow = {
  branchId: string;
  branchName: string;
  isMain: boolean;
  stock: number;
};

export function BranchStockDetail({
  selectedProduct,
  branchList,
}: BranchStockDetailProps) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const ui = t.inventoryPageUi.branchStockDetail;
  const [rows, setRows] = useState<BranchStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sku = String(selectedProduct?.sku || '').trim();
  const branchIdsKey = useMemo(
    () => branchList.map((b) => b.id).join(','),
    [branchList],
  );

  useEffect(() => {
    if (!selectedProduct || !sku) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await api.products.stockBySku(sku);
        if (cancelled) return;
        if (result.error) throw new Error(result.error);
        const apiRows = Array.isArray(result.data?.rows) ? result.data.rows : [];
        const byId = new Map(apiRows.map((r) => [String(r.branchId), r]));

        // Prefer live branch list order/names from the client; fill qty from API.
        const merged: BranchStockRow[] = (branchList.length > 0 ? branchList : []).map((branch) => {
          const hit = byId.get(String(branch.id));
          return {
            branchId: branch.id,
            branchName: formatBranchDisplayName(branch),
            isMain: Boolean(branch.isMain),
            stock: Number(hit?.stock ?? 0),
          };
        });

        if (merged.length === 0) {
          for (const r of apiRows) {
            merged.push({
              branchId: String(r.branchId),
              branchName: String(r.branchName || r.branchCode || r.branchId),
              isMain: Boolean(r.isMain),
              stock: Number(r.stock) || 0,
            });
          }
        }

        merged.sort((a, b) => {
          if (a.isMain && !b.isMain) return -1;
          if (!a.isMain && b.isMain) return 1;
          return a.branchName.localeCompare(b.branchName, uiLocale);
        });
        setRows(merged);
      } catch (e) {
        if (cancelled) return;
        setRows([]);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProduct?.id, sku, branchIdsKey, uiLocale, branchList]);

  const totalStock = useMemo(
    () => rows.reduce((sum, b) => sum + b.stock, 0),
    [rows],
  );
  const unit = selectedProduct?.unit || 'UN';

  if (!selectedProduct) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">{ui.selectProduct}</CardContent>
      </Card>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">{t.common.loading}</CardContent>
      </Card>
    );
  }

  if (error && rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-destructive">{error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-lg">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{ui.colBranch}</TableHead>
            <TableHead className="text-right w-[120px]">{ui.colQuantity}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                {ui.noBranches}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.branchId}>
                <TableCell className="font-medium">{row.branchName}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{row.stock}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {rows.length > 0 && (
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="font-semibold">{ui.footerTotal}</TableCell>
              <TableCell className="text-right font-bold font-mono tabular-nums">
                {totalStock} {unit}
              </TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
