import { useMemo } from 'react';
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

interface BranchStockDetailProps {
  selectedProduct: Product | null;
  allBranchProducts: Record<string, Product[]>;
  branchList: Branch[];
}

function findProductInBranch(rows: Product[], selected: Product): Product | undefined {
  const skuKey = (selected.sku || '').trim().toLowerCase();
  return rows.find((p) => {
    if (p.id === selected.id) return true;
    if (!skuKey) return false;
    return (p.sku || '').trim().toLowerCase() === skuKey;
  });
}

export function BranchStockDetail({
  selectedProduct,
  allBranchProducts,
  branchList,
}: BranchStockDetailProps) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const ui = t.inventoryPageUi.branchStockDetail;

  const branchRows = useMemo(() => {
    if (!selectedProduct || branchList.length === 0) return [];

    const rows = branchList.map((branch) => {
      const catalog = allBranchProducts[branch.id] || [];
      const matching = findProductInBranch(catalog, selectedProduct);
      return {
        branchId: branch.id,
        branchName: formatBranchDisplayName(branch),
        isMain: Boolean(branch.isMain),
        stock: Number(matching?.stock ?? 0),
      };
    });

    rows.sort((a, b) => {
      if (a.isMain && !b.isMain) return -1;
      if (!a.isMain && b.isMain) return 1;
      return a.branchName.localeCompare(b.branchName, uiLocale);
    });
    return rows;
  }, [selectedProduct, allBranchProducts, branchList, uiLocale]);

  const totalStock = branchRows.reduce((sum, b) => sum + b.stock, 0);
  const unit = selectedProduct?.unit || 'UN';

  if (!selectedProduct) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">{ui.selectProduct}</CardContent>
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
          {branchRows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                {ui.noBranches}
              </TableCell>
            </TableRow>
          ) : (
            branchRows.map((row) => (
              <TableRow key={row.branchId}>
                <TableCell className="font-medium">{row.branchName}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{row.stock}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {branchRows.length > 0 && (
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
