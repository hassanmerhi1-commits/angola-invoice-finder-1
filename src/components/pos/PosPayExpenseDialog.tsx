import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Wallet, Receipt } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { createExpense, payExpense } from '@/lib/accountingStorage';
import type { ExpenseCategory } from '@/types/accounting';
import { toast } from 'sonner';

const POS_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'transport',
  'materials',
  'utilities',
  'maintenance',
  'other',
];

interface PosPayExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId?: string;
  branchName?: string;
  branchCode?: string;
  caixaId?: string;
  caixaName?: string;
  requestedBy: string;
}

export function PosPayExpenseDialog({
  open,
  onOpenChange,
  branchId,
  branchName,
  branchCode,
  caixaId,
  caixaName,
  requestedBy,
}: PosPayExpenseDialogProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<ExpenseCategory>('transport');
  const [payeeName, setPayeeName] = useState('');
  const [payeeNif, setPayeeNif] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory('transport');
    setPayeeName('');
    setPayeeNif('');
    setDescription('');
    setAmount('');
    setSubmitting(false);
  }, [open]);

  const parsedAmount = useMemo(() => {
    const n = Number(String(amount).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }, [amount]);

  const handlePay = async () => {
    if (!branchId || !caixaId) {
      toast.error(t.posUi.payExpenseCaixaRequired);
      return;
    }
    const name = payeeName.trim();
    if (!name) {
      toast.error(t.expensesUi.payeeNameRequired);
      return;
    }
    const nif = payeeNif.trim();
    if (!nif) {
      toast.error(t.expensesUi.payeeNifRequired);
      return;
    }
    const desc = description.trim();
    if (!desc) {
      toast.error(t.expensesUi.descriptionRequired);
      return;
    }
    if (parsedAmount <= 0) {
      toast.error(t.expensesUi.amountMustBeGreaterThanZero);
      return;
    }

    setSubmitting(true);
    try {
      const expense = await createExpense(
        branchId,
        branchName || branchId,
        branchCode || 'POS',
        category,
        desc,
        parsedAmount,
        'caixa',
        requestedBy,
        caixaId,
        undefined,
        name,
        nif,
      );
      const result = await payExpense(expense.id, requestedBy);
      if (result.glError) {
        toast.error(t.expensesUi.paidGlFailedTitle, {
          description: t.expensesUi.expensePaidGlFailed
            .replace('{number}', expense.expenseNumber)
            .replace('{error}', result.glError),
        });
      } else {
        toast.success(
          t.posUi.payExpensePaid.replace('{amount}', parsedAmount.toLocaleString('pt-AO')),
          { description: expense.expenseNumber },
        );
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(t.expensesUi.saveFailed, {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            {t.posUi.payExpenseTitle}
          </DialogTitle>
          <DialogDescription>{t.posUi.payExpenseDesc}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {branchName && <Badge variant="outline">{branchName}</Badge>}
          {caixaName && (
            <Badge variant="outline">
              {t.expensesUi.cashRegister}: {caixaName}
            </Badge>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t.expensesUi.colCategory}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POS_EXPENSE_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {t.expensesUi.categories[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pos-expense-payee">{t.expensesUi.colPayee} *</Label>
              <Input
                id="pos-expense-payee"
                value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
                placeholder={t.expensesUi.payeePlaceholder}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handlePay();
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-expense-nif">{t.expensesUi.payeeNif} *</Label>
              <Input
                id="pos-expense-nif"
                value={payeeNif}
                onChange={(e) => setPayeeNif(e.target.value)}
                placeholder="NIF"
                className="font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handlePay();
                  }
                }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pos-expense-desc">{t.common.description}</Label>
            <Input
              id="pos-expense-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.expensesUi.descriptionPlaceholder}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handlePay();
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pos-expense-amount">{t.expensesUi.amountKz}</Label>
            <Input
              id="pos-expense-amount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="text-right font-mono tabular-nums"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handlePay();
                }
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t.common.cancel}
          </Button>
          <Button type="button" onClick={() => void handlePay()} disabled={submitting} className="gap-1.5">
            <Receipt className="w-4 h-4" />
            {submitting ? t.posUi.payExpensePaying : t.expensesUi.registerAndPay}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
