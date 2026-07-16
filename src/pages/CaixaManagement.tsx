import React, { useState, useEffect, useMemo } from 'react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/hooks/useERP';
import { 
  getCaixas,
  invalidateCaixaListCache, 
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
  ArrowRightLeft
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

export default function CaixaManagement() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;
  const { currentBranch, apiBranchId, treasuryAllBranches, userBranch } = useBranchScope();
  const { user } = useAuth();
  const { toast } = useToast();

  const [caixas, setCaixas] = useState<Caixa[]>([]);
  const [sessions, setSessions] = useState<CaixaSession[]>([]);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  
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
    if (treasuryAllBranches) invalidateCaixaListCache();
    else if (branchId) invalidateCaixaListCache(branchId, branchName);
    setCaixas(await getCaixas(branchId, branchName, { allBranches: treasuryAllBranches }));
    setSessions(await getCaixaSessions());
    setTransactions(await getCashTransactions());
  };

  useEffect(() => {
    void loadData();
  }, [apiBranchId, treasuryAllBranches, currentBranch?.id]);

  // Get transactions for selected caixa
  const caixaTransactions = useMemo(() => {
    if (!selectedCaixa) return [];
    return transactions
      .filter(t => t.caixaId === selectedCaixa.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [selectedCaixa, transactions]);

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
      description: transactionData.description || `Movimento manual: ${transactionData.type}`,
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
          <h1 className="text-2xl font-bold">Gestão de Caixa</h1>
          <p className="text-muted-foreground">
            Controlo de caixa e sessões diárias - {currentBranch?.name || 'Todas as filiais'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsTransferDialogOpen(true)} className="gap-2">
            <ArrowRightLeft className="w-4 h-4" />
            Transferência
          </Button>
          <Button onClick={() => { setFormData(initialFormData); setIsCreateDialogOpen(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            Nova Caixa
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
                <div className="text-sm text-muted-foreground">Total Caixas</div>
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
                <div className="text-sm text-muted-foreground">Abertas</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">
              {stats.totalBalance.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} Kz
            </div>
            <div className="text-sm text-muted-foreground">Saldo Total</div>
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
                <div className="text-sm text-muted-foreground">Entradas Hoje</div>
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
                <div className="text-sm text-muted-foreground">Saídas Hoje</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Caixas Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {caixas.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center">
              <Wallet className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Nenhuma caixa configurada</h3>
              <p className="text-muted-foreground mb-4">
                Crie uma caixa para começar a gerir os fundos da filial
              </p>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Criar Caixa
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
                      {isOpen ? 'Aberta' : 'Fechada'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Balance */}
                  <div>
                    <p className="text-sm text-muted-foreground">Saldo Actual</p>
                    <p className="text-2xl font-bold">
                      {caixa.currentBalance.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} Kz
                    </p>
                  </div>

                  {/* Limits */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="p-2 bg-muted rounded">
                      <p className="text-xs text-muted-foreground">Limite Transacção</p>
                      <p className="font-medium">{(caixa.pettyLimit || 0).toLocaleString(uiLocale)} Kz</p>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <p className="text-xs text-muted-foreground">Limite Diário</p>
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
                        Por: {todaySession.openedBy}
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
                        Abrir Caixa
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
                          Movimento
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm" 
                          className="flex-1 gap-1"
                          onClick={() => handleCloseSessionDialog(caixa)}
                        >
                          <DoorClosed className="w-4 h-4" />
                          Fechar
                        </Button>
                      </>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => handleViewCaixa(caixa)}>
                      <Eye className="w-4 h-4 mr-1" />
                      Ver
                    </Button>
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => handleOpenEditDialog(caixa)}>
                      <Settings2 className="w-4 h-4 mr-1" />
                      Config
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
            <DialogTitle>Nova Caixa</DialogTitle>
            <DialogDescription>Configure a nova caixa para a filial</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Nome da Caixa *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t.caixaUi.cashRegisterNamePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>Saldo Inicial (Kz)</Label>
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
                <Label>Limite por Transacção (Kz)</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.pettyLimit || ''}
                  onChange={(e) => setFormData({ ...formData, pettyLimit: parseFloat(e.target.value) || 0 })}
                  placeholder="50000"
                />
                <p className="text-xs text-muted-foreground">Valor máximo por operação individual</p>
              </div>
              <div className="space-y-2">
                <Label>Limite Diário (Kz)</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.dailyLimit || ''}
                  onChange={(e) => setFormData({ ...formData, dailyLimit: parseFloat(e.target.value) || 0 })}
                  placeholder="200000"
                />
                <p className="text-xs text-muted-foreground">Total máximo de saídas por dia</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <Label>Requer Aprovação</Label>
                <p className="text-xs text-muted-foreground">Operações acima do limite precisam de aprovação</p>
              </div>
              <Switch
                checked={formData.requiresApproval}
                onCheckedChange={(v) => setFormData({ ...formData, requiresApproval: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateCaixa}>Criar Caixa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Caixa Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar Caixa</DialogTitle>
            <DialogDescription>Ajuste os limites e configurações</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Nome da Caixa</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Limite por Transacção (Kz)</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.pettyLimit || ''}
                  onChange={(e) => setFormData({ ...formData, pettyLimit: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Limite Diário (Kz)</Label>
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
                <Label>Requer Aprovação</Label>
                <p className="text-xs text-muted-foreground">Operações acima do limite precisam de aprovação</p>
              </div>
              <Switch
                checked={formData.requiresApproval}
                onCheckedChange={(v) => setFormData({ ...formData, requiresApproval: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleEditCaixa}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open Session Confirmation */}
      <AlertDialog open={isOpenSessionDialogOpen} onOpenChange={setIsOpenSessionDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abrir Sessão de Caixa</AlertDialogTitle>
            <AlertDialogDescription>
              Vai abrir a caixa "{selectedCaixa?.name}" com um saldo de{' '}
              <strong>{selectedCaixa?.currentBalance.toLocaleString(uiLocale)} Kz</strong>.
              <br /><br />
              Esta acção iniciará o registo de movimentos para hoje.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleOpenSession}>
              <DoorOpen className="w-4 h-4 mr-2" />
              Abrir Caixa
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
              Fechar Sessão de Caixa
            </DialogTitle>
            <DialogDescription>
              Confirme o saldo de fecho para a caixa "{selectedCaixa?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {selectedSession && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Saldo Abertura</p>
                  <p className="font-bold">{selectedSession.openingBalance.toLocaleString(uiLocale)} Kz</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Saldo Esperado</p>
                  <p className="font-bold">
                    {(selectedSession.openingBalance + selectedSession.totalIn - selectedSession.totalOut).toLocaleString(uiLocale)} Kz
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Entradas</p>
                  <p className="font-bold text-primary">+{selectedSession.totalIn.toLocaleString(uiLocale)} Kz</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Saídas</p>
                  <p className="font-bold text-destructive">-{selectedSession.totalOut.toLocaleString(uiLocale)} Kz</p>
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <Label>Saldo de Fecho Contado (Kz) *</Label>
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
                      <span className="font-medium text-primary">Saldo confere</span>
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
              <Label>Notas de Fecho</Label>
              <Textarea
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                placeholder={t.caixaUi.closingNotesPlaceholder}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCloseSessionDialogOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleCloseSession}>
              <DoorClosed className="w-4 h-4 mr-2" />
              Fechar Caixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction Dialog */}
      <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registar Movimento</DialogTitle>
            <DialogDescription>
              Adicione um movimento manual à caixa "{selectedCaixa?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Tipo de Movimento</Label>
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
                      Entrada / Depósito
                    </span>
                  </SelectItem>
                  <SelectItem value="withdrawal">
                    <span className="flex items-center gap-2">
                      <ArrowUpRight className="w-4 h-4 text-destructive" />
                      Saída / Levantamento
                    </span>
                  </SelectItem>
                  <SelectItem value="adjustment">
                    <span className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4" />
                      Ajuste
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Valor (Kz) *</Label>
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
              <Label>Descrição *</Label>
              <Input
                value={transactionData.description}
                onChange={(e) => setTransactionData({ ...transactionData, description: e.target.value })}
                placeholder="Motivo do movimento"
              />
            </div>

            <div className="space-y-2">
              <Label>Beneficiário / Fonte</Label>
              <Input
                value={transactionData.payee}
                onChange={(e) => setTransactionData({ ...transactionData, payee: e.target.value })}
                placeholder="Nome da pessoa ou entidade"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTransactionDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleAddTransaction}>
              Registar Movimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Caixa Details Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              {selectedCaixa?.name}
              <Badge variant={selectedCaixa?.status === 'open' ? 'default' : 'secondary'}>
                {selectedCaixa?.status === 'open' ? 'Aberta' : 'Fechada'}
              </Badge>
            </DialogTitle>
            <DialogDescription>{selectedCaixa?.branchName}</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="transactions">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="transactions">Movimentos</TabsTrigger>
              <TabsTrigger value="sessions">Sessões</TabsTrigger>
            </TabsList>

            <TabsContent value="transactions" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Saldo Actual</p>
                <p className="text-3xl font-bold">
                  {selectedCaixa?.currentBalance.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} Kz
                </p>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {caixaTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        Nenhum movimento registado
                      </TableCell>
                    </TableRow>
                  ) : (
                    caixaTransactions.slice(0, 20).map(tx => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-sm">
                          {format(new Date(tx.createdAt), 'dd/MM HH:mm', { locale: dfLocale })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={tx.direction === 'in' ? 'default' : 'secondary'} className="gap-1">
                            {tx.direction === 'in' ? (
                              <ArrowDownRight className="w-3 h-3" />
                            ) : (
                              <ArrowUpRight className="w-3 h-3" />
                            )}
                            {tx.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">{tx.description}</TableCell>
                        <TableCell className={`text-right font-medium ${tx.direction === 'in' ? 'text-primary' : 'text-destructive'}`}>
                          {tx.direction === 'in' ? '+' : '-'}{tx.amount.toLocaleString(uiLocale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {tx.balanceAfter.toLocaleString(uiLocale)}
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
                    <TableHead>Data</TableHead>
                    <TableHead>Abertura</TableHead>
                    <TableHead>Fecho</TableHead>
                    <TableHead>Entradas</TableHead>
                    <TableHead>Saídas</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.filter(s => s.caixaId === selectedCaixa?.id).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Nenhuma sessão registada
                      </TableCell>
                    </TableRow>
                  ) : (
                    sessions
                      .filter(s => s.caixaId === selectedCaixa?.id)
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .slice(0, 10)
                      .map(session => (
                        <TableRow key={session.id}>
                          <TableCell>{format(new Date(session.date), 'dd/MM/yyyy', { locale: dfLocale })}</TableCell>
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
                              {session.status === 'open' ? 'Aberta' : 'Fechada'}
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
