import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBranchScope } from '@/hooks/useBranchScope';
import { ensureBackendAuthToken, isJwtAuthToken } from '@/lib/api/client';
import { getCachedList, setCachedList } from '@/lib/listCache';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/hooks/useERP';
import { userHasPermission } from '@/lib/permissions';
import { 
  getExpenses, 
  createExpense, 
  saveExpense,
  payExpense, 
  repostExpenseGl,
  getCaixas, 
  getBankAccounts,
  invalidateCaixaListCache,
  invalidateBankListCache,
  createCaixa,
} from '@/lib/accountingStorage';
import { Expense, ExpenseCategory, EXPENSE_CATEGORIES, Caixa, BankAccount } from '@/types/accounting';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { enUS } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AttachmentPanel } from '@/components/documents/AttachmentPanel';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { 
  Plus, 
  MoreHorizontal, 
  Receipt, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Wallet,
  Building,
  Search,
  Filter
} from 'lucide-react';

const STATUS_CONFIG: Record<Expense['status'], { labelKey: 'statusDraft' | 'statusPendingApproval' | 'statusApproved' | 'statusPaid' | 'statusRejected'; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ElementType }> = {
  draft: { labelKey: 'statusDraft', variant: 'secondary', icon: Clock },
  pending_approval: { labelKey: 'statusPendingApproval', variant: 'outline', icon: Clock },
  approved: { labelKey: 'statusApproved', variant: 'default', icon: CheckCircle },
  paid: { labelKey: 'statusPaid', variant: 'default', icon: CheckCircle },
  rejected: { labelKey: 'statusRejected', variant: 'destructive', icon: XCircle },
};

interface ExpenseFormData {
  category: ExpenseCategory;
  description: string;
  amount: number;
  taxAmount: number;
  paymentSource: 'caixa' | 'bank';
  caixaId: string;
  bankAccountId: string;
  payeeName: string;
  payeeNif: string;
  invoiceNumber: string;
  notes: string;
}

const initialFormData: ExpenseFormData = {
  category: 'materials',
  description: '',
  amount: 0,
  taxAmount: 0,
  paymentSource: 'caixa',
  caixaId: '',
  bankAccountId: '',
  payeeName: '',
  payeeNif: '',
  invoiceNumber: '',
  notes: '',
};

export default function Expenses() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;
  const navigate = useNavigate();
  const location = useLocation();
  const { currentBranch, apiBranchId, treasuryAllBranches, userBranch } = useBranchScope();
  const { user } = useAuth();
  const { toast } = useToast();
  const canPayFromBank = !!user && userHasPermission(user.role, user.permissionOverrides, 'bank_manage');
  const canPayStaff = !!user && (
    user.role !== 'cashier'
    || userHasPermission(user.role, user.permissionOverrides, 'expense_approve')
  );
  const canApproveExpense = !!user && userHasPermission(user.role, user.permissionOverrides, 'expense_approve');
  const canCreateCaixa = !!user && (
    userHasPermission(user.role, user.permissionOverrides, 'caixa_open')
    || userHasPermission(user.role, user.permissionOverrides, 'admin_settings')
  );
  const canRepostGl = !!user && userHasPermission(user.role, user.permissionOverrides, 'accounting_create');
  const expenseNeedsApproval = !!user && user.role === 'cashier' && !canApproveExpense;
  const visibleCategories = EXPENSE_CATEGORIES.filter((cat) => canPayStaff || cat.value !== 'staff');

  const [expenses, setExpenses] = useState<Expense[]>(
    () => getCachedList<Expense[]>(`expenses:${apiBranchId ?? 'all'}`) ?? [],
  );
  const [caixas, setCaixas] = useState<Caixa[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [caixaLoadHint, setCaixaLoadHint] = useState<string | null>(null);
  const [caixaLoading, setCaixaLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNewCaixaDialog, setShowNewCaixaDialog] = useState(false);
  const [newCaixaName, setNewCaixaName] = useState('');
  const [isCreatingCaixa, setIsCreatingCaixa] = useState(false);
  const [formData, setFormData] = useState<ExpenseFormData>(initialFormData);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [categoryFilter, setCategoryFilter] = useState<string>('__all__');

  const expenseBranchId = apiBranchId || userBranch?.id || currentBranch?.id || user?.branchId;
  const expenseBranchName = userBranch?.name || currentBranch?.name || t.branchUi.headOffice;

  const refreshBanksForExpense = useCallback(async () => {
    if (!treasuryAllBranches && !expenseBranchId) {
      setBankAccounts([]);
      return;
    }
    // Use 30s treasury cache — do not invalidate on dialog open.
    const loadedBanks = (await getBankAccounts(treasuryAllBranches ? undefined : (apiBranchId || expenseBranchId), {
      allBranches: treasuryAllBranches,
      branchName: expenseBranchName,
    })).filter((a) => a.isActive !== false && a.id);
    setBankAccounts(loadedBanks);
    if (loadedBanks.length > 0) {
      setFormData((fd) => (fd.bankAccountId ? fd : { ...fd, bankAccountId: loadedBanks[0].id }));
    }
  }, [apiBranchId, expenseBranchId, expenseBranchName, treasuryAllBranches]);

  const refreshCaixasForExpense = useCallback(async (ensureIfEmpty = false) => {
    if (!treasuryAllBranches && !expenseBranchId) {
      setCaixaLoadHint(t.expensesUi.caixaNeedsBranch);
      setCaixas([]);
      return;
    }
    setCaixaLoading(true);
    try {
      const loggedIn = isJwtAuthToken(await ensureBackendAuthToken());
      const loadedCaixas = await getCaixas(expenseBranchId, expenseBranchName, {
        ensureIfEmpty: treasuryAllBranches ? false : ensureIfEmpty,
        allBranches: treasuryAllBranches,
      });
      setCaixas(loadedCaixas);
      setCaixaLoadHint(
        loadedCaixas.length > 0
          ? null
          : !loggedIn
            ? t.expensesUi.caixaNeedsLogin
            : treasuryAllBranches
              ? t.expensesUi.caixaEmptyHintAll
              : t.expensesUi.caixaEmptyHint,
      );
      if (loadedCaixas.length > 0) {
        setFormData((fd) => (fd.caixaId ? fd : { ...fd, caixaId: loadedCaixas[0].id }));
      }
    } finally {
      setCaixaLoading(false);
    }
  }, [
    expenseBranchId,
    expenseBranchName,
    treasuryAllBranches,
    t.expensesUi.caixaEmptyHint,
    t.expensesUi.caixaEmptyHintAll,
    t.expensesUi.caixaNeedsBranch,
    t.expensesUi.caixaNeedsLogin,
  ]);

  const loadData = async () => {
    if (!treasuryAllBranches && !expenseBranchId) {
      setCaixaLoadHint(t.expensesUi.caixaNeedsBranch);
      setCaixas([]);
      setBankAccounts([]);
      setExpenses(await getExpenses(apiBranchId));
      return;
    }
    const loggedInPromise = ensureBackendAuthToken().then(isJwtAuthToken);
    const [loadedExpenses, loadedCaixas, loadedBanks] = await Promise.all([
      getExpenses(apiBranchId),
      getCaixas(expenseBranchId, expenseBranchName, {
        ensureIfEmpty: !treasuryAllBranches,
        allBranches: treasuryAllBranches,
      }),
      getBankAccounts(treasuryAllBranches ? undefined : (apiBranchId || expenseBranchId), {
        allBranches: treasuryAllBranches,
        branchName: expenseBranchName,
      }),
    ]);
    const loggedIn = await loggedInPromise;
    setExpenses(loadedExpenses);
    setCachedList(`expenses:${apiBranchId ?? 'all'}`, loadedExpenses);
    setCaixas(loadedCaixas);
    setCaixaLoadHint(
      loadedCaixas.length > 0
        ? null
        : !loggedIn
          ? t.expensesUi.caixaNeedsLogin
          : treasuryAllBranches
            ? t.expensesUi.caixaEmptyHintAll
            : t.expensesUi.caixaEmptyHint,
    );
    setBankAccounts(loadedBanks.filter((a) => a.isActive !== false && a.id));
  };

  useEffect(() => {
    void loadData();
  }, [apiBranchId, expenseBranchId, expenseBranchName, treasuryAllBranches]);

  useEffect(() => {
    const onRefresh = () => { void loadData(); };
    const onBanksChanged = () => { void refreshBanksForExpense(); };
    const onNew = () => handleOpenDialog();
    window.addEventListener('nexor:expenses-changed', onRefresh);
    window.addEventListener('nexor:bank-accounts-changed', onBanksChanged);
    window.addEventListener('nexor:expenses-new', onNew);
    return () => {
      window.removeEventListener('nexor:expenses-changed', onRefresh);
      window.removeEventListener('nexor:bank-accounts-changed', onBanksChanged);
      window.removeEventListener('nexor:expenses-new', onNew);
    };
  }, [apiBranchId, expenseBranchId, expenseBranchName, treasuryAllBranches, t.expensesUi.caixaEmptyHint, t.expensesUi.caixaEmptyHintAll, t.expensesUi.caixaNeedsBranch, t.branchUi.headOffice, refreshBanksForExpense]);

  useEffect(() => {
    const st = location.state as { openExpenseCreate?: boolean } | null;
    if (!st?.openExpenseCreate) return;
    handleOpenDialog();
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(exp => {
      const matchesSearch = exp.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        exp.expenseNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        exp.payeeName?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === '__all__' || exp.status === statusFilter;
      const matchesCategory = categoryFilter === '__all__' || exp.category === categoryFilter;
      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [expenses, searchTerm, statusFilter, categoryFilter]);

  const handleOpenDialog = (expense?: Expense) => {
    if (expense) {
      setEditingId(expense.id);
      setFormData({
        category: expense.category,
        description: expense.description,
        amount: expense.amount,
        taxAmount: expense.taxAmount || 0,
        paymentSource: expense.paymentSource,
        caixaId: expense.caixaId || '',
        bankAccountId: expense.bankAccountId || '',
        payeeName: expense.payeeName || '',
        payeeNif: expense.payeeNif || '',
        invoiceNumber: expense.invoiceNumber || '',
        notes: expense.notes || '',
      });
    } else {
      setEditingId(null);
      setFormData({
        ...initialFormData,
        caixaId: caixas[0]?.id || '',
        bankAccountId: bankAccounts[0]?.id || '',
      });
    }
    setIsDialogOpen(true);
    // Always reload treasury when opening pay/create — avoids stale empty caches.
    void refreshCaixasForExpense(true);
    void refreshBanksForExpense();
  };

  const resetFormForNew = useCallback(() => {
    setEditingId(null);
    setFormData({
      ...initialFormData,
      category: formData.category,
      paymentSource: formData.paymentSource,
      caixaId: caixas[0]?.id || '',
      bankAccountId: bankAccounts[0]?.id || '',
    });
  }, [formData.category, formData.paymentSource, caixas, bankAccounts]);

  type ExpenseSubmitAction = 'save' | 'save_and_new' | 'save_and_pay' | 'save_pay_and_new';

  const validateForm = (): boolean => {
    if (!formData.description.trim()) {
      toast({ title: t.expensesUi.toastErrorTitle, description: t.expensesUi.descriptionRequired, variant: 'destructive' });
      return false;
    }
    if (formData.amount <= 0) {
      toast({ title: t.expensesUi.toastErrorTitle, description: t.expensesUi.amountMustBeGreaterThanZero, variant: 'destructive' });
      return false;
    }
    if (!canPayStaff && formData.category === 'staff') {
      toast({ title: t.expensesUi.toastErrorTitle, description: t.expensesUi.staffNotAllowed, variant: 'destructive' });
      return false;
    }
    if (!canPayFromBank && formData.paymentSource === 'bank') {
      toast({ title: t.expensesUi.toastErrorTitle, description: t.expensesUi.selectCashRegister, variant: 'destructive' });
      return false;
    }
    if (formData.paymentSource === 'caixa' && !formData.caixaId) {
      toast({ title: t.expensesUi.toastErrorTitle, description: t.expensesUi.selectCashRegister, variant: 'destructive' });
      return false;
    }
    if (formData.paymentSource === 'bank' && !formData.bankAccountId) {
      toast({ title: t.expensesUi.toastErrorTitle, description: t.expensesUi.selectBankAccount, variant: 'destructive' });
      return false;
    }
    return true;
  };

  const handleSubmit = async (action: ExpenseSubmitAction) => {
    if (!validateForm()) return;

    const payNow = !expenseNeedsApproval && (action === 'save_and_pay' || action === 'save_pay_and_new');
    const stayOpen = action === 'save_and_new' || action === 'save_pay_and_new';

    setIsSubmitting(true);
    try {
      if (editingId) {
        const existing = expenses.find(e => e.id === editingId);
        if (existing) {
          await saveExpense({
            ...existing,
            ...formData,
            totalAmount: formData.amount + formData.taxAmount,
          });
          toast({ title: t.expensesUi.toastSuccessTitle, description: t.expensesUi.expenseUpdated });
        }
        setIsDialogOpen(false);
      } else {
        // Stamp expense on the treasury source branch when HQ picks another filial's caixa/bank.
        const sourceCaixa = formData.paymentSource === 'caixa'
          ? caixas.find((c) => c.id === formData.caixaId)
          : undefined;
        const sourceBank = formData.paymentSource === 'bank'
          ? bankAccounts.find((a) => a.id === formData.bankAccountId)
          : undefined;
        const stampBranchId = sourceCaixa?.branchId || sourceBank?.branchId
          || expenseBranchId || currentBranch?.id || 'default';
        const stampBranchName = sourceCaixa?.branchName || sourceBank?.branchName
          || expenseBranchName || currentBranch?.name || t.branchUi.headOffice;
        const stampBranchCode = currentBranch?.code || 'SEDE';

        const expense = await createExpense(
          stampBranchId,
          stampBranchName,
          stampBranchCode,
          formData.category,
          formData.description,
          formData.amount,
          formData.paymentSource,
          user?.name || t.expensesUi.systemUser,
          formData.caixaId || undefined,
          formData.bankAccountId || undefined,
          formData.payeeName || undefined,
          formData.payeeNif || undefined,
          formData.taxAmount || undefined,
          formData.invoiceNumber || undefined,
          formData.notes || undefined,
          expenseNeedsApproval ? 'pending_approval' : 'draft',
        );

        if (payNow) {
          const result = await payExpense(expense.id, user?.id || user?.name || t.expensesUi.systemUser);
          if (result.glError) {
            toast({
              title: t.expensesUi.paidGlFailedTitle,
              description: t.expensesUi.expensePaidGlFailed
                .replace('{number}', expense.expenseNumber)
                .replace('{error}', result.glError),
              variant: 'destructive',
            });
          } else {
            toast({
              title: t.expensesUi.paidTitle,
              description: t.expensesUi.expenseRecordedAndPaid.replace('{number}', expense.expenseNumber),
            });
          }
        } else if (expenseNeedsApproval) {
          toast({ title: t.expensesUi.sentTitle, description: t.expensesUi.sentForApproval });
        } else {
          toast({ title: t.expensesUi.toastSuccessTitle, description: t.expensesUi.expenseRecorded });
        }

        if (stayOpen) {
          resetFormForNew();
          void refreshCaixasForExpense(false);
          void refreshBanksForExpense();
        } else {
          setIsDialogOpen(false);
        }
      }
      await loadData();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nexor:expenses-changed'));
      }
    } catch (e) {
      toast({
        title: t.expensesUi.toastErrorTitle,
        description: e instanceof Error ? e.message : t.expensesUi.saveFailed,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateCaixa = async () => {
    const name = newCaixaName.trim();
    if (!name) {
      toast({ title: t.expensesUi.toastErrorTitle, description: t.caixaUi.cashRegisterNameRequired, variant: 'destructive' });
      return;
    }
    if (!expenseBranchId) {
      toast({ title: t.expensesUi.toastErrorTitle, description: t.expensesUi.caixaNeedsBranch, variant: 'destructive' });
      return;
    }
    setIsCreatingCaixa(true);
    try {
      const caixa = await createCaixa(expenseBranchId, expenseBranchName, name);
      await refreshCaixasForExpense(false);
      setFormData((fd) => ({ ...fd, caixaId: caixa.id, paymentSource: 'caixa' }));
      setShowNewCaixaDialog(false);
      setNewCaixaName('');
      toast({ title: t.caixaUi.toastSuccessTitle, description: t.caixaUi.cashRegisterCreated });
    } catch (e) {
      toast({
        title: t.expensesUi.toastErrorTitle,
        description: e instanceof Error ? e.message : t.expensesUi.saveFailed,
        variant: 'destructive',
      });
    } finally {
      setIsCreatingCaixa(false);
    }
  };

  const handleApprove = async (expense: Expense) => {
    try {
      await saveExpense({
        ...expense,
        status: 'approved',
        approvedBy: user?.name || user?.id,
        approvedAt: new Date().toISOString(),
      });
      const result = await payExpense(expense.id, user?.id || user?.name || t.expensesUi.systemUser);
      if (result.glError) {
        toast({
          title: t.expensesUi.paidGlFailedTitle,
          description: t.expensesUi.expensePaidGlFailed
            .replace('{number}', expense.expenseNumber)
            .replace('{error}', result.glError),
          variant: 'destructive',
        });
      } else {
        toast({
          title: t.expensesUi.approvedTitle,
          description: t.expensesUi.expenseApprovedAndPaid.replace('{number}', expense.expenseNumber),
        });
      }
    } catch (e) {
      toast({
        title: t.expensesUi.toastErrorTitle,
        description: e instanceof Error ? e.message : t.expensesUi.saveFailed,
        variant: 'destructive',
      });
    }
    await loadData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexor:expenses-changed'));
    }
  };

  const handleReject = (expense: Expense) => {
    saveExpense({ ...expense, status: 'rejected', approvedBy: user?.name, approvedAt: new Date().toISOString(), rejectionReason: t.expensesUi.rejectedByManagerReason });
    toast({ title: t.expensesUi.rejectedTitle, description: t.expensesUi.expenseRejected.replace('{number}', expense.expenseNumber), variant: 'destructive' });
    loadData();
  };

  const handlePay = async (expense: Expense) => {
    const result = await payExpense(expense.id, user?.id || user?.name || t.expensesUi.systemUser);
    if (result.glError) {
      toast({
        title: t.expensesUi.paidGlFailedTitle,
        description: t.expensesUi.expensePaidGlFailed
          .replace('{number}', expense.expenseNumber)
          .replace('{error}', result.glError),
        variant: 'destructive',
      });
    } else {
      toast({ title: t.expensesUi.paidTitle, description: t.expensesUi.expensePaid.replace('{number}', expense.expenseNumber) });
    }
    await loadData();
  };

  const handleRepostGl = async (expense: Expense) => {
    try {
      const result = await repostExpenseGl(expense.id, user?.id || user?.name || t.expensesUi.systemUser);
      if (result.glError) {
        toast({
          title: t.expensesUi.paidGlFailedTitle,
          description: t.expensesUi.expensePaidGlFailed
            .replace('{number}', expense.expenseNumber)
            .replace('{error}', result.glError),
          variant: 'destructive',
        });
      } else {
        toast({
          title: t.expensesUi.toastSuccessTitle,
          description: t.expensesUi.expenseGlPosted.replace('{number}', expense.expenseNumber),
        });
      }
      await loadData();
    } catch (e) {
      toast({
        title: t.expensesUi.toastErrorTitle,
        description: e instanceof Error ? e.message : t.expensesUi.saveFailed,
        variant: 'destructive',
      });
    }
  };

  const handleSubmitForApproval = (expense: Expense) => {
    saveExpense({ ...expense, status: 'pending_approval' });
    toast({ title: t.expensesUi.sentTitle, description: t.expensesUi.sentForApproval });
    loadData();
  };

  const getCategoryLabel = (cat: ExpenseCategory) => {
    return t.expensesUi.categories[cat] || cat;
  };

  const getCategoryIcon = (cat: ExpenseCategory) => {
    return EXPENSE_CATEGORIES.find(c => c.value === cat)?.icon || '📋';
  };

  // Summary stats
  const stats = useMemo(() => {
    const pending = expenses.filter(e => e.status === 'pending_approval').length;
    const totalPaid = expenses.filter(e => e.status === 'paid').reduce((sum, e) => sum + e.totalAmount, 0);
    const totalPending = expenses.filter(e => ['draft', 'pending_approval', 'approved'].includes(e.status)).reduce((sum, e) => sum + e.totalAmount, 0);
    return { pending, totalPaid, totalPending, total: expenses.length };
  }, [expenses]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t.expensesUi.title}</h1>
          <p className="text-muted-foreground">
            {t.expensesUi.subtitle.replace('{branch}', String(currentBranch?.name || t.expensesUi.allBranches))}
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="gap-2">
          <Plus className="w-4 h-4" />
          {t.expensesUi.newExpense}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">{t.expensesUi.totalExpenses}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
            <div className="text-sm text-muted-foreground">{t.expensesUi.awaitingApproval}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-primary">
              {stats.totalPaid.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} Kz
            </div>
            <div className="text-sm text-muted-foreground">{t.expensesUi.totalPaid}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-600">
              {stats.totalPending.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} Kz
            </div>
            <div className="text-sm text-muted-foreground">{t.expensesUi.pending}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t.expensesUi.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t.common.status} />
              </SelectTrigger>
              <SelectContent>
              <SelectItem value="__all__">{t.expensesUi.allStatuses}</SelectItem>
              <SelectItem value="draft">{t.expensesUi.statusDraft}</SelectItem>
              <SelectItem value="pending_approval">{t.expensesUi.statusPendingShort}</SelectItem>
              <SelectItem value="approved">{t.expensesUi.statusApproved}</SelectItem>
              <SelectItem value="paid">{t.expensesUi.statusPaid}</SelectItem>
              <SelectItem value="rejected">{t.expensesUi.statusRejected}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t.expensesUi.categoryPlaceholder} />
              </SelectTrigger>
              <SelectContent>
              <SelectItem value="__all__">{t.expensesUi.allCategories}</SelectItem>
                {EXPENSE_CATEGORIES.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {t.expensesUi.categories[cat.value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.expensesUi.colExpenseNo}</TableHead>
                <TableHead>{t.expensesUi.colCategory}</TableHead>
                <TableHead>{t.common.description}</TableHead>
                <TableHead>{t.expensesUi.colPayee}</TableHead>
                <TableHead className="text-right">{t.expensesUi.colAmount}</TableHead>
                <TableHead>{t.expensesUi.colPaymentSource}</TableHead>
                <TableHead>{t.common.status}</TableHead>
                <TableHead>{t.common.date}</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredExpenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {t.expensesUi.empty}
                  </TableCell>
                </TableRow>
              ) : (
                filteredExpenses.map(expense => {
                  const statusConfig = STATUS_CONFIG[expense.status];
                  const StatusIcon = statusConfig.icon;
                  return (
                    <TableRow key={expense.id}>
                      <TableCell className="font-mono text-sm">{expense.expenseNumber}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span>{getCategoryIcon(expense.category)}</span>
                          <span className="text-sm">{getCategoryLabel(expense.category)}</span>
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{expense.description}</TableCell>
                      <TableCell>{expense.payeeName || '-'}</TableCell>
                      <TableCell className="text-right font-medium">
                        {expense.totalAmount.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} Kz
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1 text-sm">
                          {expense.paymentSource === 'caixa' ? (
                            <><Wallet className="w-3 h-3" /> {t.expensesUi.cashRegister}</>
                          ) : (
                            <><Building className="w-3 h-3" /> {t.expensesUi.bank}</>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusConfig.variant} className="gap-1">
                          <StatusIcon className="w-3 h-3" />
                          {t.expensesUi[statusConfig.labelKey]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(expense.createdAt), 'dd/MM/yyyy', { locale: dfLocale })}
                      </TableCell>
                      <TableCell>
                        {(
                          expense.status === 'draft'
                          || (expense.status === 'pending_approval' && canApproveExpense)
                          || (expense.status === 'approved' && (canPayFromBank || expense.paymentSource !== 'bank'))
                          || (expense.status === 'paid' && canRepostGl)
                        ) ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-popover border">
                              {expense.status === 'draft' && (
                                <>
                                  {(canPayStaff || expense.category !== 'staff') && (
                                    <DropdownMenuItem onClick={() => handleOpenDialog(expense)}>
                                      {t.common.edit}
                                    </DropdownMenuItem>
                                  )}
                                  {(canApproveExpense || expenseNeedsApproval) && (
                                    <DropdownMenuItem onClick={() => handleSubmitForApproval(expense)}>
                                      {t.expensesUi.sendForApproval}
                                    </DropdownMenuItem>
                                  )}
                                </>
                              )}
                              {expense.status === 'pending_approval' && canApproveExpense && (
                                <>
                                  <DropdownMenuItem onClick={() => void handleApprove(expense)} className="text-green-600">
                                    <CheckCircle className="w-4 h-4 mr-2" />
                                    {t.expensesUi.approve}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleReject(expense)} className="text-destructive">
                                    <XCircle className="w-4 h-4 mr-2" />
                                    {t.expensesUi.reject}
                                  </DropdownMenuItem>
                                </>
                              )}
                              {expense.status === 'approved' && (canPayFromBank || expense.paymentSource !== 'bank') && (
                                <DropdownMenuItem onClick={() => void handlePay(expense)} className="text-green-600">
                                  <Receipt className="w-4 h-4 mr-2" />
                                  {t.expensesUi.markAsPaid}
                                </DropdownMenuItem>
                              )}
                              {expense.status === 'paid' && canRepostGl && (
                                <DropdownMenuItem onClick={() => void handleRepostGl(expense)}>
                                  <Receipt className="w-4 h-4 mr-2" />
                                  {t.expensesUi.repostToLedger}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="flex max-h-[90vh] w-[min(42rem,96vw)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
          <DialogHeader className="shrink-0 space-y-0 border-b px-6 py-4 text-left">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div className="min-w-0 space-y-1">
                <DialogTitle className="flex items-center gap-2 text-xl">
                  <Receipt className="h-5 w-5 text-muted-foreground" />
                  {editingId ? t.expensesUi.editTitle : t.expensesUi.newTitle}
                </DialogTitle>
                <DialogDescription>{t.expensesUi.dialogDescription}</DialogDescription>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t.expensesUi.totalToPay}
                </p>
                <p className="font-mono text-xl font-semibold tabular-nums">
                  {(formData.amount + formData.taxAmount).toLocaleString(uiLocale, { minimumFractionDigits: 2 })} Kz
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-5">
              <div className="space-y-1.5">
                <Label htmlFor="expense-description">{t.common.description} *</Label>
                <Input
                  id="expense-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t.expensesUi.descriptionPlaceholder}
                  className="h-10"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="expense-amount">{t.expensesUi.amountKz} *</Label>
                  <Input
                    id="expense-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.amount || ''}
                    onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="h-10 text-right font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-vat">{t.expensesUi.vatKz}</Label>
                  <Input
                    id="expense-vat"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.taxAmount || ''}
                    onChange={(e) => setFormData({ ...formData, taxAmount: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="h-10 text-right font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t.expensesUi.colCategory} *</Label>
                  <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v as ExpenseCategory })}>
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleCategories.map(cat => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {t.expensesUi.categories[cat.value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t.expensesUi.payFrom} *</Label>
                  <div className={cn('grid rounded-md border bg-muted/50 p-0.5', canPayFromBank ? 'grid-cols-2' : 'grid-cols-1')}>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-9 items-center justify-center gap-1.5 rounded-sm text-sm font-medium transition-colors',
                        formData.paymentSource === 'caixa'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      onClick={() => setFormData({ ...formData, paymentSource: 'caixa' })}
                    >
                      <Wallet className="h-3.5 w-3.5" />
                      {t.expensesUi.cashRegister}
                    </button>
                    {canPayFromBank && (
                      <button
                        type="button"
                        className={cn(
                          'inline-flex h-9 items-center justify-center gap-1.5 rounded-sm text-sm font-medium transition-colors',
                          formData.paymentSource === 'bank'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                        onClick={() => setFormData({ ...formData, paymentSource: 'bank' })}
                      >
                        <Building className="h-3.5 w-3.5" />
                        {t.expensesUi.bank}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {formData.paymentSource === 'caixa' ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label>{t.expensesUi.cashRegister} *</Label>
                    {canCreateCaixa && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setShowNewCaixaDialog(true)}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t.expensesUi.newCaixa}
                      </Button>
                    )}
                  </div>
                  {caixaLoadHint && caixas.length === 0 && !caixaLoading && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">{caixaLoadHint}</p>
                  )}
                  {caixaLoading && (
                    <p className="text-xs text-muted-foreground">{t.expensesUi.caixaLoading}</p>
                  )}
                  <Select
                    value={formData.caixaId}
                    onValueChange={(v) => setFormData({ ...formData, caixaId: v })}
                    disabled={caixaLoading}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder={caixaLoading ? t.expensesUi.caixaLoading : t.expensesUi.selectCashPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {caixaLoading ? (
                        <SelectItem value="__loading__" disabled>
                          {t.expensesUi.caixaLoading}
                        </SelectItem>
                      ) : caixas.length === 0 ? (
                        <SelectItem value="__none__" disabled>
                          {t.expensesUi.noCashRegisters}
                        </SelectItem>
                      ) : (
                        caixas.map(c => {
                          const balance = c.currentBalance.toLocaleString(uiLocale);
                          const branch = String(c.branchName || '').trim();
                          const label = branch && treasuryAllBranches
                            ? t.expensesUi.treasuryCaixaOption
                              .replace('{branch}', branch)
                              .replace('{name}', c.name)
                              .replace('{balance}', balance)
                            : t.expensesUi.cashWithBalance
                              .replace('{name}', c.name)
                              .replace('{balance}', balance);
                          return (
                            <SelectItem key={c.id} value={c.id}>
                              {label}
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>{t.expensesUi.bankAccount} *</Label>
                  {bankAccounts.length === 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">{t.expensesUi.noBanks}</p>
                  )}
                  <Select value={formData.bankAccountId} onValueChange={(v) => setFormData({ ...formData, bankAccountId: v })}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder={t.expensesUi.selectBankPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccounts.length === 0 ? (
                        <SelectItem value="__none__" disabled>{t.expensesUi.noBanks}</SelectItem>
                      ) : (
                        bankAccounts.map(a => {
                          const branch = String(a.branchName || '').trim();
                          const label = branch && treasuryAllBranches
                            ? t.expensesUi.treasuryBankOption
                              .replace('{branch}', branch)
                              .replace('{bank}', a.bankName)
                              .replace('{account}', a.accountNumber)
                            : `${a.bankName} - ${a.accountNumber} (${a.currency})`;
                          return (
                            <SelectItem key={a.id} value={a.id}>
                              {label}
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-1">
                  <Label htmlFor="expense-payee">{t.expensesUi.colPayee}</Label>
                  <Input
                    id="expense-payee"
                    value={formData.payeeName}
                    onChange={(e) => setFormData({ ...formData, payeeName: e.target.value })}
                    placeholder={t.expensesUi.payeePlaceholder}
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-nif">{t.expensesUi.payeeNif}</Label>
                  <Input
                    id="expense-nif"
                    value={formData.payeeNif}
                    onChange={(e) => setFormData({ ...formData, payeeNif: e.target.value })}
                    placeholder="NIF"
                    className="h-10 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-doc">{t.expensesUi.documentRef}</Label>
                  <Input
                    id="expense-doc"
                    value={formData.invoiceNumber}
                    onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                    placeholder={t.expensesUi.documentRefPlaceholder}
                    className="h-10"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expense-notes">{t.common.notes}</Label>
                <Textarea
                  id="expense-notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder={t.expensesUi.notesPlaceholder}
                  rows={2}
                  className="resize-none"
                />
              </div>

              {editingId && (
                <AttachmentPanel
                  entityType="expense"
                  entityId={editingId}
                  title={language === 'pt' ? 'Anexos' : 'Attachments'}
                />
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t px-6 py-4 sm:justify-between">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>
              {t.common.cancel}
            </Button>
            <div className="flex flex-wrap justify-end gap-2">
              {editingId ? (
                <Button onClick={() => void handleSubmit('save')} disabled={isSubmitting}>
                  {t.common.saveChanges}
                </Button>
              ) : (
                <>
                  {!expenseNeedsApproval && (
                    <Button
                      variant="ghost"
                      onClick={() => void handleSubmit('save_and_new')}
                      disabled={isSubmitting}
                    >
                      {t.expensesUi.registerAndNew}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => void handleSubmit('save')}
                    disabled={isSubmitting}
                  >
                    {expenseNeedsApproval ? t.expensesUi.sendForApproval : t.expensesUi.registerExpense}
                  </Button>
                  {!expenseNeedsApproval && (
                    <Button
                      onClick={() => void handleSubmit('save_and_pay')}
                      disabled={isSubmitting}
                      className="gap-1"
                    >
                      <Receipt className="w-4 h-4" />
                      {t.expensesUi.registerAndPay}
                    </Button>
                  )}
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewCaixaDialog} onOpenChange={setShowNewCaixaDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.expensesUi.newCaixaTitle}</DialogTitle>
            <DialogDescription>{t.expensesUi.newCaixaDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>{t.caixaUi.cashRegisterName}</Label>
            <Input
              value={newCaixaName}
              onChange={(e) => setNewCaixaName(e.target.value)}
              placeholder={t.expensesUi.newCaixaPlaceholder}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCaixaDialog(false)} disabled={isCreatingCaixa}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void handleCreateCaixa()} disabled={isCreatingCaixa}>
              {t.expensesUi.createCaixa}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
