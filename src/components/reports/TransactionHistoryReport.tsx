import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { useTranslation } from '@/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import {
  History,
  Search,
  Filter,
  Download,
  CalendarIcon,
  User,
  Building,
  Clock,
  FileText,
  ShoppingCart,
  Package,
  Users,
  Truck,
  Settings,
  FileSpreadsheet,
  Eye,
  BarChart3,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  filterTransactionHistory,
  getTransactionStats,
  exportTransactionHistoryToExcel,
  TransactionRecord,
  TransactionFilter,
  TransactionCategory,
  ACTION_LABELS,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
} from '@/lib/transactionHistory';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSyncedBranchFilter } from '@/hooks/useSyncedBranchFilter';
import { useUsers } from '@/hooks/useUsers';

const ITEMS_PER_PAGE = 50;

// Radix Select forbids empty string values for SelectItem.
// We keep '' in state to preserve existing "no filter" behavior,
// and map a non-empty sentinel value back to '' when selected.
const ALL_SELECT_VALUE = '__all__';

// Category icons
const CATEGORY_ICONS: Record<TransactionCategory, React.ReactNode> = {
  sales: <ShoppingCart className="w-4 h-4" />,
  inventory: <Package className="w-4 h-4" />,
  clients: <Users className="w-4 h-4" />,
  suppliers: <Truck className="w-4 h-4" />,
  stock_transfer: <RefreshCw className="w-4 h-4" />,
  purchase: <FileText className="w-4 h-4" />,
  user: <User className="w-4 h-4" />,
  settings: <Settings className="w-4 h-4" />,
  fiscal: <FileSpreadsheet className="w-4 h-4" />,
  reports: <BarChart3 className="w-4 h-4" />,
};

export function TransactionHistoryReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId: scopeBranchId } = useBranchScope();
  const { branches, currentBranch, canPickBranch, selectedBranch, setSelectedBranch } = useSyncedBranchFilter({
    allValue: '',
    defaultWhenPicker: 'current',
  });
  const { users } = useUsers();
  
  // Filters
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRecord, setSelectedRecord] = useState<TransactionRecord | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Build filter object
  const filter: TransactionFilter = useMemo(() => ({
    dateFrom: dateFrom ? format(dateFrom, 'yyyy-MM-dd') : undefined,
    dateTo: dateTo ? format(dateTo, 'yyyy-MM-dd') : undefined,
    userId: selectedUser || undefined,
    branchId: selectedBranch || scopeBranchId || undefined,
    category: selectedCategory as TransactionCategory || undefined,
    searchTerm: searchTerm || undefined,
  }), [dateFrom, dateTo, selectedUser, selectedBranch, selectedCategory, searchTerm, scopeBranchId]);

  // Get filtered records
  const filteredRecords = useMemo(() => {
    return filterTransactionHistory(filter);
  }, [filter]);

  // Get stats
  const stats = useMemo(() => {
    return getTransactionStats(filter);
  }, [filter]);

  // Pagination
  const totalPages = Math.ceil(filteredRecords.length / ITEMS_PER_PAGE);
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredRecords.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredRecords, currentPage]);

  // Clear filters
  const clearFilters = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
    setSelectedUser('');
    setSelectedBranch('');
    setSelectedCategory('');
    setSearchTerm('');
    setCurrentPage(1);
  };

  const hasActiveFilters = dateFrom || dateTo || selectedUser || selectedBranch || selectedCategory || searchTerm;

  // Export to Excel
  const handleExport = () => {
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    exportTransactionHistoryToExcel(filteredRecords, `historico_transacoes_${dateStr}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <History className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Histórico de Transacções</h2>
            <p className="text-muted-foreground">Registo completo de todas as operações do sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="w-4 h-4 mr-2" />
            Filtros
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-2">Activos</Badge>
            )}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={filteredRecords.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Exportar Excel
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Transacções</p>
                <p className="text-2xl font-bold">{stats.totalTransactions.toLocaleString()}</p>
              </div>
              <History className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Utilizadores Activos</p>
                <p className="text-2xl font-bold">{Object.keys(stats.byUser).length}</p>
              </div>
              <User className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Vendas</p>
                <p className="text-2xl font-bold">{(stats.byCategory['sales'] || 0).toLocaleString()}</p>
              </div>
              <ShoppingCart className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Valor Total</p>
                <p className="text-2xl font-bold">{stats.totalAmount.toLocaleString('pt-AO')} Kz</p>
              </div>
              <BarChart3 className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Filtros de Pesquisa</CardTitle>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="w-4 h-4 mr-1" />
                  Limpar Filtros
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Date From */}
              <div className="space-y-2">
                <Label>Data Início</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFrom ? format(dateFrom, 'dd/MM/yyyy') : 'Seleccionar...'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-background border shadow-lg z-50" align="start">
                    <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} locale={pt} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Date To */}
              <div className="space-y-2">
                <Label>Data Fim</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateTo ? format(dateTo, 'dd/MM/yyyy') : 'Seleccionar...'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-background border shadow-lg z-50" align="start">
                    <Calendar mode="single" selected={dateTo} onSelect={setDateTo} locale={pt} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>

              {/* User Select */}
              <div className="space-y-2">
                <Label>Utilizador</Label>
                <Select
                  value={selectedUser}
                  onValueChange={(v) => setSelectedUser(v === ALL_SELECT_VALUE ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Todos os utilizadores" />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg z-50">
                    <SelectItem value={ALL_SELECT_VALUE}>Todos</SelectItem>
                    {users.map(user => (
                      <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Branch Select */}
              <div className="space-y-2">
                <Label>Filial</Label>
                <Select
                  value={selectedBranch}
                  onValueChange={(v) => setSelectedBranch(v === ALL_SELECT_VALUE ? '' : v)}
                  disabled={!canPickBranch}
                >
                  <SelectTrigger>
                  <SelectValue placeholder={t.salesAnalysisUi.allBranches} />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg z-50">
                    {canPickBranch && <SelectItem value={ALL_SELECT_VALUE}>{t.common.all}</SelectItem>}
                    {(canPickBranch ? branches : currentBranch ? [currentBranch] : []).map(branch => (
                      <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Category Select */}
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select
                  value={selectedCategory}
                  onValueChange={(v) => setSelectedCategory(v === ALL_SELECT_VALUE ? '' : v)}
                >
                  <SelectTrigger>
                  <SelectValue placeholder={t.salesAnalysisUi.allCategories} />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg z-50">
                    <SelectItem value={ALL_SELECT_VALUE}>{t.common.all}</SelectItem>
                    {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Search */}
              <div className="space-y-2 lg:col-span-3">
                <Label>{t.common.search}</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={t.transactionHistoryUi.searchPlaceholder}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              {t.transactionHistoryUi.resultsFound.replace('{count}', filteredRecords.length.toLocaleString(locale))}
            </CardTitle>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t.transactionHistoryUi.pageOf.replace('{page}', String(currentPage)).replace('{total}', String(totalPages))}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[160px]">{t.transactionHistoryUi.dateTime}</TableHead>
                  <TableHead>{t.transactionHistoryUi.user}</TableHead>
                  <TableHead>{t.transactionHistoryUi.category}</TableHead>
                  <TableHead>{t.transactionHistoryUi.action}</TableHead>
                  <TableHead>{t.common.description}</TableHead>
                  <TableHead className="w-[100px]">Valor</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRecords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>{t.common.noResults}</p>
                      <p className="text-sm">{t.transactionHistoryUi.emptyHint}</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRecords.map((record) => (
                    <TableRow key={record.id} className="hover:bg-muted/50">
                      <TableCell className="font-mono text-sm">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          {format(new Date(record.timestamp), 'dd/MM/yyyy HH:mm:ss')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="w-3 h-3 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{record.userName}</p>
                            <p className="text-xs text-muted-foreground">{record.userRole}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn("gap-1", CATEGORY_COLORS[record.category])}>
                          {CATEGORY_ICONS[record.category]}
                          {CATEGORY_LABELS[record.category]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {ACTION_LABELS[record.action] || record.action}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[300px]">
                          <p className="text-sm truncate">{record.description}</p>
                          {record.entityNumber && (
                            <p className="text-xs text-muted-foreground">
                              Ref: {record.entityNumber}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {record.amount ? (
                          <span className={record.amount > 0 ? 'text-emerald-600' : 'text-destructive'}>
                            {record.amount.toLocaleString(locale)} {t.common.currency}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t.common.dash}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSelectedRecord(record)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              {t.transactionHistoryUi.detailTitle}
            </DialogTitle>
            <DialogDescription>
              {t.transactionHistoryUi.detailDesc}
            </DialogDescription>
          </DialogHeader>
          
          {selectedRecord && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Data/Hora</Label>
                  <p className="font-medium">
                    {format(new Date(selectedRecord.timestamp), 'dd/MM/yyyy HH:mm:ss')}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">ID da Transacção</Label>
                  <p className="font-mono text-sm">{selectedRecord.id}</p>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Utilizador</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{selectedRecord.userName}</p>
                      <p className="text-xs text-muted-foreground">{selectedRecord.userRole}</p>
                    </div>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Filial</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Building className="w-4 h-4 text-muted-foreground" />
                    <p className="font-medium">{selectedRecord.branchName || t.common.dash}</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <Label className="text-xs text-muted-foreground">Categoria / Acção</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={cn("gap-1", CATEGORY_COLORS[selectedRecord.category])}>
                    {CATEGORY_ICONS[selectedRecord.category]}
                    {CATEGORY_LABELS[selectedRecord.category]}
                  </Badge>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-medium">{ACTION_LABELS[selectedRecord.action]}</span>
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Descrição</Label>
                <p className="mt-1">{selectedRecord.description}</p>
              </div>

              {selectedRecord.entityNumber && (
                <div>
                  <Label className="text-xs text-muted-foreground">Referência</Label>
                  <p className="font-mono mt-1">{selectedRecord.entityNumber}</p>
                </div>
              )}

              {selectedRecord.entityName && (
                <div>
                  <Label className="text-xs text-muted-foreground">Entidade</Label>
                  <p className="mt-1">{selectedRecord.entityName}</p>
                </div>
              )}

              {selectedRecord.amount !== undefined && selectedRecord.amount !== 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Valor</Label>
                  <p className="text-xl font-bold text-primary mt-1">
                    {selectedRecord.amount.toLocaleString('pt-AO')} Kz
                  </p>
                </div>
              )}

              {selectedRecord.details && Object.keys(selectedRecord.details).length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Detalhes Adicionais</Label>
                  <pre className="mt-1 p-3 bg-muted rounded-lg text-xs overflow-auto max-h-32">
                    {JSON.stringify(selectedRecord.details, null, 2)}
                  </pre>
                </div>
              )}

              {(selectedRecord.previousValue !== undefined || selectedRecord.newValue !== undefined) && (
                <div className="grid grid-cols-2 gap-4">
                  {selectedRecord.previousValue !== undefined && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Valor Anterior</Label>
                      <p className="font-mono text-sm mt-1">{String(selectedRecord.previousValue)}</p>
                    </div>
                  )}
                  {selectedRecord.newValue !== undefined && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Novo Valor</Label>
                      <p className="font-mono text-sm mt-1">{String(selectedRecord.newValue)}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
