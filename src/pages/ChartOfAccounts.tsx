import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { useChartOfAccounts } from '@/hooks/useChartOfAccounts';
import { Account, AccountType, AccountFormData, accountTypeLabels, getDefaultNature } from '@/types/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Plus, Search, Edit2, Trash2, RefreshCw,
  FileText, Receipt, CreditCard, Banknote,
  ChevronRight, ChevronDown, Printer, Download, Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NEXOR_TAB_TRIGGER, NEXOR_TOOLBAR_BTN_SM } from '@/lib/nexorToolbarStyles';
import { NEXOR_TOOLBAR } from '@/lib/nexorToolbarEvents';
import AccountLedgerDialog from '@/components/accounting/AccountLedgerDialog';

// Category tabs
const CATEGORY_TABS = [
  { key: 'clientes', labelKey: 'tabCustomers', filter: (a: Account) => a.code.startsWith('3.1') || a.code.startsWith('31') },
  { key: 'fornecedores', labelKey: 'tabSuppliers', filter: (a: Account) => a.code.startsWith('3.2') || a.code.startsWith('32') },
  { key: 'caixa', labelKey: 'tabCash', filter: (a: Account) => a.code.startsWith('4.1') || a.code.startsWith('41') },
  { key: 'bancos', labelKey: 'tabBanks', filter: (a: Account) => a.code.startsWith('4.2') || a.code.startsWith('42') },
  { key: 'ativos', labelKey: 'tabAssets', filter: (a: Account) => a.account_type === 'asset' },
  { key: 'recebimentos', labelKey: 'tabRevenue', filter: (a: Account) => a.account_type === 'revenue' },
  { key: 'custos', labelKey: 'tabExpenses', filter: (a: Account) => a.account_type === 'expense' },
  { key: 'funcionarios', labelKey: 'tabEmployees', filter: (a: Account) => a.code.startsWith('6.3') || a.code.startsWith('63') || a.code.startsWith('3.4') || a.code.startsWith('34') },
  { key: 'capital', labelKey: 'tabEquity', filter: (a: Account) => a.account_type === 'equity' },
  { key: 'todos', labelKey: 'tabAll', filter: () => true },
] as const;

const ROOT_ACCOUNT_VALUE = '__root__';

const TAB_ACCOUNT_DEFAULTS: Record<string, { accountType: AccountType; preferredParentCodes: string[] }> = {
  clientes: { accountType: 'asset', preferredParentCodes: ['3.1', '3'] },
  fornecedores: { accountType: 'liability', preferredParentCodes: ['3.2', '3'] },
  caixa: { accountType: 'asset', preferredParentCodes: ['4.1', '4'] },
  bancos: { accountType: 'asset', preferredParentCodes: ['4.2', '4'] },
  ativos: { accountType: 'asset', preferredParentCodes: ['1', '2'] },
  recebimentos: { accountType: 'revenue', preferredParentCodes: ['7.1', '7'] },
  custos: { accountType: 'expense', preferredParentCodes: ['6.1', '6'] },
  funcionarios: { accountType: 'expense', preferredParentCodes: ['6.3', '3.4'] },
  capital: { accountType: 'equity', preferredParentCodes: ['5'] },
};

const buildSuggestedChildCode = (parentCode: string, siblingCodes: string[]) => {
  const prefix = `${parentCode}.`;
  const nextIndex = siblingCodes.reduce((max, code) => {
    if (!code.startsWith(prefix)) return max;
    const firstSegment = code.slice(prefix.length).split('.')[0];
    const parsed = Number(firstSegment);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0) + 1;
  return `${parentCode}.${nextIndex}`;
};

export default function ChartOfAccounts() {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { accounts, isLoading, refetch, createAccount, updateAccount, deleteAccount } = useChartOfAccounts();

  const [activeTab, setActiveTab] = useState('todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [ledgerAccount, setLedgerAccount] = useState<Account | null>(null);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);

  useEffect(() => {
    const onAll = () => {
      setSelectedAccountId(null);
      setSearchTerm('');
      setIsDialogOpen(false);
      setEditingAccount(null);
      setIsLedgerOpen(false);
      setLedgerAccount(null);
    };
    window.addEventListener(NEXOR_TOOLBAR.ALL, onAll);
    return () => window.removeEventListener(NEXOR_TOOLBAR.ALL, onAll);
  }, []);

  const openLedger = (account: Account) => {
    setLedgerAccount(account);
    setIsLedgerOpen(true);
  };

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    account_type: 'asset' as AccountType,
    account_nature: 'debit' as 'debit' | 'credit',
    parent_id: '',
    level: 1,
    is_header: false,
    opening_balance: 0
  });

  // Filter accounts by tab + search
  const currentTabConfig = CATEGORY_TABS.find(t => t.key === activeTab) || CATEGORY_TABS[CATEGORY_TABS.length - 1];
  
  const filteredAccounts = useMemo(() => {
    return accounts.filter(a => {
      const matchesTab = currentTabConfig.filter(a);
      const matchesSearch = !searchTerm || 
        a.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.name.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesTab && matchesSearch;
    });
  }, [accounts, activeTab, searchTerm, currentTabConfig]);

  const rootAccounts = filteredAccounts.filter(a => !a.parent_id || !filteredAccounts.find(p => p.id === a.parent_id));

  // Summary totals
  const totals = useMemo(() => {
    return filteredAccounts.reduce((acc, a) => {
      if (!a.is_header) {
        const bal = Number(a.current_balance) || 0;
        if (bal >= 0) acc.debit += bal;
        else acc.credit += Math.abs(bal);
        acc.balance += bal;
      }
      return acc;
    }, { debit: 0, credit: 0, balance: 0 });
  }, [filteredAccounts]);

  const handleToggle = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedIds(new Set(accounts.filter(a => a.is_header).map(a => a.id)));
  const collapseAll = () => setExpandedIds(new Set());

  const openCreateDialog = () => {
    setEditingAccount(null);

    const emptyForm = {
      code: '',
      name: '',
      description: '',
      account_type: 'asset' as AccountType,
      account_nature: 'debit' as 'debit' | 'credit',
      parent_id: '',
      level: 1,
      is_header: false,
      opening_balance: 0,
    };

    let nextForm = { ...emptyForm };

    const applyParentDefaults = (parent: Account) => {
      const children = accounts.filter(a => a.parent_id === parent.id && a.is_active !== false);
      nextForm = {
        ...nextForm,
        parent_id: parent.id,
        level: parent.level + 1,
        code: buildSuggestedChildCode(parent.code, children.map(c => c.code)),
        account_type: parent.account_type,
        account_nature: parent.account_nature,
      };
    };

    const selectedMatchesCurrentTab = selectedAccount ? currentTabConfig.filter(selectedAccount) : false;

    if (selectedAccount && selectedMatchesCurrentTab) {
      applyParentDefaults(selectedAccount);
    } else {
      const tabDefault = TAB_ACCOUNT_DEFAULTS[activeTab];
      if (tabDefault) {
        nextForm = {
          ...nextForm,
          account_type: tabDefault.accountType,
          account_nature: getDefaultNature(tabDefault.accountType),
        };

        const tabParent = tabDefault.preferredParentCodes
          .map(code => accounts.find(a => a.code === code && a.is_active !== false))
          .find(Boolean);

        if (tabParent) {
          applyParentDefaults(tabParent);
        }
      }
    }

    setFormData(nextForm);
    setIsDialogOpen(true);
  };

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setFormData({
      code: account.code,
      name: account.name,
      description: account.description || '',
      account_type: account.account_type,
      account_nature: account.account_nature,
      parent_id: account.parent_id || '',
      level: account.level,
      is_header: account.is_header,
      opening_balance: Number(account.opening_balance) || 0
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (account: Account) => {
    if (!confirm(t.chartOfAccountsUi.deleteConfirm.replace('{name}', account.name))) return;
    try {
      await deleteAccount(account.id);
      toast.success(t.chartOfAccountsUi.deleted);
    } catch (error: any) {
      toast.error(error.message || t.chartOfAccountsUi.deleteError);
    }
  };

  const handleSubmit = async () => {
    if (!formData.code || !formData.name) {
      toast.error(t.chartOfAccountsUi.codeAndNameRequired);
      return;
    }
    setIsSubmitting(true);
    try {
      if (editingAccount) {
        await updateAccount(editingAccount.id, { ...formData, parent_id: formData.parent_id || null });
        toast.success(t.chartOfAccountsUi.updated);
      } else {
        await createAccount({ ...formData, parent_id: formData.parent_id || null });
        toast.success(t.chartOfAccountsUi.created);
      }
      setIsDialogOpen(false);
    } catch (error: any) {
      toast.error(error.message || t.chartOfAccountsUi.saveError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTypeChange = (type: AccountType) => {
    setFormData(prev => ({ ...prev, account_type: type, account_nature: getDefaultNature(type) }));
  };

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const selectedAccountInCurrentTab = selectedAccount && currentTabConfig.filter(selectedAccount) ? selectedAccount : null;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Action Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b flex-wrap">
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} onClick={openCreateDialog}>
          <Plus className="w-3 h-3" /> {t.chartOfAccountsUi.newAccount}
        </Button>
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} disabled={!selectedAccountInCurrentTab} onClick={() => selectedAccountInCurrentTab && openEditDialog(selectedAccountInCurrentTab)}>
          <Edit2 className="w-3 h-3" /> {t.common.edit}
        </Button>
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} disabled={!selectedAccountInCurrentTab || selectedAccountInCurrentTab.is_header}
          onClick={() => selectedAccountInCurrentTab && handleDelete(selectedAccountInCurrentTab)}>
          <Trash2 className="w-3 h-3" /> {t.common.delete}
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        {/* Action buttons */}
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} disabled={!selectedAccount}
          onClick={() => { navigate('/invoices'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('nexor:invoices-new', { detail: { tab: 'fatura_venda' } })), 150); }}>
          <FileText className="w-3 h-3" /> {t.chartOfAccountsUi.salesInvoice}
        </Button>
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} disabled={!selectedAccount}
          onClick={() => { navigate('/invoices'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('nexor:invoices-new-receipt')), 150); }}>
          <Receipt className="w-3 h-3" /> {t.chartOfAccountsUi.receipt}
        </Button>
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} disabled={!selectedAccount}
          onClick={() => navigate('/payments')}>
          <Banknote className="w-3 h-3" /> {t.chartOfAccountsUi.payment}
        </Button>
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} disabled={!selectedAccount}
          onClick={() => navigate('/fiscal-documents')}>
          <CreditCard className="w-3 h-3" /> {t.chartOfAccountsUi.creditNote}
        </Button>
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} disabled={!selectedAccount}
          onClick={() => selectedAccount && openLedger(selectedAccount)}>
          <Eye className="w-3 h-3" /> {t.chartOfAccountsUi.ledger}
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} onClick={expandAll}>{t.chartOfAccountsUi.expand}</Button>
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} onClick={collapseAll}>{t.chartOfAccountsUi.collapse}</Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input placeholder={t.chartOfAccountsUi.searchPlaceholder} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-7 text-xs pl-7 w-48" />
        </div>
      </div>

      {/* Category Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => {
        setActiveTab(value);
        setSelectedAccountId(null);
      }}>
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 h-auto p-0 overflow-x-auto">
          {CATEGORY_TABS.map(tab => (
            <TabsTrigger key={tab.key} value={tab.key}
              className={cn(NEXOR_TAB_TRIGGER, 'px-4 py-1.5')}>
              {t.chartOfAccountsUi[tab.labelKey as keyof typeof t.chartOfAccountsUi] as string}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Data Grid */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-32">{t.chartOfAccountsUi.colAccountNo}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.common.name}</th>
                <th className="px-3 py-2 text-center font-semibold w-16">{t.chartOfAccountsUi.colCurrency}</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.chartOfAccountsUi.colDebit}</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.chartOfAccountsUi.colCredit}</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.chartOfAccountsUi.colBalance}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rootAccounts.map(account => (
                <AccountTreeRow
                  key={account.id}
                  account={account}
                  level={0}
                  expandedIds={expandedIds}
                  onToggle={handleToggle}
                  onSelect={setSelectedAccountId}
                  onDoubleClick={openEditDialog}
                  onViewLedger={openLedger}
                  selectedId={selectedAccountId}
                  allAccounts={filteredAccounts}
                />
              ))}
            </tbody>
            {/* Totals footer */}
            <tfoot className="bg-muted/80 border-t-2 border-primary/30">
              <tr className="font-bold text-xs">
                <td className="px-3 py-2" colSpan={3}>
                  {t.chartOfAccountsUi.totalAccounts
                    .replace('{count}', String(filteredAccounts.filter(a => !a.is_header).length))}
                </td>
                <td className="px-3 py-2 text-right font-mono text-green-600">{totals.debit.toLocaleString(uiLocale)} Kz</td>
                <td className="px-3 py-2 text-right font-mono text-red-600">{totals.credit.toLocaleString(uiLocale)} Kz</td>
                <td className="px-3 py-2 text-right font-mono">{totals.balance.toLocaleString(uiLocale)} Kz</td>
              </tr>
            </tfoot>
          </table>
        )}
        {!isLoading && rootAccounts.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">{t.chartOfAccountsUi.empty}</div>
        )}
      </div>

      {/* Selected account info bar */}
      {selectedAccount && (
        <div className="h-6 bg-primary/10 border-t flex items-center px-3 text-[10px] gap-4">
          <span className="font-bold">{selectedAccount.code} - {selectedAccount.name}</span>
          <span>{t.chartOfAccountsUi.typeLabel}: {accountTypeLabels[selectedAccount.account_type].pt}</span>
          <span>{t.chartOfAccountsUi.balanceLabel}: {Number(selectedAccount.current_balance).toLocaleString(uiLocale)} Kz</span>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingAccount ? t.chartOfAccountsUi.editTitle : t.chartOfAccountsUi.newTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.chartOfAccountsUi.codeLabel}</Label>
                <Input value={formData.code} onChange={e => setFormData(prev => ({ ...prev, code: e.target.value }))} placeholder={t.chartOfAccountsUi.codePlaceholder} />
              </div>
              <div className="space-y-2">
                <Label>{t.chartOfAccountsUi.typeRequiredLabel}</Label>
                <Select value={formData.account_type} onValueChange={v => handleTypeChange(v as AccountType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">{t.chartOfAccountsUi.typeAsset}</SelectItem>
                    <SelectItem value="liability">{t.chartOfAccountsUi.typeLiability}</SelectItem>
                    <SelectItem value="equity">{t.chartOfAccountsUi.typeEquity}</SelectItem>
                    <SelectItem value="revenue">{t.chartOfAccountsUi.typeRevenue}</SelectItem>
                    <SelectItem value="expense">{t.chartOfAccountsUi.typeExpense}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t.chartOfAccountsUi.nameLabel}</Label>
              <Input value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder={t.chartOfAccountsUi.namePlaceholder} />
            </div>
            <div className="space-y-2">
              <Label>{t.common.description}</Label>
              <Textarea value={formData.description} onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>{t.chartOfAccountsUi.parentAccountLabel}</Label>
              <Select value={formData.parent_id || ROOT_ACCOUNT_VALUE} onValueChange={v => {
                const parentId = v === ROOT_ACCOUNT_VALUE ? '' : v;
                const parent = accounts.find(a => a.id === parentId);
                setFormData(prev => ({
                  ...prev,
                  parent_id: parentId,
                  level: parent ? parent.level + 1 : 1,
                  account_type: parent ? parent.account_type : prev.account_type,
                  account_nature: parent ? parent.account_nature : prev.account_nature,
                }));
              }}>
                <SelectTrigger><SelectValue placeholder={t.chartOfAccountsUi.rootPlaceholder} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_ACCOUNT_VALUE}>{t.chartOfAccountsUi.rootOption}</SelectItem>
                  {accounts
                    .filter(a => a.is_active !== false && (!editingAccount || a.id !== editingAccount.id))
                    .sort((a, b) => a.code.localeCompare(b.code))
                    .map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="font-mono text-muted-foreground mr-2">{a.code}</span>
                        {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.chartOfAccountsUi.openingBalanceLabel}</Label>
                <Input type="number" value={formData.opening_balance} onChange={e => setFormData(prev => ({ ...prev, opening_balance: Number(e.target.value) }))} />
              </div>
              <div className="flex items-center gap-2 pt-8">
                <Checkbox id="is_header" checked={formData.is_header} onCheckedChange={checked => setFormData(prev => ({ ...prev, is_header: !!checked }))} />
                <Label htmlFor="is_header" className="text-sm">{t.chartOfAccountsUi.headerAccountLabel}</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>{isSubmitting ? t.common.saving : t.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Account Ledger Dialog */}
      <AccountLedgerDialog account={ledgerAccount} open={isLedgerOpen} onOpenChange={setIsLedgerOpen} />
    </div>
  );
}

// Tree row component
interface AccountTreeRowProps {
  account: Account;
  level: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onDoubleClick: (account: Account) => void;
  onViewLedger: (account: Account) => void;
  selectedId: string | null;
  allAccounts: Account[];
}

function AccountTreeRow({ account, level, expandedIds, onToggle, onSelect, onDoubleClick, onViewLedger, selectedId, allAccounts }: AccountTreeRowProps) {
  const { language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const isExpanded = expandedIds.has(account.id);
  const children = allAccounts.filter(a => a.parent_id === account.id);
  const hasChildren = children.length > 0;
  const isSelected = selectedId === account.id;
  
  const computeBalance = (acc: Account): number => {
    const kids = allAccounts.filter(a => a.parent_id === acc.id);
    if (kids.length === 0) return Number(acc.current_balance) || 0;
    return kids.reduce((sum, kid) => sum + computeBalance(kid), 0);
  };
  
  const balance = hasChildren || account.is_header ? computeBalance(account) : (Number(account.current_balance) || 0);

  return (
    <>
      <tr
        className={cn(
          "cursor-pointer transition-colors hover:bg-accent/50",
          isSelected && "nexor-row-selected",
          account.is_header && "bg-muted/40 font-semibold"
        )}
        onClick={() => onSelect(account.id)}
        onDoubleClick={() => onViewLedger(account)}
      >
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-1" style={{ paddingLeft: `${level * 16}px` }}>
            {hasChildren ? (
              <button onClick={e => { e.stopPropagation(); onToggle(account.id); }} className="p-0.5 hover:bg-muted rounded">
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
            ) : <span className="w-4" />}
            <span className="font-mono text-muted-foreground">{account.code}</span>
          </div>
        </td>
        <td className="px-3 py-1.5">{account.name}</td>
        <td className="px-3 py-1.5 text-center text-muted-foreground">AOA</td>
        <td className="px-3 py-1.5 text-right font-mono">
          {balance >= 0 ? `${balance.toLocaleString(uiLocale)}` : ''}
        </td>
        <td className="px-3 py-1.5 text-right font-mono">
          {balance < 0 ? `${Math.abs(balance).toLocaleString(uiLocale)}` : ''}
        </td>
        <td className={cn("px-3 py-1.5 text-right font-mono font-medium", balance >= 0 ? "text-foreground" : "text-destructive")}>
          {`${balance.toLocaleString(uiLocale)}`}
        </td>
      </tr>
      {isExpanded && children.map(child => (
        <AccountTreeRow
          key={child.id}
          account={child}
          level={level + 1}
          expandedIds={expandedIds}
          onToggle={onToggle}
          onSelect={onSelect}
          onDoubleClick={onDoubleClick}
          onViewLedger={onViewLedger}
          selectedId={selectedId}
          allAccounts={allAccounts}
        />
      ))}
    </>
  );
}
