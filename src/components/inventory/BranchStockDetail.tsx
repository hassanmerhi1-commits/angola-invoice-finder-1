import { useMemo, useState, useEffect } from 'react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { Product } from '@/types/erp';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Building2, Package, AlertTriangle, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api/client';

interface BranchStockDetailProps {
  selectedProduct: Product | null;
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

export function BranchStockDetail({ selectedProduct }: BranchStockDetailProps) {
  const { branches, isHeadOffice, currentBranch } = useBranchScope();
  const [branchStocks, setBranchStocks] = useState<BranchStock[]>([]);

  useEffect(() => {
    if (!selectedProduct) {
      setBranchStocks([]);
      return;
    }

    async function loadStocks() {
      const targets = isHeadOffice ? branches : (currentBranch ? [currentBranch] : branches);
      const stocks: BranchStock[] = [];
      for (const branch of targets) {
        let branchProducts: any[] = [];
        try {
          const response = await api.products.list(branch.id);
          branchProducts = response.data || [];
        } catch {
          branchProducts = [];
        }
        const matchingProduct = branchProducts.find(
          (p: any) => p.sku === selectedProduct!.sku || p.id === selectedProduct!.id
        );
        stocks.push({
          branchId: branch.id,
          branchName: branch.name,
          branchCode: branch.code,
          isMain: branch.isMain,
          stock: matchingProduct?.stock || 0,
          price: matchingProduct?.price || selectedProduct!.price,
          cost: matchingProduct?.cost || matchingProduct?.avgCost || selectedProduct!.cost,
        });
      }
      stocks.sort((a, b) => {
        if (a.isMain && !b.isMain) return -1;
        if (!a.isMain && b.isMain) return 1;
        return a.branchName.localeCompare(b.branchName);
      });
      setBranchStocks(stocks);
    }
    loadStocks();
  }, [selectedProduct, branches, isHeadOffice, currentBranch?.id]);

  const totalStock = branchStocks.reduce((sum, b) => sum + b.stock, 0);
  const totalValue = branchStocks.reduce((sum, b) => sum + (b.stock * b.cost), 0);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-AO', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    }).format(value);
  };

  if (!selectedProduct) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center py-12">
          <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <p className="text-muted-foreground">Selecione um produto para ver a quantidade por filial</p>
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
            <p className="text-xs text-muted-foreground">Stock Total</p>
            <p className="text-2xl font-bold">{totalStock}</p>
            <p className="text-xs text-muted-foreground">{selectedProduct.unit}</p>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Preço Venda</p>
            <p className="text-2xl font-bold">{formatCurrency(selectedProduct.price)}</p>
            <p className="text-xs text-muted-foreground">Kz</p>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Valor em Stock</p>
            <p className="text-2xl font-bold">{formatCurrency(totalValue)}</p>
            <p className="text-xs text-muted-foreground">Kz</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Quantidade por Filial
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filial</TableHead>
                <TableHead>Código</TableHead>
                <TableHead className="text-center">Stock</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-center">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branchStocks.map((branch) => (
                <TableRow key={branch.branchId}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {branch.branchName}
                      {branch.isMain && (
                        <Badge variant="secondary" className="text-xs">Sede</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {branch.branchCode}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`font-bold ${
                      branch.stock <= 0 
                        ? 'text-destructive' 
                        : branch.stock <= 10 
                          ? 'text-amber-600' 
                          : 'text-foreground'
                    }`}>
                      {branch.stock}
                    </span>
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
                        Sem Stock
                      </Badge>
                    ) : branch.stock <= 10 ? (
                      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-600">
                        <AlertTriangle className="w-3 h-3" />
                        Baixo
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                        <CheckCircle className="w-3 h-3" />
                        OK
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 pt-4 border-t flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {branches.length} filiais • {branchStocks.filter(b => b.stock > 0).length} com stock disponível
            </div>
            <div className="text-sm font-medium">
              Total Global: <span className="text-lg font-bold">{totalStock}</span> {selectedProduct.unit}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
