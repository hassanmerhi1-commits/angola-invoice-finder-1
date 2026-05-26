import { useMemo } from 'react';
import { Product, Branch } from '@/types/erp';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Building2, Package, AlertTriangle, CheckCircle } from 'lucide-react';
import { formatBranchDisplayName } from '@/lib/branchDisplay';
import { useTranslation } from '@/i18n';

interface BranchStockDetailProps {
  selectedProduct: Product | null;
  allBranchProducts: Record<string, Product[]>;
  branchList: Branch[];
}

interface BranchStock {
  branchId: string;
  branchName: string;
  branchCode: string;
  isMain: boolean;
  stock: number;
  price: number;
  cost: number;
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

  const branchStocks = useMemo((): BranchStock[] => {
    if (!selectedProduct || branchList.length === 0) return [];

    const stocks = branchList.map((branch) => {
      const rows = allBranchProducts[branch.id] || [];
      const matching = findProductInBranch(rows, selectedProduct);
      return {
        branchId: branch.id,
        branchName: formatBranchDisplayName(branch),
        branchCode: branch.code || '',
        isMain: Boolean(branch.isMain),
        stock: Number(matching?.stock ?? 0),
        price: Number(matching?.price ?? selectedProduct.price ?? 0),
        cost: Number(matching?.cost ?? matching?.avgCost ?? selectedProduct.cost ?? 0),
      };
    });

    stocks.sort((a, b) => {
      if (a.isMain && !b.isMain) return -1;
      if (!a.isMain && b.isMain) return 1;
      return a.branchName.localeCompare(b.branchName, uiLocale);
    });
    return stocks;
  }, [selectedProduct, allBranchProducts, branchList, uiLocale]);

  const totalStock = branchStocks.reduce((sum, b) => sum + b.stock, 0);
  const totalValue = branchStocks.reduce((sum, b) => sum + b.stock * b.cost, 0);
  const branchesWithStock = branchStocks.filter((b) => b.stock > 0).length;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(uiLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  if (!selectedProduct) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center py-12">
          <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <p className="text-muted-foreground">{ui.selectProduct}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-lg">{selectedProduct.name}</CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <span className="font-mono">{selectedProduct.sku}</span>
                {selectedProduct.barcode && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span className="font-mono text-xs">{selectedProduct.barcode}</span>
                  </>
                )}
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-lg px-3 py-1">
              {selectedProduct.category}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 pt-0">
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">{ui.totalStock}</p>
            <p className="text-2xl font-bold">{totalStock}</p>
            <p className="text-xs text-muted-foreground">{selectedProduct.unit}</p>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">{ui.salePrice}</p>
            <p className="text-2xl font-bold">{formatCurrency(selectedProduct.price)}</p>
            <p className="text-xs text-muted-foreground">Kz</p>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">{ui.stockValue}</p>
            <p className="text-2xl font-bold">{formatCurrency(totalValue)}</p>
            <p className="text-xs text-muted-foreground">Kz</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            {ui.qtyByBranchTitle}
          </CardTitle>
          <CardDescription>{ui.qtyByBranchDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{ui.colBranch}</TableHead>
                <TableHead>{ui.colCode}</TableHead>
                <TableHead className="text-center">{ui.colQuantity}</TableHead>
                <TableHead className="text-right">{ui.colPrice}</TableHead>
                <TableHead className="text-right">{ui.colCost}</TableHead>
                <TableHead className="text-right">{ui.colValue}</TableHead>
                <TableHead className="text-center">{ui.colStatus}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branchStocks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {ui.noBranches}
                  </TableCell>
                </TableRow>
              ) : (
                branchStocks.map((branch) => (
                  <TableRow key={branch.branchId}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {branch.branchName}
                        {branch.isMain && (
                          <Badge variant="secondary" className="text-xs">{ui.headOfficeBadge}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {branch.branchCode || '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={`text-lg font-bold tabular-nums ${
                          branch.stock <= 0
                            ? 'text-destructive'
                            : branch.stock <= 10
                              ? 'text-amber-600'
                              : 'text-foreground'
                        }`}
                      >
                        {branch.stock}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">{selectedProduct.unit}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(branch.price)} Kz
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatCurrency(branch.cost)} Kz
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(branch.stock * branch.cost)} Kz
                    </TableCell>
                    <TableCell className="text-center">
                      {branch.stock <= 0 ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {ui.statusOut}
                        </Badge>
                      ) : branch.stock <= 10 ? (
                        <Badge variant="outline" className="gap-1 text-amber-600 border-amber-600">
                          <AlertTriangle className="w-3 h-3" />
                          {ui.statusLow}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                          <CheckCircle className="w-3 h-3" />
                          {ui.statusOk}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="mt-4 pt-4 border-t flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {ui.footerSummary
                .replace('{branches}', String(branchList.length))
                .replace('{withStock}', String(branchesWithStock))}
            </div>
            <div className="text-sm font-medium">
              {ui.footerTotal}{' '}
              <span className="text-lg font-bold tabular-nums">{totalStock}</span>{' '}
              {selectedProduct.unit}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
