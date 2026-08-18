import React, { useState, useEffect, useMemo } from 'react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useTranslation } from '@/i18n';
import { useAuth, mapSaleRow } from '@/hooks/useERP';
import { useUsers } from '@/hooks/useUsers';
import { api } from '@/lib/api/client';
import type { Sale } from '@/types/erp';
import { 
  getCaixas,
  createCaixa, 
  saveCaixa,
  getCaixaSessions,
  getOpenCaixaSession,
  openCaixaSession,
  closeCaixaSession,
  getCashTransactions,
  createCashTransaction,
  updateCaixaBalance,
  updateCaixaSessionTotals,
  ensureBranchCaixa,
  postCaixaGlEntry
} from '@/lib/accountingStorage';
import { Caixa, CaixaSession, CashTransaction } from '@/types/accounting';
import { MoneyTransferDialog } from '@/components/accounting/MoneyTransferDialog';
import { format } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
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
import { 
  Plus, 
  Wallet,
  DoorOpen,
  DoorClosed,
  ArrowUpRight,
  ArrowDownRight,
  History,
  Settings2,
  AlertTriangle,
  Check,
  Clock,
  Banknote,
  TrendingUp,
  TrendingDown,
  Edit,
  Eye,
  ArrowRightLeft,
  Users
} from 'lucide-react';

interface CaixaFormData {
  name: string;
  openingBalance: number;
  pettyLimit: number;
  dailyLimit: number;
  requiresApproval: boolean;
}

const initialFormData: CaixaFormData = {
  name: '',
  openingBalance: 0,
  pettyLimit: 50000,
  dailyLimit: 200000,
  requiresApproval: true,
};

interface TransactionFormData {
  type: 'deposit' | 'withdrawal' | 'adjustment';
  amount: number;
  description: string;
  payee: string;
}

const initialTransactionData: TransactionFormData = {
  type: 'deposit',
  amount: 0,
  description: '',
  payee: '',
};

const CAIXA_ALL_USERS = '__all__';

function normalizePerson(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

function personLabel(value?: string, fallback = ''): string {
  const name = String(value || '').trim();
  return name || fallback;
}

export default function CaixaManagement() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;
  const { currentBranch, apiBranchId, treasuryAllBranches, userBranch } = useBranchScope();
  const { user } = useAuth();
  const { users } = useUsers();
  const { toast } = useToast();

  const [caixas, setCaixas] = useState<Caixa[]>([]);
  const [sessions, setSessions] = useState<CaixaSession[]>([]);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [branchSales, setBranchSales] = useState<Sale[]>([]);
  const [movementUserFilter, setMovementUserFilter] = useState(CAIXA_ALL_USERS);
  const [boardCaixaId, setBoardCaixaId] = useState('');
  
  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isOpenSessionDialogOpen, setIsOpenSessionDialogOpen] = useState(false);
  const [isCloseSessionDialogOpen, setIsCloseSessionDialogOpen] = useState(false);
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  
  // Selected items
  const [selectedCaixa, setSelectedCaixa] = useState<Caixa | null>(null);
  const [selectedSession, setSelectedSession] = useState<CaixaSession | null>(null);
  
  // Form data
  const [formData, setFormData] = useState<CaixaFormData>(initialFormData);
  const [transactionData, setTransactionData] = useState<TransactionFormData>(initialTransactionData);
  const [closingBalance, setClosingBalance] = useState<number>(0);
  const [closingNotes, setClosingNotes] = useState<string>('');

  const loadData = async () => {
    const branchId = apiBranchId || userBranch?.id || currentBranch?.id;
    const branchName = userBranch?.name || currentBranch?.name || t.branchUi.headOffice;
    if (!treasuryAllBranches && branchId) {
      await ensureBranchCaixa(branchId, branchName);
    }
    // Honor 30s caixa cache on revisit — invalidate only after mutations.
    setCaixas(await getCaixas(branchId, branchName, { allBranches: treasuryAllBranches }));
    setSessions(await getCaixaSessions());
    setTransactions(await getCashTransactions());
    try {
      const res = await api.sales.list(treasuryAllBranches ? undefined : branchId, {
        light: true,
        limit: 500,
      });
      const rows = Array.isArray(res.data) ? res.data.map((row) => mapSaleRow(row)) : [];
      setBranchSales(rows);
    } catch {
      setBranchSales([]);
    }
  };

  useEffect(() => {
    void loadData();
  }, [apiBranchId, treasuryAllBranches, currentBranch?.id]);

  useEffect(() => {
    if (!caixas.length) return;
    if (!boardCaixaId || !caixas.some((c) => c.id === boardCaixaId)) {
      setBoardCaixaId(caixas[0].id);
    }
  }, [caixas, boardCaixaId]);

  const movementsCaixa = useMemo(
    () => selectedCaixa
      || caixas.find((c) => c.id === boardCaixaId)
      || caixas[0]
      || null,
    [selectedCaixa, caixas, boardCaixaId],
  );

  // Get transactions for selected caixa
  const caixaTransactions = useMemo(() => {
    if (!movementsCaixa) return [];
    return transactions
      .filter(t => t.caixaId === movementsCaixa.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [movementsCaixa, transactions]);

  const caixaSessions = useMemo(() => {
    if (!movementsCaixa) return [];
    return sessions
      .filter((s) => s.caixaId === movementsCaixa.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [movementsCaixa, sessions]);

  const caixaMovements = useMemo(() => {
    if (!movementsCaixa) return [];
    const fallback = t.caixaUi.systemUser;
    const fromTx = caixaTransactions.map((tx) => ({
      id: tx.id,
      createdAt: tx.createdAt,
      type: tx.type,
      typeLabel: tx.type,
      direction: tx.direction as 'in' | 'out',
      description: tx.description,
      amount: tx.amount,
      balanceAfter: tx.balanceAfter,
      userName: personLabel(tx.createdBy, fallback),
    }));
    const fromSales = branchSales
      .filter((sale) => {
        if (String(sale.status || '').toLowerCase() === 'voided') return false;
        if (String(sale.paymentMethod || '').toLowerCase() !== 'cash') return false;
        if (movementsCaixa.branchId && sale.branchId && sale.branchId !== movementsCaixa.branchId) {
          return false;
        }
        return true;
      })
      .map((sale) => ({
        id: `sale-${sale.id}`,
        createdAt: sale.createdAt,
        type: 'sale',
        typeLabel: t.caixaUi.typeSale,
        direction: 'in' as const,
        description: sale.customerName
          ? `${sale.invoiceNumber} — ${sale.customerName}`
          : sale.invoiceNumber,
        amount: Number(sale.total) || 0,
        balanceAfter: undefined as number | undefined,
        userName: personLabel(sale.cashierName || sale.cashierId, fallback),
      }));
    return [...fromTx, ...fromSales].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [movementsCaixa, caixaTransactions, branchSales, t.caixaUi.systemUser, t.caixaUi.typeSale]);

  const movementUserOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of caixaMovements) {
      const label = personLabel(row.userName);
      const key = normalizePerson(label);
      if (!key) continue;
      map.set(key, label);
    }
    for (const session of caixaSessions) {
      const label = personLabel(session.openedBy, t.caixaUi.systemUser);
      const key = normalizePerson(label);
      if (!key) continue;
      map.set(key, label);
    }
    for (const u of users) {
      if (u.isActive === false) continue;
      const label = personLabel(u.name);
      const key = normalizePerson(label);
      if (!key) continue;
      map.set(key, label);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], uiLocale));
  }, [caixaMovements, caixaSessions, users, t.caixaUi.systemUser, uiLocale]);

  const filteredCaixaMovements = useMemo(() => {
    if (movementUserFilter === CAIXA_ALL_USERS) return caixaMovements;
    return caixaMovements.filter((row) => normalizePerson(row.userName) === movementUserFilter);
  }, [caixaMovements, movementUserFilter]);

  const filteredCaixaSessions = useMemo(() => {
    if (movementUserFilter === CAIXA_ALL_USERS) return caixaSessions;
    return caixaSessions.filter(
      (session) => normalizePerson(session.openedBy) === movementUserFilter,
    );
  }, [caixaSessions, movementUserFilter]);

  const filteredMovementTotals = useMemo(() => {
    let inn = 0;
    let out = 0;
    for (const row of filteredCaixaMovements) {
      if (row.direction === 'in') inn += row.amount;
      else out += row.amount;
    }
    return { inn, out };
  }, [filteredCaixaMovements]);

  // Get today's session for a caixa
  const getTodaySession = (caixaId: string): CaixaSession | undefined => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return sessions.find(s => s.caixaId === caixaId && s.date === today);
  };

  // Stats
  const stats = useMemo(() => {
    const totalBalance = caixas.reduce((sum, c) => sum + c.currentBalance, 0);
    const openCaixas = caixas.filter(c => c.status === 'open').length;
    const todayTransactions = transactions.filter(t => {
      const today = format(new Date(), 'yyyy-MM-dd');
      return t.createdAt.startsWith(today);
    });
    const todayIn = todayTransactions.filter(t => t.direction === 'in').reduce((sum, t) => sum + t.amount, 0);
    const todayOut = todayTransactions.filter(t => t.direction === 'out').reduce((sum, t) => sum + t.amount, 0);
    return { totalBalance, openCaixas, todayIn, todayOut, total: caixas.length };
  }, [caixas, transactions]);

  // Create new Caixa
  const handleCreateCaixa = () => {
    if (!formData.name.trim()) {
      toast({ title: t.caixaUi.toastErrorTitle, description: t.caixaUi.cashRegisterNameRequired, variant: 'destructive' });
      return;
    }

    createCaixa(
      currentBranch?.id || 'default',
      currentBranch?.name || t.branchUi.headOffice,
      formData.name,
      formData.openingBalance,
      formData.pettyLimit,
      formData.dailyLimit
    ).then(() => {
      toast({ title: t.caixaUi.toastSuccessTitle, description: t.caixaUi.cashRegisterCreated });
      setIsCreateDialogOpen(false);
      setFormData(initialFormData);
      void loadData();
    });
  };

  // Edit Caixa settings
  const handleEditCaixa = () => {
    if (!selectedCaixa) return;
    
    saveCaixa({
      ...selectedCaixa,
      name: formData.name,
      pettyLimit: formData.pettyLimit,
      dailyLimit: formData.dailyLimit,
      requiresApproval: formData.requiresApproval,
    });

    toast({ title: t.caixaUi.toastSuccessTitle, description: t.caixaUi.settingsUpdated });
    setIsEditDialogOpen(false);
    loadData();
  };

  // Open session
  const handleOpenSession = async () => {
    if (!selectedCaixa) return;
    
    const existingSession = await getOpenCaixaSession(selectedCaixa.id);
    if (existingSession) {
      toast({ title: t.caixaUi.toastWarningTitle, description: t.caixaUi.sessionAlreadyOpen, variant: 'destructive' });
      return;
    }

    await openCaixaSession(
      selectedCaixa.id,
      currentBranch?.id || 'default',
      selectedCaixa.currentBalance,
      user?.name || t.caixaUi.systemUser
    );

    toast({
      title: t.caixaUi.sessionOpenedTitle,
      description: t.caixaUi.sessionOpenedDesc.replace('{name}', selectedCaixa.name),
    });
    setIsOpenSessionDialogOpen(false);
    loadData();
  };

  // Close session
  const handleCloseSession = () => {
    if (!selectedSession) return;
    
    closeCaixaSession(
      selectedSession.id,
      closingBalance,
      user?.name || t.caixaUi.systemUser,
      closingNotes
    );

    // Check for discrepancy
    const expectedBalance = selectedSession.openingBalance + selectedSession.totalIn - selectedSession.totalOut;
    const difference = closingBalance - expectedBalance;
    
    if (Math.abs(difference) > 0) {
      toast({ 
        title: t.caixaUi.sessionClosedWithDiffTitle,
        description: t.caixaUi.discrepancyDetected
          .replace('{amount}', difference.toLocaleString(uiLocale)),
        variant: difference !== 0 ? 'destructive' : 'default'
      });
    } else {
      toast({ title: t.caixaUi.sessionClosedTitle, description: t.caixaUi.cashRegisterClosedSuccess });
    }

    setIsCloseSessionDialogOpen(false);
    setClosingBalance(0);
    setClosingNotes('');
    loadData();
  };

  // Add transaction
  const handleAddTransaction = async () => {
    if (!selectedCaixa) return;
    if (transactionData.amount <= 0) {
      toast({ title: t.caixaUi.toastErrorTitle, description: t.caixaUi.amountMustBeGreaterThanZero, variant: 'destructive' });
      return;
    }

    // Check petty limit
    if (transactionData.type === 'withdrawal' && selectedCaixa.pettyLimit) {
      if (transactionData.amount > selectedCaixa.pettyLimit) {
        toast({ 
          title: t.caixaUi.limitExceededTitle,
          description: t.caixaUi.amountExceedsPettyLimit
            .replace('{limit}', selectedCaixa.pettyLimit.toLocaleString(uiLocale)),
          variant: 'destructive'
        });
        return;
      }
    }

    const branchId = currentBranch?.id || 'default';
    const manualTxn = await createCashTransaction(
      selectedCaixa.id,
      branchId,
      transactionData.type,
      transactionData.amount,
      transactionData.description,
      user?.name || t.caixaUi.systemUser,
      undefined,
      transactionData.payee || undefined,
      'manual',
      undefined,
      undefined,
      undefined
    );

    // Update caixa balance
    updateCaixaBalance(
      selectedCaixa.id, 
      transactionData.amount, 
      transactionData.type === 'withdrawal' ? 'out' : 'in'
    );

    // Reflect the manual movement in the open session so it affects the end-of-day close.
    const openSession = await getOpenCaixaSession(selectedCaixa.id);
    if (openSession) {
      await updateCaixaSessionTotals(openSession.id, transactionData.amount, transactionData.type);
    }

    // GL: mirror the manual movement on the branch cash account. Withdrawals credit the caixa
    // (cash out), deposits/adjustments debit it (cash in); the counterpart is 452 "Valores para
    // depositar". Best-effort so it never blocks the manual entry.
    const glResult = await postCaixaGlEntry({
      branchId,
      amount: transactionData.amount,
      direction: transactionData.type === 'withdrawal' ? 'out' : 'in',
      counterAccountCode: '452',
      description: transactionData.description || `Manual movement: ${transactionData.type}`,
      referenceType: 'manual',
      referenceId: manualTxn.id,
      createdBy: user?.name || t.caixaUi.systemUser,
    });

    if (!glResult.ok) {
      toast({
        title: t.caixaUi.toastSuccessTitle,
        description: `${t.caixaUi.transactionRecorded} — AVISO GL: ${glResult.error}`,
        variant: 'destructive',
      });
    } else {
      toast({ title: t.caixaUi.toastSuccessTitle, description: t.caixaUi.transactionRecorded });
    }
    setIsTransactionDialogOpen(false);
    setTransactionData(initialTransactionData);
    loadData();
  };

  // View caixa details
  const handleViewCaixa = (caixa: Caixa) => {
    setSelectedCaixa(caixa);
    setMovementUserFilter(CAIXA_ALL_USERS);
    setIsViewDialogOpen(true);
  };

  // Open edit dialog
  const handleOpenEditDialog = (caixa: Caixa) => {
    setSelectedCaixa(caixa);
    setFormData({
      name: caixa.name,
      openingBalance: caixa.openingBalance,
      pettyLimit: caixa.pettyLimit || 50000,
      dailyLimit: caixa.dailyLimit || 200000,
      requiresApproval: caixa.requiresApproval || false,
    });
    setIsEditDialogOpen(true);
  };

  // Open session dialog
  const handleOpenSessionDialog = (caixa: Caixa) => {
    setSelectedCaixa(caixa);
    setIsOpenSessionDialogOpen(true);
  };

  // Close session dialog
  const handleCloseSessionDialog = async (caixa: Caixa) => {
    const session = await getOpenCaixaSession(caixa.id);
    if (session) {
      setSelectedCaixa(caixa);
      setSelectedSession(session);
      setClosingBalance(caixa.currentBalance);
      setIsCloseSessionDialogOpen(true);
    }
  };

  // Open transaction dialog
  const handleOpenTransactionDialog = (caixa: Caixa) => {
    if (caixa.status !== 'open') {
      toast({ title: t.caixaUi.toastWarningTitle, description: t.caixaUi.openSessionFirst, variant: 'destructive' });
      return;
    }
    setSelectedCaixa(caixa);
    setTransactionData(initialTransactionData);
    setIsTransactionDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t.caixaUi.title}</h1>
          <p className="text-muted-foreground">
            {t.caixaUi.subtitle.replace('{branch}', currentBranch?.name || t.caixaUi.allBranches)}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">{t.caixaUi.filterUser}</Label>
            <Select value={movementUserFilter} onValueChange={setMovementUserFilter}>
              <SelectTrigger className="h-10 w-[220px]">
                <SelectValue placeholder={t.caixaUi.filterAllUsers} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CAIXA_ALL_USERS}>{t.caixaUi.filterAllUsers}</SelectItem>
                {movementUserOptions.map(([value, label]) => (
                  <SelectItem key={value || label} value={value || label}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => setIsTransferDialogOpen(true)} className="gap-2">
            <ArrowRightLeft className="w-4 h-4" />
            {t.caixaUi.transfer}
          </Button>
          <Button onClick={() => { setFormData(initialFormData); setIsCreateDialogOpen(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            {t.caixaUi.newCashRegister}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-sm text-muted-foreground">{t.caixaUi.totalRegisters}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DoorOpen className="w-5 h-5 text-primary" />
              <div>
                <div className="text-2xl font-bold text-primary">{stats.openCaixas}</div>
                <div className="text-sm text-muted-foreground">{t.caixaUi.openCount}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">
              {stats.totalBalance.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} Kz
            </div>
            <div className="text-sm text-muted-foreground">{t.caixaUi.totalBalance}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <div>
                <div className="text-xl font-bold text-primary">
                  +{stats.todayIn.toLocaleString(uiLocale)} Kz
                </div>
                <div className="text-sm text-muted-foreground">{t.caixaUi.inToday}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-destructive" />
              <div>
                <div className="text-xl font-bold text-destructive">
                  -{stats.todayOut.toLocaleString(uiLocale)} Kz
                </div>
                <div className="text-sm text-muted-foreground">{t.caixaUi.outToday}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                {t.caixaUi.tabMovements}
              </CardTitle>
              <CardDescription>{t.caixaUi.movementsHint}</CardDescription>
            </div>
            {caixas.length > 1 && (
              <div className="space-y-1 min-w-[180px]">
                <Label className="text-xs">{t.caixaUi.title}</Label>
                <Select value={boardCaixaId || caixas[0]?.id} onValueChange={setBoardCaixaId}>
                  <SelectTrigger className="h-9 w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {caixas.map((caixa) => (
                      <SelectItem key={caixa.id} value={caixa.id}>
                        {caixa.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{t.caixaUi.colIn}</p>
              <p className="text-lg font-bold text-primary">
                +{filteredMovementTotals.inn.toLocaleString(uiLocale)} Kz
              </p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{t.caixaUi.colOut}</p>
              <p className="text-lg font-bold text-destructive">
                -{filteredMovementTotals.out.toLocaleString(uiLocale)} Kz
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.caixaUi.colDate}</TableHead>
                <TableHead>{t.caixaUi.colType}</TableHead>
                <TableHead>{t.caixaUi.colDescription}</TableHead>
                <TableHead>{t.caixaUi.colUser}</TableHead>
                <TableHead className="text-right">{t.caixaUi.colAmount}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCaixaMovements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {movementUserFilter === CAIXA_ALL_USERS
                      ? t.caixaUi.noMovements
                      : t.caixaUi.noMovementsForUser}
                  </TableCell>
                </TableRow>
              ) : (
                filteredCaixaMovements.slice(0, 200).map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-sm">
                      {tx.createdAt ? format(new Date(tx.createdAt), 'dd/MM HH:mm', { locale: dfLocale }) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={tx.direction === 'in' ? 'default' : 'secondary'} className="gap-1">
                        {tx.direction === 'in' ? (
                          <ArrowDownRight className="w-3 h-3" />
                        ) : (
                          <ArrowUpRight className="w-3 h-3" />
                        )}
                        {tx.typeLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate">{tx.description}</TableCell>
                    <TableCell className="text-sm">{tx.userName}</TableCell>
                    <TableCell className={`text-right font-medium ${tx.direction === 'in' ? 'text-primary' : 'text-destructive'}`}>
                      {tx.direction === 'in' ? '+' : '-'}{tx.amount.toLocaleString(uiLocale)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Caixas Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {caixas.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center">
              <Wallet className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">{t.caixaUi.noRegistersConfigured}</h3>
              <p className="text-muted-foreground mb-4">
                {t.caixaUi.noRegistersHint}
              </p>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                {t.caixaUi.createCashRegister}
              </Button>
            </CardContent>
          </Card>
        ) : (
          caixas.map(caixa => {
            const isOpen = caixa.status === 'open';
            const todaySession = getTodaySession(caixa.id);
            
            return (
              <Card key={caixa.id} className={`relative overflow-hidden ${isOpen ? 'border-primary' : ''}`}>
                {isOpen && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-primary" />
                )}
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isOpen ? 'bg-primary/20' : 'bg-muted'}`}>
                        <Wallet className={`w-5 h-5 ${isOpen ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <CardTitle className="text-base">{caixa.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {caixa.branchName}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant={isOpen ? 'default' : 'secondary'} className="gap-1">
                      {isOpen ? <DoorOpen className="w-3 h-3" /> : <DoorClosed className="w-3 h-3" />}
                      {isOpen ? t.caixaUi.statusOpen : t.caixaUi.statusClosed}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Balance */}
                  <div>
                    <p className="text-sm text-muted-foreground">{t.caixaUi.currentBalance}</p>
                    <p className="text-2xl font-bold">
                      {caixa.currentBalance.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} Kz
                    </p>
                  </div>

                  {/* Limits */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="p-2 bg-muted rounded">
                      <p className="text-xs text-muted-foreground">{t.caixaUi.transactionLimitLabel}</p>
                      <p className="font-medium">{(caixa.pettyLimit || 0).toLocaleString(uiLocale)} Kz</p>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <p className="text-xs text-muted-foreground">{t.caixaUi.dailyLimitLabel}</p>
                      <p className="font-medium">{(caixa.dailyLimit || 0).toLocaleString(uiLocale)} Kz</p>
                    </div>
                  </div>

                  {/* Session info */}
                  {isOpen && todaySession && (
                    <div className="p-2 bg-primary/5 rounded border border-primary/20">
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-primary" />
                        <span>
                          {t.caixaUi.openedAt.replace('{time}', format(new Date(todaySession.openedAt), 'HH:mm', { locale: dfLocale }))}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t.caixaUi.openedBy.replace('{name}', todaySession.openedBy)}
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    {!isOpen ? (
                      <Button 
                        variant="default" 
                        size="sm" 
                        className="flex-1 gap-1"
                        onClick={() => handleOpenSessionDialog(caixa)}
                      >
                        <DoorOpen className="w-4 h-4" />
                        {t.caixaUi.openCashRegister}
                      </Button>
                    ) : (
                      <>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1 gap-1"
                          onClick={() => handleOpenTransactionDialog(caixa)}
                        >
                          <Banknote className="w-4 h-4" />
                          {t.caixaUi.movement}
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm" 
                          className="flex-1 gap-1"
                          onClick={() => handleCloseSessionDialog(caixa)}
                        >
                          <DoorClosed className="w-4 h-4" />
                          {t.caixaUi.close}
                        </Button>
                      </>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => handleViewCaixa(caixa)}>
                      <Eye className="w-4 h-4 mr-1" />
                      {t.caixaUi.view}
                    </Button>
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => handleOpenEditDialog(caixa)}>
                      <Settings2 className="w-4 h-4 mr-1" />
                      {t.caixaUi.config}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Create Caixa Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.caixaUi.newCashRegisterTitle}</DialogTitle>
            <DialogDescription>{t.caixaUi.newCashRegisterDesc}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>{t.caixaUi.cashRegisterName} *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t.caixaUi.cashRegisterNamePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.caixaUi.openingBalanceLabel}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={formData.openingBalance || ''}
                onChange={(e) => setFormData({ ...formData, openingBalance: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.caixaUi.limitPerTransaction}</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.pettyLimit || ''}
                  onChange={(e) => setFormData({ ...formData, pettyLimit: parseFloat(e.target.value) || 0 })}
                  placeholder="50000"
                />
                <p className="text-xs text-muted-foreground">{t.caixaUi.limitPerTransactionHint}</p>
              </div>
              <div className="space-y-2">
                <Label>{t.caixaUi.dailyLimitField}</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.dailyLimit || ''}
                  onChange={(e) => setFormData({ ...formData, dailyLimit: parseFloat(e.target.value) || 0 })}
                  placeholder="200000"
                />
                <p className="text-xs text-muted-foreground">{t.caixaUi.dailyLimitHint}</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <Label>{t.caixaUi.requiresApproval}</Label>
                <p className="text-xs text-muted-foreground">{t.caixaUi.requiresApprovalHint}</p>
              </div>
              <Switch
                checked={formData.requiresApproval}
                onCheckedChange={(v) => setFormData({ ...formData, requiresApproval: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleCreateCaixa}>{t.caixaUi.createCashRegister}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Caixa Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.caixaUi.configureTitle}</DialogTitle>
            <DialogDescription>{t.caixaUi.configureDesc}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>{t.caixaUi.cashRegisterName}</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.caixaUi.limitPerTransaction}</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.pettyLimit || ''}
                  onChange={(e) => setFormData({ ...formData, pettyLimit: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t.caixaUi.dailyLimitField}</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.dailyLimit || ''}
                  onChange={(e) => setFormData({ ...formData, dailyLimit: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <Label>{t.caixaUi.requiresApproval}</Label>
                <p className="text-xs text-muted-foreground">{t.caixaUi.requiresApprovalHint}</p>
              </div>
              <Switch
                checked={formData.requiresApproval}
                onCheckedChange={(v) => setFormData({ ...formData, requiresApproval: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleEditCaixa}>{t.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open Session Confirmation */}
      <AlertDialog open={isOpenSessionDialogOpen} onOpenChange={setIsOpenSessionDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.caixaUi.openSessionTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.caixaUi.openSessionDesc
                .replace('{name}', selectedCaixa?.name || '')
                .replace('{balance}', selectedCaixa?.currentBalance.toLocaleString(uiLocale) || '0')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleOpenSession}>
              <DoorOpen className="w-4 h-4 mr-2" />
              {t.caixaUi.openCashRegister}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close Session Dialog */}
      <Dialog open={isCloseSessionDialogOpen} onOpenChange={setIsCloseSessionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DoorClosed className="w-5 h-5" />
              {t.caixaUi.closeSessionTitle}
            </DialogTitle>
            <DialogDescription>
              {t.caixaUi.closeSessionDesc.replace('{name}', selectedCaixa?.name || '')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {selectedSession && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">{t.caixaUi.openingBalance}</p>
                  <p className="font-bold">{selectedSession.openingBalance.toLocaleString(uiLocale)} Kz</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.caixaUi.expectedBalance}</p>
                  <p className="font-bold">
                    {(selectedSession.openingBalance + selectedSession.totalIn - selectedSession.totalOut).toLocaleString(uiLocale)} Kz
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.caixaUi.totalIn}</p>
                  <p className="font-bold text-primary">+{selectedSession.totalIn.toLocaleString(uiLocale)} Kz</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.caixaUi.totalOut}</p>
                  <p className="font-bold text-destructive">-{selectedSession.totalOut.toLocaleString(uiLocale)} Kz</p>
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <Label>{t.caixaUi.countedClosingBalance}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={closingBalance || ''}
                onChange={(e) => setClosingBalance(parseFloat(e.target.value) || 0)}
                placeholder={t.caixaUi.countCashPlaceholder}
                className="text-lg"
              />
            </div>

            {selectedSession && closingBalance > 0 && (
              <div className={`p-3 rounded-lg ${
                closingBalance === (selectedSession.openingBalance + selectedSession.totalIn - selectedSession.totalOut)
                  ? 'bg-primary/10 border border-primary/20'
                  : 'bg-destructive/10 border border-destructive/20'
              }`}>
                <div className="flex items-center gap-2">
                  {closingBalance === (selectedSession.openingBalance + selectedSession.totalIn - selectedSession.totalOut) ? (
                    <>
                      <Check className="w-5 h-5 text-primary" />
                      <span className="font-medium text-primary">{t.caixaUi.balanceMatches}</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-5 h-5 text-destructive" />
                      <span className="font-medium text-destructive">
                        {t.caixaUi.differenceAmount
                          .replace('{amount}', (closingBalance - (selectedSession.openingBalance + selectedSession.totalIn - selectedSession.totalOut)).toLocaleString(uiLocale))}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <Label>{t.caixaUi.closingNotes}</Label>
              <Textarea
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                placeholder={t.caixaUi.closingNotesPlaceholder}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCloseSessionDialogOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={handleCloseSession}>
              <DoorClosed className="w-4 h-4 mr-2" />
              {t.caixaUi.closeCashRegister}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction Dialog */}
      <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.caixaUi.recordMovementTitle}</DialogTitle>
            <DialogDescription>
              {t.caixaUi.recordMovementDesc.replace('{name}', selectedCaixa?.name || '')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>{t.caixaUi.movementType}</Label>
              <Select 
                value={transactionData.type} 
                onValueChange={(v) => setTransactionData({ ...transactionData, type: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deposit">
                    <span className="flex items-center gap-2">
                      <ArrowDownRight className="w-4 h-4 text-primary" />
                      {t.caixaUi.typeDeposit}
                    </span>
                  </SelectItem>
                  <SelectItem value="withdrawal">
                    <span className="flex items-center gap-2">
                      <ArrowUpRight className="w-4 h-4 text-destructive" />
                      {t.caixaUi.typeWithdrawal}
                    </span>
                  </SelectItem>
                  <SelectItem value="adjustment">
                    <span className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4" />
                      {t.caixaUi.typeAdjustment}
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t.caixaUi.amountLabel}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={transactionData.amount || ''}
                onChange={(e) => setTransactionData({ ...transactionData, amount: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
              />
              {selectedCaixa?.pettyLimit && transactionData.type === 'withdrawal' && (
                <p className="text-xs text-muted-foreground">
                  {t.caixaUi.transactionLimit
                    .replace('{limit}', selectedCaixa.pettyLimit.toLocaleString(uiLocale))}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t.caixaUi.descriptionRequired}</Label>
              <Input
                value={transactionData.description}
                onChange={(e) => setTransactionData({ ...transactionData, description: e.target.value })}
                placeholder={t.caixaUi.descriptionPlaceholder}
              />
            </div>

            <div className="space-y-2">
              <Label>{t.caixaUi.payeeLabel}</Label>
              <Input
                value={transactionData.payee}
                onChange={(e) => setTransactionData({ ...transactionData, payee: e.target.value })}
                placeholder={t.caixaUi.payeePlaceholder}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTransactionDialogOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleAddTransaction}>
              {t.caixaUi.recordMovement}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Caixa Details Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              {selectedCaixa?.name}
              <Badge variant={selectedCaixa?.status === 'open' ? 'default' : 'secondary'}>
                {selectedCaixa?.status === 'open' ? t.caixaUi.statusOpen : t.caixaUi.statusClosed}
              </Badge>
            </DialogTitle>
            <DialogDescription>{selectedCaixa?.branchName}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-[200px]">
              <Label className="text-xs">{t.caixaUi.filterUser}</Label>
              <Select value={movementUserFilter} onValueChange={setMovementUserFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t.caixaUi.filterAllUsers} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CAIXA_ALL_USERS}>{t.caixaUi.filterAllUsers}</SelectItem>
                  {movementUserOptions.map(([value, label]) => (
                    <SelectItem key={value || label} value={value || label}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Tabs defaultValue="transactions">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="transactions">{t.caixaUi.tabMovements}</TabsTrigger>
              <TabsTrigger value="sessions">{t.caixaUi.tabSessions}</TabsTrigger>
            </TabsList>

            <TabsContent value="transactions" className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.caixaUi.currentBalance}</p>
                  <p className="text-2xl font-bold">
                    {selectedCaixa?.currentBalance.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} Kz
                  </p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.caixaUi.colIn}</p>
                  <p className="text-2xl font-bold text-primary">
                    +{filteredMovementTotals.inn.toLocaleString(uiLocale)} Kz
                  </p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.caixaUi.colOut}</p>
                  <p className="text-2xl font-bold text-destructive">
                    -{filteredMovementTotals.out.toLocaleString(uiLocale)} Kz
                  </p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.caixaUi.colDate}</TableHead>
                    <TableHead>{t.caixaUi.colType}</TableHead>
                    <TableHead>{t.caixaUi.colDescription}</TableHead>
                    <TableHead>{t.caixaUi.colUser}</TableHead>
                    <TableHead className="text-right">{t.caixaUi.colAmount}</TableHead>
                    <TableHead className="text-right">{t.caixaUi.colBalance}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCaixaMovements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {movementUserFilter === CAIXA_ALL_USERS
                          ? t.caixaUi.noMovements
                          : t.caixaUi.noMovementsForUser}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCaixaMovements.slice(0, 200).map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-sm">
                          {tx.createdAt ? format(new Date(tx.createdAt), 'dd/MM HH:mm', { locale: dfLocale }) : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={tx.direction === 'in' ? 'default' : 'secondary'} className="gap-1">
                            {tx.direction === 'in' ? (
                              <ArrowDownRight className="w-3 h-3" />
                            ) : (
                              <ArrowUpRight className="w-3 h-3" />
                            )}
                            {tx.typeLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate">{tx.description}</TableCell>
                        <TableCell className="text-sm">{tx.userName}</TableCell>
                        <TableCell className={`text-right font-medium ${tx.direction === 'in' ? 'text-primary' : 'text-destructive'}`}>
                          {tx.direction === 'in' ? '+' : '-'}{tx.amount.toLocaleString(uiLocale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {tx.balanceAfter != null ? tx.balanceAfter.toLocaleString(uiLocale) : '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="sessions">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.caixaUi.colDate}</TableHead>
                    <TableHead>{t.caixaUi.colUser}</TableHead>
                    <TableHead>{t.caixaUi.colOpening}</TableHead>
                    <TableHead>{t.caixaUi.colClosing}</TableHead>
                    <TableHead>{t.caixaUi.colIn}</TableHead>
                    <TableHead>{t.caixaUi.colOut}</TableHead>
                    <TableHead>{t.caixaUi.colStatus}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCaixaSessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        {t.caixaUi.noSessions}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCaixaSessions.slice(0, 50).map((session) => (
                        <TableRow key={session.id}>
                          <TableCell>{format(new Date(session.date), 'dd/MM/yyyy', { locale: dfLocale })}</TableCell>
                          <TableCell className="text-sm">{personLabel(session.openedBy, t.caixaUi.systemUser)}</TableCell>
                          <TableCell>{session.openingBalance.toLocaleString(uiLocale)} Kz</TableCell>
                          <TableCell>
                            {session.closingBalance !== undefined 
                              ? `${session.closingBalance.toLocaleString(uiLocale)} Kz`
                              : '-'}
                          </TableCell>
                          <TableCell className="text-primary">+{session.totalIn.toLocaleString(uiLocale)}</TableCell>
                          <TableCell className="text-destructive">-{session.totalOut.toLocaleString(uiLocale)}</TableCell>
                          <TableCell>
                            <Badge variant={session.status === 'open' ? 'default' : 'secondary'}>
                              {session.status === 'open' ? t.caixaUi.statusOpen : t.caixaUi.statusClosed}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Money Transfer Dialog */}
      <MoneyTransferDialog
        open={isTransferDialogOpen}
        onOpenChange={setIsTransferDialogOpen}
        onTransferComplete={loadData}
      />
    </div>
  );
}
