/**
 * Devolução de Compra (Purchase Returns) Tab Component
 * Lives inside the Compras page as a third tab.
 * Linked to existing Fatura de Compra documents.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { generateId } from '@/lib/utils';
import { useAuth } from '@/hooks/useERP';
import { useBranchContext } from '@/contexts/BranchContext';
import { api } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  PurchaseInvoice,
  getPurchaseInvoices,
  getPurchaseInvoiceById,
  invoiceBelongsToBranch,
} from '@/lib/purchaseInvoiceStorage';
import {
  SupplierReturn,
  SupplierReturnItem,
  getSupplierReturns,
  saveSupplierReturn,
  generateSupplierReturnNumber,
} from '@/lib/supplierReturns';
import { processTransaction } from '@/lib/transactionEngine';
import { computeSupplierReturnPayableTotal } from '@/lib/supplierReturnPayable';
import { useSuppliers } from '@/hooks/useERP';
import { afterSupplierReturnMutation } from '@/lib/supplierReturnSync';
import { saveDocument } from '@/lib/documentStorage';
import type { ERPDocument } from '@/types/documents';
import { useTranslation } from '@/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Search, Plus, Save, Eye, RotateCcw, CheckCircle, XCircle,
  Package,
} from 'lucide-react';
import { normalizeProductSkuKey } from '@/lib/productDedupe';
import { ALL_BRANCHES_SCOPE_ID } from '@/lib/branchAccess';

/** Purchased qty on a PI line — API/local rows sometimes omit totalQty. */
function invoiceLineQty(line: { totalQty?: number; quantity?: number; packaging?: number }): number {
  const total = Number(line.totalQty);
  if (Number.isFinite(total) && total > 0) return total;
  const qty = Number(line.quantity) || 0;
  const pkg = Number(line.packaging) || 1;
  return Math.max(0, qty * (pkg > 0 ? pkg : 1));
}

const RETURN_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  approved: 'default',
  shipped: 'outline',
  completed: 'default',
  cancelled: 'destructive',
};

interface ReturnLineForm {
  sourceLineId: string;
  productId: string;
  productName: string;
  sku: string;
  invoiceRemainingQty: number;
  stockOnHand: number;
  maxQty: number;
  quantity: number;
  unitCost: number;
  taxRate: number;
  selected: boolean;
}

interface PurchaseReturnsTabProps {
  openCreateSignal?: number;
  preselectInvoiceId?: string | null;
  onReturnsChanged?: () => void;
  /** Same scope as Compras list (apiBranchId / toolbar). */
  listBranchId?: string | null;
  /** When true (Sede “todas”), list returnable invoices from every branch. */
  consolidated?: boolean;
}

export function PurchaseReturnsTab({
  openCreateSignal = 0,
  preselectInvoiceId = null,
  onReturnsChanged,
  listBranchId = null,
  consolidated = false,
}: PurchaseReturnsTabProps) {
  const { toast } = useToast();
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { currentBranch, branches } = useBranchContext();
  const { user } = useAuth();
  const openCreateRef = useRef(openCreateSignal);
  const branchId = useMemo(() => {
    const fromList = String(listBranchId || '').trim();
    if (fromList && fromList !== ALL_BRANCHES_SCOPE_ID) return fromList;
    return String(currentBranch?.id || '').trim() || undefined;
  }, [listBranchId, currentBranch?.id]);
  const isAllBranches =
    consolidated
    || String(listBranchId || '').trim() === ALL_BRANCHES_SCOPE_ID
    || !branchId;

  const statusLabel = useCallback((status: string) => {
    switch (status) {
      case 'pending': return t.purchaseReturnsUi.statusPending;
      case 'approved': return t.purchaseReturnsUi.statusApproved;
      case 'shipped': return t.purchaseReturnsUi.statusShipped;
      case 'completed': return t.purchaseReturnsUi.statusCompleted;
      case 'cancelled': return t.purchaseReturnsUi.statusCancelled;
      default: return status;
    }
  }, [t]);

  const reasonLabel = useCallback((reason: string) => {
    switch (reason) {
      case 'damaged': return t.purchaseReturnsUi.reasonDamaged;
      case 'wrong_item': return t.purchaseReturnsUi.reasonWrongItem;
      case 'quality': return t.purchaseReturnsUi.reasonQuality;
      case 'overstock': return t.purchaseReturnsUi.reasonOverstock;
      case 'other': return t.purchaseReturnsUi.reasonOther;
      default: return reason;
    }
  }, [t]);

  // Data
  const [returns, setReturns] = useState<SupplierReturn[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  const [reason, setReason] = useState<SupplierReturn['reason']>('damaged');
  const [reasonDescription, setReasonDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [returnLines, setReturnLines] = useState<ReturnLineForm[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingLines, setLoadingLines] = useState(false);

  // View dialog
  const [viewReturn, setViewReturn] = useState<SupplierReturn | null>(null);
  const { refreshSuppliers } = useSuppliers();
  const selectedBranch = useMemo(
    () => branches.find(branch => branch.id === (selectedInvoice?.branchId || currentBranch?.id)) || currentBranch || null,
    [branches, currentBranch, selectedInvoice?.branchId]
  );

  useEffect(() => {
    if (openCreateSignal > 0 && openCreateSignal !== openCreateRef.current) {
      resetForm();
      setCreateOpen(true);
      openCreateRef.current = openCreateSignal;
    }
  }, [openCreateSignal]);

  const getAlreadyReturnedQty = useCallback((invoiceId: string, sourceLineId: string, productId: string) => {
    return returns
      .filter(ret => ret.purchaseOrderId === invoiceId && ret.status !== 'cancelled')
      .reduce((sum, ret) => sum + ret.items
        .filter(item => (item.sourceLineId ? item.sourceLineId === sourceLineId : item.productId === productId))
        .reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
  }, [returns]);

  // Load data
  const loadData = useCallback(async () => {
    const scope = isAllBranches ? undefined : branchId;
    const [rets, invs] = await Promise.all([
      getSupplierReturns(scope),
      getPurchaseInvoices(scope, branches, { limit: 500 }),
    ]);
    setReturns(rets);
    // Confirmed (and legacy rows missing status) — never draft/cancelled.
    setInvoices(
      invs.filter((i) => {
        const st = String(i.status || 'confirmed').toLowerCase();
        return st === 'confirmed' || st === '';
      }),
    );
  }, [branchId, isAllBranches, branches]);

  useEffect(() => { loadData(); }, [loadData]);

  const returnableInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (inv.purchaseReturnsStatus === 'full') return false;
      if (!isAllBranches && branchId) {
        if (!invoiceBelongsToBranch(inv, branchId, branches)) return false;
      }
      const lines = Array.isArray(inv.lines) ? inv.lines : [];
      // List API returns NULL lines_json for speed — still show the invoice; lines load on select.
      if (lines.length === 0) return true;
      return lines.some((line) => {
        const purchased = invoiceLineQty(line);
        const remaining = Math.max(
          purchased - getAlreadyReturnedQty(inv.id, line.id, line.productId),
          0,
        );
        return remaining > 0;
      });
    });
  }, [invoices, isAllBranches, branchId, branches, getAlreadyReturnedQty]);

  // Filter returns
  const filteredReturns = useMemo(() => {
    let result = returns;
    if (filterStatus !== 'all') result = result.filter(r => r.status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.returnNumber.toLowerCase().includes(q) ||
        r.supplierName.toLowerCase().includes(q) ||
        r.purchaseOrderNumber?.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [returns, search, filterStatus]);

  const buildReturnLinesForInvoice = useCallback(async (inv: PurchaseInvoice): Promise<ReturnLineForm[]> => {
    const stockBySku = new Map<string, number>();
    const stockByProductId = new Map<string, number>();
    const warehouseId = inv.warehouseId || inv.branchId;

    const ingestRows = (rows: any[]) => {
      for (const p of rows) {
        const stock = Number(p.stock ?? p.ledger_stock ?? p.ledgerStock ?? 0) || 0;
        if (p.id) stockByProductId.set(String(p.id), stock);
        const skuKey = normalizeProductSkuKey(p.sku || p.productCode);
        if (skuKey) {
          stockBySku.set(skuKey, Math.max(stockBySku.get(skuKey) || 0, stock));
        }
      }
    };

    try {
      const grid = await api.products.inventoryGrid({ branchId: warehouseId });
      const rows = Array.isArray(grid.data?.rows)
        ? grid.data.rows
        : Array.isArray(grid.data)
          ? grid.data
          : [];
      if (rows.length > 0) ingestRows(rows);
    } catch {
      try {
        const resp = await api.products.list(warehouseId);
        const rows = Array.isArray(resp.data) ? resp.data : [];
        if (rows.length > 0) ingestRows(rows);
      } catch {
        /* stock optional for line selection */
      }
    }

    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    return lines.map((line) => {
      const purchased = invoiceLineQty(line);
      const invoiceRemainingQty = Math.max(
        purchased - getAlreadyReturnedQty(inv.id, line.id, line.productId),
        0,
      );
      const skuKey = normalizeProductSkuKey(line.productCode);
      const hasSkuStock = skuKey ? stockBySku.has(skuKey) : false;
      const hasIdStock = !!line.productId && stockByProductId.has(line.productId);
      const stockOnHand = hasSkuStock
        ? (stockBySku.get(skuKey) || 0)
        : hasIdStock
          ? (stockByProductId.get(line.productId) || 0)
          : invoiceRemainingQty;
      // Cap by invoice remaining so the user can always choose lines; stock is advisory.
      const maxQty = invoiceRemainingQty;
      return {
        sourceLineId: line.id,
        productId: line.productId,
        productName: line.description,
        sku: line.productCode,
        invoiceRemainingQty,
        stockOnHand,
        maxQty,
        quantity: maxQty > 0 ? maxQty : 0,
        unitCost: line.unitPrice,
        taxRate: line.ivaRate,
        selected: maxQty > 0,
      };
    }).filter((l) => l.invoiceRemainingQty > 0);
  }, [getAlreadyReturnedQty]);

  // Select invoice → load full document (list omits lines) → populate return lines
  const handleSelectInvoice = useCallback(async (inv: PurchaseInvoice) => {
    setInvoicePickerOpen(false);
    setLoadingLines(true);
    setReturnLines([]);
    try {
      const full = (await getPurchaseInvoiceById(inv.id)) || inv;
      setSelectedInvoice(full);
      setReturnLines(await buildReturnLinesForInvoice(full));
    } catch (err) {
      console.warn('[PurchaseReturns] load invoice lines failed:', err);
      setSelectedInvoice(inv);
      setReturnLines(await buildReturnLinesForInvoice(inv));
    } finally {
      setLoadingLines(false);
    }
  }, [buildReturnLinesForInvoice]);

  useEffect(() => {
    if (!preselectInvoiceId || invoices.length === 0) return;
    const inv = invoices.find((i) => i.id === preselectInvoiceId);
    if (
      inv
      && String(inv.status || 'confirmed').toLowerCase() === 'confirmed'
      && inv.purchaseReturnsStatus !== 'full'
    ) {
      void handleSelectInvoice(inv);
      setCreateOpen(true);
    }
  }, [preselectInvoiceId, invoices, handleSelectInvoice]);

  // Refresh invoice list when opening the picker (same branch scope as Compras).
  useEffect(() => {
    if (invoicePickerOpen) void loadData();
  }, [invoicePickerOpen, loadData]);

  // Create return
  const handleCreate = useCallback(async () => {
    if (!selectedInvoice || !user) return;
    const invoiceBranchId = selectedInvoice.branchId;
    const invoiceBranchName = selectedInvoice.branchName || selectedBranch?.name || '';
    if (!selectedBranch) {
      toast({ title: t.purchaseReturnsUi.errorTitle, description: t.purchaseReturnsUi.invoiceBranchNotFound, variant: 'destructive' });
      return;
    }
      const freshLines = await buildReturnLinesForInvoice(selectedInvoice);
      const freshByLineId = new Map(freshLines.map(l => [l.sourceLineId, l]));

      const selectedLines = returnLines
        .filter(formLine => formLine.selected && (formLine.quantity || 0) > 0)
        .map(formLine => {
          const fresh = freshByLineId.get(formLine.sourceLineId) ?? formLine;
          const invoiceLine = selectedInvoice.lines.find(l => l.id === formLine.sourceLineId)!;
          return {
            sourceLineId: formLine.sourceLineId,
            productId: formLine.productId,
            productName: formLine.productName,
            sku: formLine.sku,
            quantity: formLine.quantity,
            unitCost: formLine.unitCost || invoiceLine.unitPrice,
            taxRate: formLine.taxRate ?? invoiceLine.ivaRate,
            maxQty: fresh.maxQty,
          };
        });

    if (selectedLines.length === 0) {
      toast({ title: t.purchaseReturnsUi.errorTitle, description: t.purchaseReturnsUi.selectAtLeastOneLine, variant: 'destructive' });
      return;
    }

    const exceededLine = selectedLines.find(line => line.quantity > line.maxQty);
    if (exceededLine) {
      toast({
        title: t.purchaseReturnsUi.errorTitle,
        description: t.purchaseReturnsUi.qtyExceedsBalance.replace('{sku}', exceededLine.sku),
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const branchCode = selectedBranch.code || selectedBranch.name?.substring(0, 4).toUpperCase() || 'SEDE';
      const returnNumber = generateSupplierReturnNumber(branchCode);

      const items: SupplierReturnItem[] = selectedLines.map(line => {
        const subtotal = line.quantity * line.unitCost;
        const taxAmount = subtotal * (line.taxRate / 100);
        return {
          sourceLineId: line.sourceLineId,
          productId: line.productId,
          productName: line.productName,
          sku: line.sku,
          quantity: line.quantity,
          unitCost: line.unitCost,
          taxRate: line.taxRate,
          taxAmount,
          subtotal,
          reason: reasonDescription,
        };
      });

      const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
      const taxAmount = items.reduce((s, i) => s + i.taxAmount, 0);
      const grossTotal = subtotal + taxAmount;
      const total = computeSupplierReturnPayableTotal(selectedInvoice, grossTotal);
      const payableRatio = grossTotal > 0 ? total / grossTotal : 1;
      const journalSubtotal = Math.round(subtotal * payableRatio * 100) / 100;
      const journalTaxAmount = Math.round(taxAmount * payableRatio * 100) / 100;
      const journalTotal = Math.round((journalSubtotal + journalTaxAmount) * 100) / 100;

      // Resolve supplier id (prefer id stored on invoice from purchase posting)
      let resolvedSupplierId = selectedInvoice.supplierId || '';
      if (!resolvedSupplierId) {
        try {
          const suppliersResp = await api.suppliers.list();
          const allSuppliers = suppliersResp.data || [];
          const invName = selectedInvoice.supplierName?.trim().toLowerCase() || '';
          const matched = allSuppliers.find((s: any) => {
            const sName = String(s.name || '').trim().toLowerCase();
            return (
              sName === invName ||
              (selectedInvoice.supplierNif && s.nif === selectedInvoice.supplierNif)
            );
          });
          resolvedSupplierId = matched?.id || '';
        } catch {
          const raw = localStorage.getItem('kwanzaerp_suppliers');
          const suppliers = raw ? JSON.parse(raw) : [];
          const invName = selectedInvoice.supplierName?.trim().toLowerCase() || '';
          const matched = suppliers.find((s: any) => {
            const sName = String(s.name || '').trim().toLowerCase();
            return (
              sName === invName ||
              (selectedInvoice.supplierNif && s.nif === selectedInvoice.supplierNif)
            );
          });
          resolvedSupplierId = matched?.id || '';
        }
      }

      const returnDoc: SupplierReturn = {
        id: generateId(),
        returnNumber,
        branchId: invoiceBranchId,
        branchName: invoiceBranchName,
        purchaseOrderId: selectedInvoice.id,
        purchaseOrderNumber: selectedInvoice.invoiceNumber,
        supplierId: resolvedSupplierId,
        supplierName: selectedInvoice.supplierName,
        reason,
        reasonDescription,
        items,
        subtotal,
        taxAmount,
        total,
        status: 'pending',
        createdBy: user.name || user.username || 'Sistema',
        createdAt: new Date().toISOString(),
        notes,
      };

      // Credit note to supplier (reduces payable / refund after payment) — not a debit note
      const debitNoteDoc: ERPDocument = {
        id: generateId(),
        documentType: 'nota_credito',
        documentNumber: returnNumber,
        branchId: invoiceBranchId,
        branchName: invoiceBranchName,
        entityType: 'supplier',
        entityId: resolvedSupplierId,
        entityName: selectedInvoice.supplierName,
        entityNif: selectedInvoice.supplierNif,
        entityCode: selectedInvoice.supplierAccountCode,
        lines: items.map(item => ({
          id: generateId(),
          productId: item.productId,
          productSku: item.sku,
          description: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitCost,
          discount: 0,
          discountAmount: 0,
          taxRate: item.taxRate,
          taxAmount: item.taxAmount,
          lineTotal: item.subtotal + item.taxAmount,
        })),
        subtotal,
        totalDiscount: 0,
        totalTax: taxAmount,
        total,
        currency: selectedInvoice.currency === 'KZ' ? 'AOA' : selectedInvoice.currency,
        amountPaid: 0,
        amountDue: 0,
        parentDocumentId: selectedInvoice.id,
        parentDocumentNumber: selectedInvoice.invoiceNumber,
        parentDocumentType: 'fatura_compra',
        status: 'confirmed',
        issueDate: new Date().toISOString().slice(0, 10),
        issueTime: new Date().toTimeString().slice(0, 8),
        notes: `Devolução: ${reasonDescription}`,
        createdBy: returnDoc.createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confirmedBy: returnDoc.createdBy,
        confirmedAt: new Date().toISOString(),
      };

      // Reverse accounting — debit supplier (reduce payable), credit purchase account + IVA
      const purchaseAccountCode = selectedInvoice.purchaseAccountCode || '212';
      const ivaAccountCode = selectedInvoice.ivaAccountCode || '3451';
      const supplierAccountCode = selectedInvoice.supplierAccountCode || '321';

      const txPayload: Parameters<typeof processTransaction>[0] = {
          transactionType: 'credit_note',
          documentId: returnDoc.id,
          documentNumber: returnNumber,
          branchId: invoiceBranchId,
          branchName: invoiceBranchName,
          userId: user?.id || '',
          userName: user?.name || user?.username || 'Sistema',
          date: new Date().toISOString().slice(0, 10),
          description: `Devolução de compra - ${returnNumber} — ${selectedInvoice.supplierName}`,
          amount: journalTotal,
          stockEntries: items.map(item => {
            const invLine = selectedInvoice.lines.find(l =>
              item.sourceLineId ? l.id === item.sourceLineId : l.productId === item.productId,
            );
            return {
              productId: item.productId,
              productName: item.productName,
              productSku: item.sku,
              quantity: item.quantity,
              unitCost: item.unitCost,
              direction: 'OUT' as const,
              warehouseId: invLine?.warehouseId || selectedInvoice.warehouseId || invoiceBranchId,
            };
          }),
          journalLines: [
            {
              accountCode: supplierAccountCode,
              accountName: `Fornecedor ${selectedInvoice.supplierName}`,
              debit: journalTotal,
              credit: 0,
              note: `Devolução ${returnNumber}`,
            },
            {
              accountCode: purchaseAccountCode,
              accountName: 'Compra de Mercadorias',
              debit: 0,
              credit: journalSubtotal,
              note: `Devolução ${returnNumber} — base`,
            },
            ...(journalTaxAmount > 0 ? [{
              accountCode: ivaAccountCode,
              accountName: t.purchaseReturnsUi.taxDeductible,
              debit: 0,
              credit: journalTaxAmount,
              note: `Devolução ${returnNumber} — IVA`,
            }] : []),
          ],
          documentLinks: [{
            sourceType: 'nota_credito',
            sourceId: returnDoc.id,
            sourceNumber: returnNumber,
            targetType: 'fatura_compra',
            targetId: selectedInvoice.id,
            targetNumber: selectedInvoice.invoiceNumber,
          }],
        };

      if (resolvedSupplierId) {
        txPayload.openItem = {
          entityType: 'supplier',
          entityId: resolvedSupplierId,
          entityName: selectedInvoice.supplierName,
          documentType: 'credit_note',
          originalAmount: journalTotal,
          isDebit: false,
          currency: selectedInvoice.currency === 'KZ' ? 'AOA' : selectedInvoice.currency,
        };
        txPayload.entityBalanceUpdate = {
          entityType: 'supplier',
          entityId: resolvedSupplierId,
          entityName: selectedInvoice.supplierName,
          entityNif: selectedInvoice.supplierNif,
          amount: -journalTotal,
        };
      }

      const txResult = await processTransaction(txPayload);

      if (!txResult.success) {
        throw new Error(txResult.errors.join('; ') || 'Falha ao actualizar stock, conta corrente e contabilidade.');
      }

      await saveSupplierReturn(returnDoc);
      await saveDocument(debitNoteDoc);
      await afterSupplierReturnMutation({
        invoiceId: selectedInvoice.id,
        branchId: invoiceBranchId,
      });
      try {
        await api.suppliers.reconcileBalances();
      } catch {
        // non-blocking
      }
      await refreshSuppliers();
      onReturnsChanged?.();

      toast({ title: t.purchaseReturnsUi.returnCreated, description: `${returnNumber} — ${selectedLines.length} linha(s)` });
      setCreateOpen(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      toast({ title: t.purchaseReturnsUi.errorTitle, description: err.message || t.purchaseReturnsUi.returnCreateFailed, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [selectedInvoice, user, returnLines, reason, reasonDescription, notes, selectedBranch, loadData, onReturnsChanged, toast, buildReturnLinesForInvoice, getAlreadyReturnedQty]);

  const resetForm = () => {
    setSelectedInvoice(null);
    setReturnLines([]);
    setReason('damaged');
    setReasonDescription('');
    setNotes('');
  };

  // Status actions
  const handleApprove = useCallback(async (ret: SupplierReturn) => {
    if (ret.status !== 'pending') return;
    ret.status = 'approved';
    ret.approvedBy = user?.name || 'Sistema';
    ret.approvedAt = new Date().toISOString();
    await saveSupplierReturn(ret);
    await afterSupplierReturnMutation({ invoiceId: ret.purchaseOrderId, branchId: ret.branchId });
    onReturnsChanged?.();
    toast({ title: t.purchaseReturnsUi.returnApproved });
    await loadData();
  }, [user, loadData, onReturnsChanged, toast]);

  const handleCancel = useCallback(async (ret: SupplierReturn) => {
    if (ret.status !== 'pending') return;
    // Reverse stock — add back IN
    for (const item of ret.items) {
      try {
        await api.transactions.createStockMovement({
          productId: item.productId,
          warehouseId: ret.branchId,
          movementType: 'IN',
          quantity: item.quantity,
          referenceType: 'adjustment',
          referenceId: ret.id,
          referenceNumber: ret.returnNumber,
          notes: t.purchaseReturnsUi.cancelPurchaseReturnNotes,
          createdBy: user?.name || 'Sistema',
        });
      } catch {
        try { await api.products.updateStock(item.productId, item.quantity); } catch { }
      }
    }
    ret.status = 'cancelled';
    await saveSupplierReturn(ret);
    await afterSupplierReturnMutation({ invoiceId: ret.purchaseOrderId, branchId: ret.branchId });
    onReturnsChanged?.();
    toast({ title: t.purchaseReturnsUi.returnVoided, description: t.purchaseReturnsUi.stockRestored });
    await loadData();
  }, [user, loadData, onReturnsChanged, toast]);

  const handleComplete = useCallback(async (ret: SupplierReturn) => {
    if (ret.status !== 'approved' && ret.status !== 'shipped') return;
    ret.status = 'completed';
    ret.completedAt = new Date().toISOString();
    await saveSupplierReturn(ret);
    await afterSupplierReturnMutation({ invoiceId: ret.purchaseOrderId, branchId: ret.branchId });
    onReturnsChanged?.();
    toast({ title: t.purchaseReturnsUi.returnCompleted });
    await loadData();
  }, [loadData, onReturnsChanged, toast]);

  const fmtKz = (v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 2 }).format(v);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t.purchaseReturnsUi.searchPlaceholder} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t.purchaseReturnsUi.statusPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.purchaseReturnsUi.all}</SelectItem>
            <SelectItem value="pending">{t.purchaseReturnsUi.statusPending}</SelectItem>
            <SelectItem value="approved">{t.purchaseReturnsUi.statusApproved}</SelectItem>
            <SelectItem value="shipped">{t.purchaseReturnsUi.statusShipped}</SelectItem>
            <SelectItem value="completed">{t.purchaseReturnsUi.statusCompleted}</SelectItem>
            <SelectItem value="cancelled">{t.purchaseReturnsUi.statusCancelled}</SelectItem>
          </SelectContent>
        </Select>
        <Button className="gap-2 ml-auto" onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4" /> {t.purchaseReturnsUi.newReturn}
        </Button>
      </div>

      {/* Returns List */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px] h-8">
                <TableHead className="w-[160px]">Nº Devolução</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Filial</TableHead>
                <TableHead>Fatura Origem</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Data</TableHead>
                <TableHead className="w-[120px]">Acções</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReturns.map(ret => {
                const statusBadge = { label: statusLabel(ret.status), variant: RETURN_STATUS_VARIANTS[ret.status] || ('outline' as const) };
                return (
                  <TableRow key={ret.id} className="h-8 text-[11px]">
                    <TableCell className="font-mono font-medium">{ret.returnNumber}</TableCell>
                    <TableCell>{ret.supplierName}</TableCell>
                    <TableCell className="text-muted-foreground">{ret.branchName || '—'}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{ret.purchaseOrderNumber}</TableCell>
                    <TableCell>{reasonLabel(ret.reason)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtKz(ret.total)}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadge.variant} className="text-[9px]">{statusBadge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {ret.createdAt ? format(new Date(ret.createdAt), 'dd/MM/yy', { locale: pt }) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setViewReturn(ret)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        {ret.status === 'pending' && (
                          <>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-primary" onClick={() => handleApprove(ret)} title={t.purchaseReturnsUi.approve}>
                              <CheckCircle className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleCancel(ret)} title={t.purchaseReturnsUi.void}>
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {(ret.status === 'approved' || ret.status === 'shipped') && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-primary" onClick={() => handleComplete(ret)} title={t.purchaseReturnsUi.complete}>
                            <CheckCircle className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredReturns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    <RotateCcw className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    {t.purchaseReturnsUi.returnsNoneFound}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ═══ CREATE RETURN DIALOG ═══ */}
      <Dialog open={createOpen} onOpenChange={v => { if (!v) setCreateOpen(false); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" /> {t.purchaseReturnsUi.createTitle}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Branch / supplier info locked to source invoice */}
            <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/50 px-3 py-2 text-sm md:grid-cols-2">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{t.purchaseReturnsUi.branchLabel}</span>
                <span className="font-medium">{selectedInvoice?.branchName || currentBranch?.name || t.purchaseReturnsUi.selectPurchaseInvoicePrompt}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t.purchaseReturnsUi.supplierAccountLabel}</span>
                <span className="font-mono font-medium">{selectedInvoice?.supplierAccountCode || '—'}</span>
              </div>
            </div>

            {/* Source invoice selection */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t.purchaseReturnsUi.sourceInvoiceLabel}</Label>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 mt-1"
                  onClick={() => setInvoicePickerOpen(true)}
                >
                  <Package className="h-4 w-4" />
                  {selectedInvoice ? (
                    <span className="font-mono">{selectedInvoice.invoiceNumber} — {selectedInvoice.supplierName}</span>
                  ) : (
                    <span className="text-muted-foreground">{t.purchaseReturnsUi.selectInvoicePlaceholder}</span>
                  )}
                </Button>
              </div>
              <div>
                <Label>{t.purchaseReturnsUi.reasonLabel}</Label>
                <Select value={reason} onValueChange={v => setReason(v as any)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="damaged">{t.purchaseReturnsUi.reasonDamaged}</SelectItem>
                    <SelectItem value="wrong_item">{t.purchaseReturnsUi.reasonWrongItem}</SelectItem>
                    <SelectItem value="quality">{t.purchaseReturnsUi.reasonQuality}</SelectItem>
                    <SelectItem value="overstock">{t.purchaseReturnsUi.reasonOverstock}</SelectItem>
                    <SelectItem value="other">{t.purchaseReturnsUi.reasonOther}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>{t.purchaseReturnsUi.reasonDescriptionLabel}</Label>
              <Input
                value={reasonDescription}
                onChange={e => setReasonDescription(e.target.value)}
                placeholder={t.purchaseReturnsUi.reasonDescriptionPlaceholder}
                className="mt-1"
              />
            </div>

            {/* Lines from invoice */}
            {selectedInvoice && (
              <div>
                <Label className="mb-2 block">{t.purchaseReturnsUi.invoiceLinesLabel}</Label>
                {loadingLines ? (
                  <p className="text-sm text-muted-foreground border rounded-lg px-3 py-6 text-center">
                    {t.purchaseReturnsUi.loadingInvoiceLines}
                  </p>
                ) : returnLines.length === 0 ? (
                  <p className="text-sm text-muted-foreground border rounded-lg px-3 py-6 text-center">
                    {t.purchaseReturnsUi.noReturnableLinesOnInvoice}
                  </p>
                ) : (
                 <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[11px] h-8 bg-muted/50">
                        <TableHead className="w-[40px]">✓</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-right">{t.purchaseReturnsUi.invoiceRemainingQty}</TableHead>
                        <TableHead className="text-right">{t.purchaseReturnsUi.stockOnHand}</TableHead>
                        <TableHead className="text-right w-[100px]">{t.purchaseReturnsUi.returnQty}</TableHead>
                        <TableHead className="text-right">{t.purchaseReturnsUi.unitPrice}</TableHead>
                        <TableHead className="text-right">{t.purchaseReturnsUi.vatPercent}</TableHead>
                        <TableHead className="text-right">{t.purchaseReturnsUi.subtotal}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {returnLines.map((line, idx) => {
                        const lineSubtotal = line.quantity * line.unitCost;
                        const lineTax = lineSubtotal * (line.taxRate / 100);
                        return (
                          <TableRow key={line.sourceLineId || idx} className={`h-8 text-[11px] ${!line.selected ? 'opacity-40' : ''}`}>
                            <TableCell>
                              <Checkbox
                                checked={line.selected}
                                onCheckedChange={v => {
                                  const updated = [...returnLines];
                                  updated[idx] = {
                                    ...updated[idx],
                                    selected: !!v,
                                    quantity: !!v
                                      ? (updated[idx].quantity > 0 ? updated[idx].quantity : updated[idx].maxQty)
                                      : updated[idx].quantity,
                                  };
                                  setReturnLines(updated);
                                }}
                              />
                            </TableCell>
                            <TableCell className="font-mono">{line.sku}</TableCell>
                            <TableCell>{line.productName}</TableCell>
                             <TableCell className="text-right font-mono">{line.invoiceRemainingQty}</TableCell>
                            <TableCell className="text-right font-mono">{line.stockOnHand}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                max={line.maxQty}
                                value={line.quantity}
                                onChange={e => {
                                  const val = Math.min(Number(e.target.value) || 0, line.maxQty);
                                  const updated = [...returnLines];
                                  updated[idx] = {
                                    ...updated[idx],
                                    quantity: val,
                                    selected: val > 0 ? true : updated[idx].selected,
                                  };
                                  setReturnLines(updated);
                                }}
                                className="h-6 text-[11px] w-[80px] text-right ml-auto"
                                disabled={!line.selected}
                              />
                            </TableCell>
                            <TableCell className="text-right font-mono">{fmtKz(line.unitCost)}</TableCell>
                            <TableCell className="text-right">{line.taxRate}%</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {fmtKz(lineSubtotal + lineTax)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                )}

                {/* Summary */}
                {returnLines.length > 0 && (() => {
                  const selected = returnLines.filter(l => l.selected && l.quantity > 0);
                  const sub = selected.reduce((s, l) => s + l.quantity * l.unitCost, 0);
                  const tax = selected.reduce((s, l) => s + l.quantity * l.unitCost * (l.taxRate / 100), 0);
                  return (
                    <div className="flex justify-end gap-6 mt-3 text-sm font-medium">
                      <span>{t.purchaseReturnsUi.subtotal}: <span className="font-mono">{fmtKz(sub)}</span></span>
                      <span>{t.purchaseReturnsUi.vat}: <span className="font-mono">{fmtKz(tax)}</span></span>
                      <span className="text-base font-bold">{t.purchaseReturnsUi.total}: <span className="font-mono">{fmtKz(sub + tax)}</span></span>
                    </div>
                  );
                })()}
              </div>
            )}

            <div>
              <Label>{t.purchaseReturnsUi.notesLabel}</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={t.purchaseReturnsUi.notesPlaceholder}
                className="mt-1"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t.purchaseReturnsUi.cancel}</Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !selectedInvoice || !reasonDescription.trim() || returnLines.filter(l => l.selected && l.quantity > 0).length === 0}
              className="gap-2"
            >
              {saving ? <span className="animate-spin">⏳</span> : <Save className="h-4 w-4" />}
              {t.purchaseReturnsUi.createReturn}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ INVOICE PICKER DIALOG ═══ */}
      <Dialog open={invoicePickerOpen} onOpenChange={setInvoicePickerOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t.purchaseReturnsUi.selectPurchaseInvoiceTitle}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead>{t.purchaseReturnsUi.invoiceNo}</TableHead>
                  <TableHead>{t.purchaseReturnsUi.supplier}</TableHead>
                  <TableHead>{t.purchaseReturnsUi.date}</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">{t.purchaseReturnsUi.lines}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                  {returnableInvoices.map(inv => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer hover:bg-accent h-8 text-[11px]"
                    onClick={() => handleSelectInvoice(inv)}
                  >
                    <TableCell className="font-mono font-medium">{inv.invoiceNumber}</TableCell>
                    <TableCell>{inv.supplierName}</TableCell>
                    <TableCell>{inv.date}</TableCell>
                    <TableCell className="text-right font-mono">{fmtKz(inv.total)}</TableCell>
                    <TableCell className="text-right">{inv.lines?.length || 0}</TableCell>
                  </TableRow>
                ))}
                 {returnableInvoices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                       {t.purchaseReturnsUi.noInvoicesWithReturnableBalance}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ═══ VIEW RETURN DIALOG ═══ */}
      <Dialog open={!!viewReturn} onOpenChange={() => setViewReturn(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              {t.purchaseReturnsUi.viewTitle.replace('{number}', viewReturn?.returnNumber || '')}
            </DialogTitle>
          </DialogHeader>
          {viewReturn && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground text-xs">{t.purchaseReturnsUi.supplier}</Label>
                  <p className="font-medium">{viewReturn.supplierName}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">{t.purchaseReturnsUi.sourceInvoiceShort}</Label>
                  <p className="font-mono">{viewReturn.purchaseOrderNumber}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">{t.purchaseReturnsUi.branch}</Label>
                  <p className="font-medium">{viewReturn.branchName || '—'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">{t.purchaseReturnsUi.status}</Label>
                  <Badge variant={RETURN_STATUS_VARIANTS[viewReturn.status] || 'outline'}>
                    {statusLabel(viewReturn.status)}
                  </Badge>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">{t.purchaseReturnsUi.reason}</Label>
                  <p>{reasonLabel(viewReturn.reason)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">{t.purchaseReturnsUi.description}</Label>
                  <p>{viewReturn.reasonDescription}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">{t.purchaseReturnsUi.createdBy}</Label>
                  <p>{viewReturn.createdBy} — {viewReturn.createdAt ? format(new Date(viewReturn.createdAt), 'dd/MM/yyyy HH:mm') : ''}</p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>SKU</TableHead>
                    <TableHead>{t.purchaseReturnsUi.product}</TableHead>
                    <TableHead className="text-right">{t.purchaseReturnsUi.qty}</TableHead>
                    <TableHead className="text-right">{t.purchaseReturnsUi.unitCost}</TableHead>
                    <TableHead className="text-right">{t.purchaseReturnsUi.vat}</TableHead>
                    <TableHead className="text-right">{t.purchaseReturnsUi.total}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewReturn.items.map((item, i) => (
                    <TableRow key={i} className="h-8 text-[11px]">
                      <TableCell className="font-mono">{item.sku}</TableCell>
                      <TableCell>{item.productName}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right font-mono">{fmtKz(item.unitCost)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtKz(item.taxAmount)}</TableCell>
                      <TableCell className="text-right font-mono font-medium">{fmtKz(item.subtotal + item.taxAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex justify-end gap-6 text-sm border-t pt-3">
                <span>{t.purchaseReturnsUi.subtotal}: <span className="font-mono">{fmtKz(viewReturn.subtotal)}</span></span>
                <span>{t.purchaseReturnsUi.vat}: <span className="font-mono">{fmtKz(viewReturn.taxAmount)}</span></span>
                <span className="font-bold text-base">{t.purchaseReturnsUi.total}: <span className="font-mono">{fmtKz(viewReturn.total)}</span></span>
              </div>

              {viewReturn.notes && (
                <div className="text-sm">
                  <Label className="text-muted-foreground text-xs">{t.purchaseReturnsUi.notesLabel}</Label>
                  <p>{viewReturn.notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
