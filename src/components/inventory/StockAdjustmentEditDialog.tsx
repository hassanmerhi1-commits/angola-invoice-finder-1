import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NumericInput } from '@/components/ui/numeric-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useToast } from '@/hooks/use-toast';
import { useSuppliers } from '@/hooks/useERP';
import { useBranchScope } from '@/hooks/useBranchScope';
import { api } from '@/lib/api/client';
import { mapApiProductRow } from '@/lib/productSupplierResolve';
import { filterProductsForSearch, sortProductSearchResults } from '@/components/inventory/productLineSearch';
import { getCaixas, getBankAccounts } from '@/lib/accountingStorage';
import {
  formatFreightBankLabel,
  formatFreightCaixaLabel,
  resolveFreightTreasuryGl,
  type FreightPaymentSource,
} from '@/lib/freightTreasury';
import type { Product } from '@/types/erp';
import type { Caixa, BankAccount } from '@/types/accounting';
import {
  freightFromJournalLines,
  type StockAdjustmentDocument,
} from '@/lib/stockAdjustmentDocuments';
import { replaceStockAdjustmentDocument } from '@/lib/stockAdjustmentActions';

const IN_REASONS = ['adjustment', 'purchase', 'transfer', 'initial', 'correction'] as const;
const OUT_REASONS = ['adjustment', 'damage', 'loss', 'expired', 'internal_use', 'sample', 'donation'] as const;

interface EditableLine {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitCost: number;
}

interface StockAdjustmentEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: StockAdjustmentDocument | null;
  onSaved: () => void;
}

function isoDateOnly(value: string): string {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function normalizeReason(reason: string, direction: 'IN' | 'OUT'): string {
  const raw = String(reason || '').toLowerCase().trim();
  if (raw === 'transfer_in' || raw === 'transfer_out') return 'transfer';
  if (direction === 'IN') return (IN_REASONS as readonly string[]).includes(raw) ? raw : 'adjustment';
  if (raw === 'damaged') return 'damage';
  return (OUT_REASONS as readonly string[]).includes(raw) ? raw : 'adjustment';
}

export function StockAdjustmentEditDialog({
  open,
  onOpenChange,
  document,
  onSaved,
}: StockAdjustmentEditDialogProps) {
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const { branches, canPickBranch } = useBranchScope();
  const { suppliers } = useSuppliers();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-GB';

  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [branchId, setBranchId] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [reason, setReason] = useState('adjustment');
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [freightCost, setFreightCost] = useState(0);
  const [freightPaymentSource, setFreightPaymentSource] = useState<FreightPaymentSource>('caixa');
  const [freightCaixaId, setFreightCaixaId] = useState('');
  const [freightBankAccountId, setFreightBankAccountId] = useState('');
  const [freightSourceAccount, setFreightSourceAccount] = useState('');
  const [freightSourceName, setFreightSourceName] = useState('');
  const [freightCaixas, setFreightCaixas] = useState<Caixa[]>([]);
  const [freightBankAccounts, setFreightBankAccounts] = useState<BankAccount[]>([]);
  const [freightTreasuryLoading, setFreightTreasuryLoading] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !document) return;
    setReferenceNumber(document.referenceNumber);
    setNotes(document.notes);
    setBranchId(document.branchId);
    setEntryDate(isoDateOnly(document.createdAt));
    setDirection(document.direction);
    setReason(normalizeReason(document.reason, document.direction));
    setLines(
      document.lines.map((line) => ({
        productId: line.productId,
        sku: line.sku,
        productName: line.productName,
        quantity: line.quantity,
        unitCost: line.unitCost,
      })),
    );
    setFreightCost(Number(document.landingCosts) || 0);
    setFreightSourceAccount(document.freightSourceAccount || '');
    setFreightSourceName(document.freightSourceName || '');
    setFreightPaymentSource(
      String(document.freightSourceAccount || '').startsWith('43') ? 'bank' : 'caixa',
    );
    setFreightCaixaId('');
    setFreightBankAccountId('');
    setSupplierId(document.supplierId || '');
    setSupplierName(document.supplierName || '');
    setProductQuery('');
  }, [open, document]);

  useEffect(() => {
    if (!open || !document?.id) return;
    let cancelled = false;
    void api.journalEntries.getByReference('adjustment', document.id).then((res) => {
      if (cancelled || !res.data) return;
      const entries = Array.isArray(res.data) ? res.data : [];
      const journalLines = entries.flatMap((entry) =>
        Array.isArray(entry?.lines) ? entry.lines : [],
      ) as Array<Record<string, unknown>>;
      const recovered = freightFromJournalLines(journalLines);
      if (recovered.landingCosts > 0) {
        setFreightCost((prev) => (prev > 0 ? prev : recovered.landingCosts));
        if (recovered.freightSourceAccount) {
          setFreightSourceAccount(recovered.freightSourceAccount);
          setFreightSourceName(recovered.freightSourceName);
          setFreightPaymentSource(recovered.freightSourceAccount.startsWith('43') ? 'bank' : 'caixa');
        }
      }
      if (recovered.supplierName) {
        setSupplierName((prev) => prev || recovered.supplierName);
        const match = suppliers.find(
          (s) => s.name.trim().toLowerCase() === recovered.supplierName.trim().toLowerCase(),
        );
        if (match) setSupplierId((prev) => prev || match.id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, document?.id, suppliers]);

  useEffect(() => {
    if (!open || !branchId) {
      setCatalog([]);
      return;
    }
    let cancelled = false;
    void api.products.list(branchId, { light: true }).then((res) => {
      if (cancelled) return;
      const rows = (res.data || [])
        .map((row) => mapApiProductRow(row as Record<string, unknown>))
        .filter((p) => p.isActive !== false);
      setCatalog(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, branchId]);

  useEffect(() => {
    if (!open) return;
    const branchName = branches.find((b) => b.id === branchId)?.name || '';
    let cancelled = false;
    setFreightTreasuryLoading(true);
    void Promise.all([
      getCaixas(branchId, branchName, {
        ensureIfEmpty: !canPickBranch,
        allBranches: canPickBranch,
      }),
      getBankAccounts(canPickBranch ? undefined : branchId, { allBranches: canPickBranch }),
    ])
      .then(([caixas, banks]) => {
        if (cancelled) return;
        setFreightCaixas(caixas);
        setFreightBankAccounts(banks);
        setFreightCaixaId((prev) => {
          if (prev && caixas.some((c) => c.id === prev)) return prev;
          const local = caixas.find((c) => String(c.branchId || '') === branchId);
          return (local || caixas[0])?.id || '';
        });
        setFreightBankAccountId((prev) => {
          if (prev && banks.some((b) => b.id === prev)) return prev;
          const local = banks.find((b) => String(b.branchId || '') === branchId);
          return (local || banks[0])?.id || '';
        });
      })
      .finally(() => {
        if (!cancelled) setFreightTreasuryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, branchId, branches, canPickBranch]);

  const showFreight = direction === 'IN' && reason !== 'transfer';
  const showSupplier = direction === 'IN' && reason === 'purchase';

  const totalValue = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
    [lines],
  );

  const usedProductIds = useMemo(
    () => new Set(lines.map((line) => line.productId).filter(Boolean)),
    [lines],
  );

  const productHits = useMemo(() => {
    if (!productQuery.trim()) return [];
    return filterProductsForSearch(catalog, productQuery, usedProductIds, branchId)
      .sort((a, b) => sortProductSearchResults(a, b, productQuery, branchId))
      .slice(0, 8);
  }, [catalog, productQuery, usedProductIds, branchId]);

  const inReasonOptions = useMemo(
    () => [
      { value: 'adjustment', label: t.stockEntryUi.reasonAdjustment },
      { value: 'purchase', label: t.stockEntryUi.reasonPurchase },
      { value: 'transfer', label: t.stockEntryUi.reasonTransferIn },
      { value: 'initial', label: t.stockEntryUi.reasonInitial },
      { value: 'correction', label: t.stockEntryUi.reasonCorrection },
    ],
    [t],
  );

  const outReasonOptions = useMemo(
    () => [
      { value: 'adjustment', label: t.stockExitUi.reasonAdjustment },
      { value: 'damage', label: t.stockExitUi.reasonDamaged },
      { value: 'loss', label: t.stockExitUi.reasonLoss },
      { value: 'expired', label: t.stockExitUi.reasonExpired },
      { value: 'internal_use', label: t.stockExitUi.reasonInternalUse },
      { value: 'sample', label: t.stockExitUi.reasonSample },
      { value: 'donation', label: t.stockExitUi.reasonDonation },
    ],
    [t],
  );

  const addProduct = (product: Product) => {
    setLines((prev) => [
      ...prev,
      {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        quantity: 1,
        unitCost: Number(product.cost || product.lastCost || product.avgCost || 0) || 0,
      },
    ]);
    setProductQuery('');
  };

  const handleDirectionChange = (next: 'IN' | 'OUT') => {
    setDirection(next);
    setReason(normalizeReason(reason, next));
  };

  const handleSave = async () => {
    if (!document) return;
    const validLines = lines.filter((l) => l.productId && l.quantity > 0);
    if (validLines.length === 0) {
      toast({
        title: t.common.error,
        description: t.adjustmentHistoryUi.editNeedsLines,
        variant: 'destructive',
      });
      return;
    }
    if (!branchId) {
      toast({
        title: t.common.error,
        description: t.adjustmentHistoryUi.editNeedsBranch,
        variant: 'destructive',
      });
      return;
    }
    const selectedSupplier = suppliers.find((s) => s.id === supplierId);
    if (showSupplier && !selectedSupplier && !supplierName.trim()) {
      toast({
        title: t.common.error,
        description: t.adjustmentHistoryUi.editPurchaseNeedsSupplier,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      let nextFreightAccount = freightSourceAccount;
      let nextFreightName = freightSourceName;
      if (showFreight && freightCost > 0 && (!nextFreightAccount || freightCaixaId || freightBankAccountId)) {
        const treasury = await resolveFreightTreasuryGl({
          paymentSource: freightPaymentSource,
          caixaId: freightCaixaId || undefined,
          bankAccountId: freightBankAccountId || undefined,
          branchId,
          freightSourceAccount: nextFreightAccount,
          freightSourceName: nextFreightName,
          caixas: freightCaixas,
          bankAccounts: freightBankAccounts,
        });
        nextFreightAccount = treasury.accountCode || nextFreightAccount;
        nextFreightName = treasury.accountName || nextFreightName;
      }

      const result = await replaceStockAdjustmentDocument(document, {
        warehouseId: branchId,
        direction,
        referenceType: reason,
        entryDate,
        referenceNumber: referenceNumber.trim() || document.referenceNumber,
        notes,
        lines: validLines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
        })),
        landingCosts: showFreight ? freightCost : 0,
        freightSourceAccount: showFreight && freightCost > 0 ? nextFreightAccount : undefined,
        freightSourceName: showFreight && freightCost > 0 ? nextFreightName : undefined,
        supplierId: showSupplier ? selectedSupplier?.id || undefined : undefined,
        supplierName: showSupplier
          ? selectedSupplier?.name || supplierName.trim() || undefined
          : undefined,
      });
      toast({
        title: t.common.success,
        description: t.adjustmentHistoryUi.editSuccess.replace('{ref}', result.referenceNumber),
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: t.common.error,
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!document) return null;

  const branchOptions = branches.filter((b) => b.id);
  const branchLocked = !canPickBranch && Boolean(document.branchId);
  const reasonOptions = direction === 'IN' ? inReasonOptions : outReasonOptions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.adjustmentHistoryUi.editTitle}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>{t.stockEntryUi.receiptNumber}</Label>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t.adjustmentHistoryUi.colBranch}</Label>
            {branchLocked ? (
              <Input value={document.branchName} disabled />
            ) : (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder={t.stockEntryUi.selectBranchPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {branchOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}{b.code ? ` (${b.code})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t.common.date}</Label>
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t.adjustmentHistoryUi.colDirection}</Label>
            <Select value={direction} onValueChange={(v) => handleDirectionChange(v as 'IN' | 'OUT')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="IN">{t.stockMovementUi.typeIn}</SelectItem>
                <SelectItem value="OUT">{t.stockMovementUi.typeOut}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t.stockMovementUi.colReason}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reasonOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showSupplier && (
            <div className="space-y-2">
              <Label>{t.adjustmentHistoryUi.supplier}</Label>
              <Select value={supplierId || undefined} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder={t.adjustmentHistoryUi.selectSupplier} />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.filter((s) => s.isActive !== false).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t.common.notes}</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        {showFreight && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t.stockEntryUi.freightLabel}</Label>
              <NumericInput min={0} value={freightCost} onValueChange={setFreightCost} />
            </div>
            {freightCost > 0 && (
              <>
                <div className="space-y-2">
                  <Label>{t.stockEntryUi.freightPaymentSource}</Label>
                  <Select
                    value={freightPaymentSource}
                    onValueChange={(v) => setFreightPaymentSource(v as FreightPaymentSource)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="caixa">{t.stockEntryUi.freightSourceCaixa}</SelectItem>
                      <SelectItem value="bank">{t.stockEntryUi.freightSourceBank}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>
                    {freightPaymentSource === 'caixa'
                      ? t.stockEntryUi.selectFreightCaixa
                      : t.stockEntryUi.selectFreightBank}
                  </Label>
                  {freightPaymentSource === 'caixa' ? (
                    <Select
                      value={freightCaixaId || undefined}
                      onValueChange={setFreightCaixaId}
                      disabled={freightTreasuryLoading}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            freightTreasuryLoading
                              ? t.stockEntryUi.freightTreasuryLoading
                              : t.stockEntryUi.selectFreightCaixa
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {freightCaixas.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {formatFreightCaixaLabel(c, uiLocale, canPickBranch)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={freightBankAccountId || undefined}
                      onValueChange={setFreightBankAccountId}
                      disabled={freightTreasuryLoading}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t.stockEntryUi.selectFreightBank} />
                      </SelectTrigger>
                      <SelectContent>
                        {freightBankAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {formatFreightBankLabel(a, canPickBranch)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label>{t.adjustmentHistoryUi.addProduct}</Label>
          <Input
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            placeholder={t.stockEntryUi.searchPlaceholder}
          />
          {productHits.length > 0 && (
            <div className="border rounded-md max-h-40 overflow-y-auto">
              {productHits.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => addProduct(product)}
                >
                  <span>
                    <span className="font-mono text-xs mr-2">{product.sku}</span>
                    {product.name}
                  </span>
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>{t.common.product}</TableHead>
              <TableHead className="text-right w-28">{t.common.qty}</TableHead>
              <TableHead className="text-right w-32">{t.stockMovementUi.colUnitCost}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, idx) => (
              <TableRow key={`${line.productId}-${idx}`}>
                <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                <TableCell>{line.productName}</TableCell>
                <TableCell className="text-right">
                  <NumericInput
                    className="h-8 text-right"
                    value={line.quantity}
                    min={0}
                    onValueChange={(v) => {
                      setLines((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, quantity: v } : row)),
                      );
                    }}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <NumericInput
                    className="h-8 text-right"
                    value={line.unitCost}
                    min={0}
                    onValueChange={(v) => {
                      setLines((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, unitCost: v } : row)),
                      );
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <p className="text-sm text-muted-foreground text-right">
          {t.adjustmentHistoryUi.documentTotal}: {totalValue.toLocaleString()}
          {showFreight && freightCost > 0
            ? ` · ${t.stockEntryUi.freightLabel}: ${freightCost.toLocaleString()}`
            : ''}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
