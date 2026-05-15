// Advanced Inventory Page with Excel Import/Export
import { useState, useMemo } from 'react';
import { useBranches, useProducts, useCategories } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useERP';
import { 
  exportProductsToExcel, 
  exportProductsToCSV, 
  parseExcelFile, 
  downloadImportTemplate,
  validateImportedProducts,
  ExcelProduct 
} from '@/lib/excel';
import { Product } from '@/types/erp';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductFormDialog } from '@/components/inventory/ProductFormDialog';
import { 
  Search, 
  Plus, 
  Package, 
  Download, 
  Upload, 
  FileSpreadsheet,
  Filter,
  SortAsc,
  SortDesc,
  Eye,
  Edit,
  Trash2,
  MoreHorizontal,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Check,
  X,
  BarChart3,
  History,
  ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';

type SortField = 'name' | 'sku' | 'price' | 'cost' | 'stock' | 'category';
type SortDirection = 'asc' | 'desc';
type StockFilter = 'all' | 'inStock' | 'lowStock' | 'outOfStock';

export default function AdvancedInventory() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { user } = useAuth();
  const { hasPermission } = usePermissions(user?.id);
  const { currentBranch } = useBranches();
  const { products, addProduct, updateProduct, deleteProduct } = useProducts(currentBranch?.id);
  const { categories } = useCategories();

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importedProducts, setImportedProducts] = useState<ExcelProduct[]>([]);
  const [importErrors, setImportErrors] = useState<{ row: number; errors: string[] }[]>([]);
  const [activeTab, setActiveTab] = useState('lista');
  
  // Visible columns
  const [visibleColumns, setVisibleColumns] = useState({
    sku: true,
    name: true,
    barcode: false,
    category: true,
    price: true,
    cost: true,
    margin: true,
    stock: true,
    unit: false,
    taxRate: true,
    status: true,
  });

  // Filtered and sorted products
  const filteredProducts = useMemo(() => {
    let result = [...products];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        p.barcode?.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term)
      );
    }

    // Category filter
    if (categoryFilter !== 'all') {
      result = result.filter(p => p.category === categoryFilter);
    }

    // Stock filter
    switch (stockFilter) {
      case 'inStock':
        result = result.filter(p => p.stock > 10);
        break;
      case 'lowStock':
        result = result.filter(p => p.stock > 0 && p.stock <= 10);
        break;
      case 'outOfStock':
        result = result.filter(p => p.stock === 0);
        break;
    }

    // Sort
    result.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];
      
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [products, searchTerm, categoryFilter, stockFilter, sortField, sortDirection]);

  // Stats
  const stats = useMemo(() => {
    const total = products.length;
    const totalValue = products.reduce((sum, p) => sum + (p.stock * p.cost), 0);
    const totalSaleValue = products.reduce((sum, p) => sum + (p.stock * p.price), 0);
    const lowStock = products.filter(p => p.stock > 0 && p.stock <= 10).length;
    const outOfStock = products.filter(p => p.stock === 0).length;
    const avgMargin = products.length > 0 
      ? products.reduce((sum, p) => sum + ((p.price - p.cost) / p.price * 100), 0) / products.length
      : 0;

    return { total, totalValue, totalSaleValue, lowStock, outOfStock, avgMargin };
  }, [products]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleSelectAll = () => {
    if (selectedProducts.length === filteredProducts.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(filteredProducts.map(p => p.id));
    }
  };

  const toggleSelect = (productId: string) => {
    setSelectedProducts(prev =>
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  // Excel Import
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const parsed = await parseExcelFile(file);
      const { valid, errors } = validateImportedProducts(parsed);
      
      setImportedProducts(valid);
      setImportErrors(errors);
      setImportDialogOpen(true);
    } catch (error) {
      toast.error('Failed to parse Excel file');
    }
  };

  const handleImportConfirm = async () => {
    let imported = 0;

    for (const excelProd of importedProducts) {
      const newProduct: Product = {
        id: `prod-${Date.now()}-${Math.random()}`,
        name: excelProd.descricao,
        sku: excelProd.codigo,
        barcode: excelProd.codigoBarras,
        category: excelProd.categoria || 'GERAL',
        price: excelProd.preco,
        cost: excelProd.custo,
        firstCost: excelProd.custo,
        lastCost: excelProd.custo,
        avgCost: excelProd.custo,
        stock: excelProd.quantidade,
        unit: excelProd.unidade,
        taxRate: excelProd.iva,
        branchId: currentBranch?.id || '',
        isActive: true,
        createdAt: new Date().toISOString(),
      };

      await addProduct(newProduct);
      imported++;
    }

    toast.success(`${imported} products imported successfully`);
    setImportDialogOpen(false);
    setImportedProducts([]);
    setImportErrors([]);
  };

  // Export
  const handleExport = (format: 'excel' | 'csv') => {
    const toExport = selectedProducts.length > 0
      ? products.filter(p => selectedProducts.includes(p.id))
      : filteredProducts;

    if (format === 'excel') {
      exportProductsToExcel(toExport, `produtos_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } else {
      exportProductsToCSV(toExport, `produtos_${new Date().toISOString().slice(0, 10)}.csv`);
    }
    
    toast.success(`Exported ${toExport.length} products`);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-4 h-4 opacity-50" />;
    return sortDirection === 'asc' 
      ? <SortAsc className="w-4 h-4 text-primary" />
      : <SortDesc className="w-4 h-4 text-primary" />;
  };

  const getMargin = (product: Product) => {
    if (product.cost === 0) return 0;
    return ((product.price - product.cost) / product.price * 100);
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" />
            {t.inventory.title}
          </h1>
          <p className="text-muted-foreground">{t.inventory.subtitle}</p>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Import */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Upload className="w-4 h-4 mr-2" />
                {t.common.import}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Import Options</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <label className="cursor-pointer">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Import from Excel
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={downloadImportTemplate}>
                <Download className="w-4 h-4 mr-2" />
                Download Template
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="w-4 h-4 mr-2" />
                {t.common.export}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>
                {selectedProducts.length > 0 
                  ? `Export ${selectedProducts.length} selected`
                  : `Export ${filteredProducts.length} products`
                }
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleExport('excel')}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Export to Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Export to CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t.inventory.addProduct}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.inventory.totalProducts}</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Package className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.inventory.totalValue}</p>
                <p className="text-2xl font-bold">{stats.totalValue.toLocaleString(locale)} {t.common.currency}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sale Value</p>
                <p className="text-2xl font-bold">{stats.totalSaleValue.toLocaleString(locale)} {t.common.currency}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card className={stats.lowStock > 0 ? 'border-orange-500' : ''}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.inventory.lowStockAlert}</p>
                <p className="text-2xl font-bold text-orange-500">{stats.lowStock}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
        <Card className={stats.outOfStock > 0 ? 'border-red-500' : ''}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.inventory.outOfStock}</p>
                <p className="text-2xl font-bold text-red-500">{stats.outOfStock}</p>
              </div>
              <X className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="lista">
            <Package className="w-4 h-4 mr-2" />
            Lista
          </TabsTrigger>
          <TabsTrigger value="cost-history">
            <History className="w-4 h-4 mr-2" />
            Cost History
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="w-4 h-4 mr-2" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="audit">
            <ShieldCheck className="w-4 h-4 mr-2" />
            Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lista" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-4 items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={t.common.search}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>

                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.common.all}</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex gap-1">
                  <Button 
                    variant={stockFilter === 'all' ? 'default' : 'outline'} 
                    size="sm"
                    onClick={() => setStockFilter('all')}
                  >
                    {t.common.all}
                  </Button>
                  <Button 
                    variant={stockFilter === 'inStock' ? 'default' : 'outline'} 
                    size="sm"
                    onClick={() => setStockFilter('inStock')}
                  >
                    Qty &gt; 0
                  </Button>
                  <Button 
                    variant={stockFilter === 'lowStock' ? 'default' : 'outline'} 
                    size="sm"
                    onClick={() => setStockFilter('lowStock')}
                    className="text-orange-500"
                  >
                    Low
                  </Button>
                  <Button 
                    variant={stockFilter === 'outOfStock' ? 'default' : 'outline'} 
                    size="sm"
                    onClick={() => setStockFilter('outOfStock')}
                    className="text-red-500"
                  >
                    Qty = 0
                  </Button>
                </div>

                <div className="text-sm text-muted-foreground">
                  {filteredProducts.length} of {products.length} products
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Data Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={selectedProducts.length === filteredProducts.length && filteredProducts.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      {visibleColumns.sku && (
                        <TableHead className="cursor-pointer" onClick={() => toggleSort('sku')}>
                          <div className="flex items-center gap-1">
                            {t.inventory.sku}
                            <SortIcon field="sku" />
                          </div>
                        </TableHead>
                      )}
                      {visibleColumns.name && (
                        <TableHead className="cursor-pointer" onClick={() => toggleSort('name')}>
                          <div className="flex items-center gap-1">
                            {t.common.description}
                            <SortIcon field="name" />
                          </div>
                        </TableHead>
                      )}
                      {visibleColumns.category && (
                        <TableHead className="cursor-pointer" onClick={() => toggleSort('category')}>
                          <div className="flex items-center gap-1">
                            {t.inventory.category}
                            <SortIcon field="category" />
                          </div>
                        </TableHead>
                      )}
                      {visibleColumns.cost && (
                        <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('cost')}>
                          <div className="flex items-center justify-end gap-1">
                            {t.inventory.costPrice}
                            <SortIcon field="cost" />
                          </div>
                        </TableHead>
                      )}
                      {visibleColumns.price && (
                        <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('price')}>
                          <div className="flex items-center justify-end gap-1">
                            {t.inventory.salePrice}
                            <SortIcon field="price" />
                          </div>
                        </TableHead>
                      )}
                      {visibleColumns.margin && (
                        <TableHead className="text-right">Margin %</TableHead>
                      )}
                      {visibleColumns.stock && (
                        <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('stock')}>
                          <div className="flex items-center justify-end gap-1">
                            {t.inventory.stock}
                            <SortIcon field="stock" />
                          </div>
                        </TableHead>
                      )}
                      {visibleColumns.taxRate && (
                        <TableHead className="text-right">{t.pos.tax}</TableHead>
                      )}
                      {visibleColumns.status && (
                        <TableHead>{t.common.status}</TableHead>
                      )}
                      <TableHead className="text-right">{t.common.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                          <Package className="w-12 h-12 mx-auto mb-4 opacity-30" />
                          <p>{t.common.noResults}</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredProducts.map(product => {
                        const margin = getMargin(product);
                        const isLowStock = product.stock > 0 && product.stock <= 10;
                        const isOutOfStock = product.stock === 0;
                        
                        return (
                          <TableRow 
                            key={product.id}
                            className={selectedProducts.includes(product.id) ? 'bg-muted/50' : ''}
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedProducts.includes(product.id)}
                                onCheckedChange={() => toggleSelect(product.id)}
                              />
                            </TableCell>
                            {visibleColumns.sku && (
                              <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                            )}
                            {visibleColumns.name && (
                              <TableCell>
                                <div>
                                  <p className="font-medium">{product.name}</p>
                                  {product.barcode && (
                                    <p className="text-xs text-muted-foreground">{product.barcode}</p>
                                  )}
                                </div>
                              </TableCell>
                            )}
                            {visibleColumns.category && (
                              <TableCell>
                                <Badge variant="outline">{product.category}</Badge>
                              </TableCell>
                            )}
                            {visibleColumns.cost && (
                              <TableCell className="text-right font-mono">
                                {product.cost.toLocaleString(locale)} {t.common.currency}
                              </TableCell>
                            )}
                            {visibleColumns.price && (
                              <TableCell className="text-right font-mono font-medium">
                                {product.price.toLocaleString(locale)} {t.common.currency}
                              </TableCell>
                            )}
                            {visibleColumns.margin && (
                              <TableCell className="text-right">
                                <span className={margin > 20 ? 'text-green-500' : margin < 10 ? 'text-red-500' : ''}>
                                  {margin.toFixed(1)}%
                                </span>
                              </TableCell>
                            )}
                            {visibleColumns.stock && (
                              <TableCell className="text-right">
                                <span className={
                                  isOutOfStock ? 'text-red-500 font-bold' :
                                  isLowStock ? 'text-orange-500 font-bold' : ''
                                }>
                                  {product.stock}
                                </span>
                              </TableCell>
                            )}
                            {visibleColumns.taxRate && (
                              <TableCell className="text-right">{product.taxRate}%</TableCell>
                            )}
                            {visibleColumns.status && (
                              <TableCell>
                                {isOutOfStock ? (
                                  <Badge variant="destructive">Out of Stock</Badge>
                                ) : isLowStock ? (
                                  <Badge className="bg-orange-500">Low Stock</Badge>
                                ) : (
                                  <Badge variant="default">In Stock</Badge>
                                )}
                              </TableCell>
                            )}
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setEditingProduct(product)}>
                                    <Edit className="w-4 h-4 mr-2" />
                                    {t.common.edit}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem>
                                    <Eye className="w-4 h-4 mr-2" />
                                    {t.common.view}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem 
                                    className="text-destructive"
                                    onClick={() => {
                                      if (confirm('Delete this product?')) {
                                        deleteProduct(product.id);
                                        toast.success('Product deleted');
                                      }
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    {t.common.delete}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cost-history">
          <Card>
            <CardHeader>
              <CardTitle>Cost History</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-center py-12">
                Cost history tracking will be available when backend is enabled.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-medium mb-2">Top Categories by Stock Value</h4>
                  <div className="space-y-2">
                    {Array.from(new Set(products.map(p => p.category))).slice(0, 5).map(cat => {
                      const catProducts = products.filter(p => p.category === cat);
                      const value = catProducts.reduce((sum, p) => sum + (p.stock * p.cost), 0);
                      return (
                        <div key={cat} className="flex justify-between text-sm">
                          <span>{cat}</span>
                          <span className="font-mono">{value.toLocaleString(locale)} {t.common.currency}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-medium mb-2">Average Margin by Category</h4>
                  <div className="space-y-2">
                    {Array.from(new Set(products.map(p => p.category))).slice(0, 5).map(cat => {
                      const catProducts = products.filter(p => p.category === cat);
                      const avgMargin = catProducts.length > 0
                        ? catProducts.reduce((sum, p) => sum + getMargin(p), 0) / catProducts.length
                        : 0;
                      return (
                        <div key={cat} className="flex justify-between text-sm">
                          <span>{cat}</span>
                          <span className={avgMargin > 20 ? 'text-green-500' : 'text-orange-500'}>
                            {avgMargin.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Audit Trail</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-center py-12">
                Audit trail will be available when backend is enabled.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add/Edit Product Dialog */}
      <ProductFormDialog
        open={showAddDialog || !!editingProduct}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddDialog(false);
            setEditingProduct(null);
          }
        }}
        product={editingProduct}
        onSave={async (product) => {
          if (editingProduct) {
            await updateProduct(product);
            toast.success('Product updated');
          } else {
            await addProduct(product);
            toast.success('Product added');
          }
          setShowAddDialog(false);
          setEditingProduct(null);
        }}
      />

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Products</DialogTitle>
            <DialogDescription>
              Review the products to import
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[400px] overflow-y-auto">
            {importErrors.length > 0 && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <h4 className="font-medium text-red-700 mb-2">
                  {importErrors.length} rows with errors (will be skipped)
                </h4>
                <ul className="text-sm text-red-600 space-y-1">
                  {importErrors.slice(0, 5).map((err, i) => (
                    <li key={i}>Row {err.row}: {err.errors.join(', ')}</li>
                  ))}
                  {importErrors.length > 5 && (
                    <li>...and {importErrors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h4 className="font-medium text-green-700 mb-2">
                {importedProducts.length} products ready to import
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importedProducts.slice(0, 10).map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono">{p.codigo}</TableCell>
                      <TableCell>{p.descricao}</TableCell>
                      <TableCell className="text-right">{p.preco.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{p.quantidade}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {importedProducts.length > 10 && (
                <p className="text-sm text-muted-foreground mt-2">
                  ...and {importedProducts.length - 10} more
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImportConfirm} disabled={importedProducts.length === 0}>
              <Check className="w-4 h-4 mr-2" />
              Import {importedProducts.length} Products
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
