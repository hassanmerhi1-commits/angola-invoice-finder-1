import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ClipboardList,
  Download,
  Eye,
  Pencil,
  Printer,
  Search,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { StockAdjustmentEditDialog } from '@/components/inventory/StockAdjustmentEditDialog';
import { voidStockAdjustmentDocument } from '@/lib/stockAdjustmentActions';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { getStockMovements as getLocalStockMovements } from '@/lib/storage';
import type { StockMovement } from '@/types/erp';
import {
  filterStockAdjustmentDocuments,
  groupStockAdjustmentDocuments,
  printStockAdjustmentDocument,
  type StockAdjustmentDocument,
} from '@/lib/stockAdjustmentDocuments';

function mapMovementRow(m: Record<string, unknown>): StockMovement {
  return {
    id: String(m.id),
    productId: String(m.product_id || m.productId || ''),
    productName: String(m.product_name || m.productName || ''),
    sku: String(m.sku || ''),
    branchId: String(m.warehouse_id || m.warehouseId || m.branch_id || m.branchId || ''),
    branchName: String(m.branch_name || m.branchName || ''),
    branchCode: String(m.branch_code || m.branchCode || ''),
    createdByName: String(m.created_by_name || m.createdByName || ''),
    type: (m.movement_type || m.type || 'IN') as 'IN' | 'OUT',
    quantity: Number(m.quantity) || 0,
    reason: String(m.reference_type || m.reason || 'adjustment'),
    referenceId: String(m.reference_id || m.referenceId || ''),
    referenceNumber: String(m.reference_number || m.referenceNumber || ''),
    costAtTime: Number(m.unit_cost || m.costAtTime || 0),
    notes: String(m.notes || ''),
    createdBy: String(m.created_by || m.createdBy || ''),
    createdAt: String(m.created_at || m.createdAt || ''),
  };
}

export default function StockAdjustmentHistoryReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const dfLocale = language === 'pt' ? pt : enUS;
  const { apiBranchId, branches, canPickBranch } = useBranchScope();
  const { toast } = useToast();

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [direction, setDirection] = useState<'all' | 'IN' | 'OUT'>('all');
  const [branchFilter, setBranchFilter] = useState(apiBranchId || '');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<StockAdjustmentDocument | null>(null);
  const [editDoc, setEditDoc] = useState<StockAdjustmentDocument | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<StockAdjustmentDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadMovements = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.transactions.stockMovements({
        warehouseId: branchFilter || apiBranchId || undefined,
        dateFrom: startDate || undefined,
        dateTo: endDate || undefined,
        adjustmentsOnly: true,
        limit: 2000,
      });
      if (result.data && Array.isArray(result.data)) {
        setMovements(result.data.map((row) => mapMovementRow(row as Record<string, unknown>)));
        return;
      }
      const local = await getLocalStockMovements(branchFilter || apiBranchId);
      setMovements(local);
    } catch {
      try {
        const local = await getLocalStockMovements(branchFilter || apiBranchId);
        setMovements(local);
      } catch {
        setMovements([]);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBranchId, branchFilter, startDate, endDate]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  useEffect(() => {
    if (!canPickBranch && apiBranchId) {
      setBranchFilter(apiBranchId);
    }
  }, [canPickBranch, apiBranchId]);

  const getReasonLabel = useCallback(
    (reason: string) => {
      switch (reason) {
        case 'purchase':
          return t.stockMovementUi.reasonPurchase;
        case 'sale':
          return t.stockMovementUi.reasonSale;
        case 'transfer':
        case 'transfer_in':
          return t.stockMovementUi.reasonTransferIn;
        case 'transfer_out':
          return t.stockMovementUi.reasonTransferOut;
        case 'adjustment':
          return t.stockMovementUi.reasonAdjustment;
        case 'damage':
          return t.stockMovementUi.reasonDamage;
        case 'return':
          return t.stockMovementUi.reasonReturn;
        case 'initial':
          return t.stockMovementUi.reasonInitial;
        case 'correction':
          return t.adjustmentHistoryUi.reasonCorrection;
        case 'loss':
        case 'expired':
          return t.adjustmentHistoryUi.reasonLoss;
        default:
          return reason;
      }
    },
    [t],
  );

  const documents = useMemo(
    () => groupStockAdjustmentDocuments(movements),
    [movements],
  );

  const filteredDocuments = useMemo(
    () =>
      filterStockAdjustmentDocuments(documents, {
        dateFrom: startDate,
        dateTo: endDate,
        direction,
        // Empty branchFilter = all branches (don't fall back to apiBranchId and hide other sites).
        branchId: branchFilter || undefined,
        searchTerm,
      }),
    [documents, startDate, endDate, direction, branchFilter, searchTerm],
  );

  const formatMoney = (value: number) =>
    value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatDateTime = (iso: string) =>
    format(new Date(iso), 'dd/MM/yyyy HH:mm', { locale: dfLocale });

  const printLabels = useMemo(
    () => ({
      title: t.adjustmentHistoryUi.printTitle,
      reference: t.adjustmentHistoryUi.colReference,
      date: t.common.date,
      branch: t.adjustmentHistoryUi.colBranch,
      direction: t.adjustmentHistoryUi.colDirection,
      directionIn: t.stockMovementUi.typeIn,
      directionOut: t.stockMovementUi.typeOut,
      reason: t.stockMovementUi.colReason,
      user: t.adjustmentHistoryUi.colUser,
      notes: t.common.notes,
      sku: 'SKU',
      product: t.common.product,
      quantity: t.common.qty,
      unitCost: t.stockMovementUi.colUnitCost,
      lineTotal: t.stockMovementUi.colTotalValue,
      documentTotal: t.adjustmentHistoryUi.documentTotal,
      printedAt: t.adjustmentHistoryUi.printedAt.replace(
        '{date}',
        format(new Date(), 'dd/MM/yyyy HH:mm', { locale: dfLocale }),
      ),
    }),
    [t, dfLocale],
  );

  const handleDeleteDocument = async () => {
    if (!deleteDoc) return;
    setDeleting(true);
    try {
      await voidStockAdjustmentDocument(deleteDoc.id, undefined, deleteDoc.branchId);
      toast({
        title: t.common.success,
        description: t.adjustmentHistoryUi.deleteSuccess.replace('{ref}', deleteDoc.referenceNumber),
      });
      setDeleteDoc(null);
      setSelectedDoc(null);
      await loadMovements();
    } catch (err) {
      toast({
        title: t.common.error,
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handlePrintDocument = (doc: StockAdjustmentDocument) => {
    void printStockAdjustmentDocument(
      doc,
      printLabels,
      formatMoney,
      formatDateTime,
      getReasonLabel,
    ).catch((err: unknown) => {
      toast({
        title: t.common.error,
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    });
  };

  const handleExportCsv = () => {
    const headers = [
      t.common.date,
      t.adjustmentHistoryUi.colReference,
      t.adjustmentHistoryUi.colDirection,
      t.stockMovementUi.colReason,
      t.adjustmentHistoryUi.colBranch,
      t.adjustmentHistoryUi.colUser,
      t.adjustmentHistoryUi.colLines,
      t.common.qty,
      t.stockMovementUi.colTotalValue,
      t.common.notes,
    ];
    const rows = filteredDocuments.map((doc) => [
      formatDateTime(doc.createdAt),
      doc.referenceNumber,
      doc.direction === 'IN' ? t.stockMovementUi.typeIn : t.stockMovementUi.typeOut,
      getReasonLabel(doc.reason),
      doc.branchName,
      doc.createdByName,
      doc.lineCount,
      doc.totalQuantity,
      doc.totalValue,
      doc.notes,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ajustes_stock_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardList className="w-5 h-5" />
            {t.adjustmentHistoryUi.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t.adjustmentHistoryUi.description}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <Label>{t.reportsUi.dateFrom}</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>{t.reportsUi.dateTo}</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div>
              <Label>{t.adjustmentHistoryUi.colDirection}</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as 'all' | 'IN' | 'OUT')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.common.all}</SelectItem>
                  <SelectItem value="IN">{t.stockMovementUi.typeIn}</SelectItem>
                  <SelectItem value="OUT">{t.stockMovementUi.typeOut}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canPickBranch && (
              <div>
                <Label>{t.adjustmentHistoryUi.colBranch}</Label>
                <Select value={branchFilter || '__all__'} onValueChange={(v) => setBranchFilter(v === '__all__' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t.branchUi.allBranches}</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>{t.common.search}</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t.adjustmentHistoryUi.searchPlaceholder}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void loadMovements()} disabled={loading}>
              {t.common.refresh}
            </Button>
            <Button variant="outline" onClick={handleExportCsv} disabled={filteredDocuments.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              {t.common.export}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common.date}</TableHead>
                <TableHead>{t.adjustmentHistoryUi.colReference}</TableHead>
                <TableHead>{t.adjustmentHistoryUi.colDirection}</TableHead>
                <TableHead>{t.stockMovementUi.colReason}</TableHead>
                <TableHead>{t.adjustmentHistoryUi.colBranch}</TableHead>
                <TableHead>{t.adjustmentHistoryUi.colUser}</TableHead>
                <TableHead className="text-right">{t.adjustmentHistoryUi.colLines}</TableHead>
                <TableHead className="text-right">{t.common.qty}</TableHead>
                <TableHead className="text-right">{t.stockMovementUi.colTotalValue}</TableHead>
                <TableHead className="text-right">{t.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDocuments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                    {loading ? t.common.loading : t.adjustmentHistoryUi.empty}
                  </TableCell>
                </TableRow>
              ) : (
                filteredDocuments.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(doc.createdAt)}</TableCell>
                    <TableCell className="font-mono text-sm">{doc.referenceNumber}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={doc.direction === 'IN' ? 'text-green-700 border-green-300' : 'text-red-700 border-red-300'}
                      >
                        {doc.direction === 'IN' ? (
                          <ArrowDownCircle className="w-3 h-3 mr-1" />
                        ) : (
                          <ArrowUpCircle className="w-3 h-3 mr-1" />
                        )}
                        {doc.direction === 'IN' ? t.stockMovementUi.typeIn : t.stockMovementUi.typeOut}
                      </Badge>
                    </TableCell>
                    <TableCell>{getReasonLabel(doc.reason)}</TableCell>
                    <TableCell>{doc.branchName}</TableCell>
                    <TableCell>{doc.createdByName || '—'}</TableCell>
                    <TableCell className="text-right">{doc.lineCount}</TableCell>
                    <TableCell className="text-right">{doc.totalQuantity}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(doc.totalValue)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setSelectedDoc(doc)} title={t.common.view}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handlePrintDocument(doc)} title={t.common.print}>
                          <Printer className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setEditDoc(doc)} title={t.common.edit}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteDoc(doc)}
                          title={t.common.delete}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedDoc} onOpenChange={(open) => !open && setSelectedDoc(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selectedDoc && (
            <>
              <DialogHeader>
                <DialogTitle>{t.adjustmentHistoryUi.detailTitle}</DialogTitle>
                <DialogDescription>
                  {selectedDoc.referenceNumber} · {formatDateTime(selectedDoc.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">{t.adjustmentHistoryUi.colBranch}:</span> {selectedDoc.branchName}</div>
                  <div><span className="text-muted-foreground">{t.adjustmentHistoryUi.colUser}:</span> {selectedDoc.createdByName || '—'}</div>
                  <div><span className="text-muted-foreground">{t.stockMovementUi.colReason}:</span> {getReasonLabel(selectedDoc.reason)}</div>
                  <div><span className="text-muted-foreground">{t.adjustmentHistoryUi.colDirection}:</span> {selectedDoc.direction === 'IN' ? t.stockMovementUi.typeIn : t.stockMovementUi.typeOut}</div>
                </div>
                {selectedDoc.notes && (
                  <p><span className="text-muted-foreground">{t.common.notes}:</span> {selectedDoc.notes}</p>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>{t.common.product}</TableHead>
                      <TableHead className="text-right">{t.common.qty}</TableHead>
                      <TableHead className="text-right">{t.stockMovementUi.colUnitCost}</TableHead>
                      <TableHead className="text-right">{t.stockMovementUi.colTotalValue}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedDoc.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                        <TableCell>{line.productName}</TableCell>
                        <TableCell className="text-right">{line.quantity}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(line.unitCost)}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(line.lineValue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-between items-center pt-2 border-t gap-2 flex-wrap">
                  <span className="font-medium">
                    {t.adjustmentHistoryUi.documentTotal}: {formatMoney(selectedDoc.totalValue)}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditDoc(selectedDoc)}>
                      <Pencil className="w-4 h-4 mr-2" />
                      {t.common.edit}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handlePrintDocument(selectedDoc)}>
                      <Printer className="w-4 h-4 mr-2" />
                      {t.common.print}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setDeleteDoc(selectedDoc)}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      {t.common.delete}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <StockAdjustmentEditDialog
        open={!!editDoc}
        onOpenChange={(open) => !open && setEditDoc(null)}
        document={editDoc}
        onSaved={() => void loadMovements()}
      />

      <AlertDialog open={!!deleteDoc} onOpenChange={(open) => !open && setDeleteDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.adjustmentHistoryUi.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.adjustmentHistoryUi.deleteDescription.replace(
                '{ref}',
                deleteDoc?.referenceNumber || '',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteDocument();
              }}
            >
              {deleting ? t.common.loading : t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
