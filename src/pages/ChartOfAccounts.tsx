import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation, type TranslationKeys } from '@/i18n';
import { useChartOfAccounts } from '@/hooks/useChartOfAccounts';
import { markCachedListStale } from '@/lib/listCache';
import { Account, AccountType, AccountFormData, getDefaultNature } from '@/types/accounting';
import { resolveAccountDisplayName, resolveAccountTypeLabel } from '@/lib/chartOfAccountsDisplay';
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
import { api } from '@/lib/api/client';
import {
  Search, Edit2, Trash2, RefreshCw,
  FileText, Receipt, CreditCard, Banknote,
  ChevronRight, ChevronDown, Printer, Download, Eye, RotateCcw, Plus
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NEXOR_TAB_TRIGGER, NEXOR_TOOLBAR_BTN_SM } from '@/lib/nexorToolbarStyles';
import { NEXOR_TOOLBAR } from '@/lib/nexorToolbarEvents';
import AccountLedgerDialog from '@/components/accounting/AccountLedgerDialog';
import { ChartOfAccountsNewMenu } from '@/components/accounting/ChartOfAccountsNewMenu';
import { ClientFormDialog } from '@/components/clients/ClientFormDialog';
import { SupplierFormDialog } from '@/components/suppliers/SupplierFormDialog';
import { chartNewActionTab, type ChartNewAction } from '@/lib/chartOfAccountsNewActions';

// Category tabs
// Angola PGC (novo com IVA) — no-dot numbering. Tabs map to PGC class/main codes:
// 31 Clientes, 32 Fornecedores, 45 Caixa, 42/43/44 Depósitos, 36/72 Pessoal,
// class 6 Proveitos (revenue), class 7 Custos (expense), class 5 Capital.
const CATEGORY_TABS = [
  { key: 'clientes', labelKey: 'tabCustomers', filter: (a: Account) => a.code.startsWith('31') },
  { key: 'fornecedores', labelKey: 'tabSuppliers', filter: (a: Account) => a.code.startsWith('32') },
  { key: 'caixa', labelKey: 'tabCash', filter: (a: Account) => a.code.startsWith('45') },
  { key: 'bancos', labelKey: 'tabBanks', filter: (a: Account) => a.code.startsWith('42') || a.code.startsWith('43') || a.code.startsWith('44') },
  { key: 'ativos', labelKey: 'tabAssets', filter: (a: Account) => a.account_type === 'asset' },
  { key: 'recebimentos', labelKey: 'tabRevenue', filter: (a: Account) => a.account_type === 'revenue' },
  { key: 'custos', labelKey: 'tabExpenses', filter: (a: Account) => a.account_type === 'expense' },
  { key: 'funcionarios', labelKey: 'tabEmployees', filter: (a: Account) => a.code.startsWith('36') || a.code.startsWith('72') },
  { key: 'capital', labelKey: 'tabEquity', filter: (a: Account) => a.account_type === 'equity' },
  { key: 'todos', labelKey: 'tabAll', filter: () => true },
] as const;

const ROOT_ACCOUNT_VALUE = '__root__';

const TAB_ACCOUNT_DEFAULTS: Record<string, { accountType: AccountType; preferredParentCodes: string[] }> = {
  clientes: { accountType: 'asset', preferredParentCodes: ['311', '31'] },
  fornecedores: { accountType: 'liability', preferredParentCodes: ['321', '32'] },
  caixa: { accountType: 'asset', preferredParentCodes: ['45'] },
  bancos: { accountType: 'asset', preferredParentCodes: ['43', '42', '44'] },
  ativos: { accountType: 'asset', preferredParentCodes: ['11', '21', '26'] },
  recebimentos: { accountType: 'revenue', preferredParentCodes: ['61', '62'] },
  custos: { accountType: 'expense', preferredParentCodes: ['71', '75'] },
  funcionarios: { accountType: 'expense', preferredParentCodes: ['72', '36'] },
  capital: { accountType: 'equity', preferredParentCodes: ['51', '55'] },
};

// Customer (31x) and supplier (32x) ledger registries use fixed 8-digit codes for the
// actual customer/supplier entries (e.g. a supplier under 321 becomes 32100001; under a
// deeper sub like 3211 it becomes 32110001). Intermediate grouping sub-accounts (headers)
// keep compact codes (321 -> 3211 -> 32111) so you can nest sub under sub.
const ENTITY_ACCOUNT_CODE_LENGTH = 8;
const isEntityRegistryParent = (code: string) =>
  /^3[12]/.test(code) && code.length >= 3 && code.length < ENTITY_ACCOUNT_CODE_LENGTH;

// No-dot child codes: a child of "31" becomes "311", "312", … (next free numeric suffix).
// Leaf entries under an entity registry are zero-padded to an 8-digit code; headers stay compact.
const buildSuggestedChildCode = (parentCode: string, siblingCodes: string[], isHeader = false) => {
  const entityParent = isEntityRegistryParent(parentCode);
  const nextIndex = siblingCodes.reduce((max, code) => {
    if (!code.startsWith(parentCode) || code.length <= parentCode.length) return max;
    // Under a customer/supplier registry parent, header sub-accounts (compact, e.g. 3211) and
    // leaf entity accounts (8-digit, e.g. 32100001) are numbered independently — so only count
    // the siblings of the same kind we're creating.
    if (entityParent) {
      const isLeaf = code.length === ENTITY_ACCOUNT_CODE_LENGTH;
      if (isHeader ? isLeaf : !isLeaf) return max;
    }
    const segment = code.slice(parentCode.length);
    const parsed = Number(segment);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0) + 1;
  if (!isHeader && entityParent) {
    return `${parentCode}${String(nextIndex).padStart(ENTITY_ACCOUNT_CODE_LENGTH - parentCode.length, '0')}`;
  }
  return `${parentCode}${nextIndex}`;
};

// Next free top-level (root / no-parent) account code. Increments by 1 from the highest
// existing root code so each new parent account gets a unique, sequential number.
const buildSuggestedRootCode = (rootCodes: string[]) => {
  const maxCode = rootCodes.reduce((max, code) => {
    const parsed = Number(code);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return String(maxCode + 1);
};

export default function ChartOfAccounts() {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { accounts, isLoading, refetch, createAccount, updateAccount, deleteAccount } = useChartOfAccounts();

  // Bust cache, force server remapping of parent 321→leaves, then reload balances.
  useEffect(() => {
    let cancelled = false;
    try {
      localStorage.removeItem('kwanzaerp_chart_of_accounts');
      localStorage.removeItem('kwanzaerp_chart_of_accounts_v2');
      localStorage.removeItem('kwanzaerp_chart_of_accounts_v3');
    } catch { /* ignore */ }
    markCachedListStale('chartOfAccounts');

    const run = async () => {
      try {
        await api.chartOfAccounts.recomputeBalances();
      } catch (e) {
        console.warn('[CoA] recompute/repair on open failed:', e);
      }
      if (cancelled) return;
      await refetch({ force: true, liveBalances: true });
    };
    void run();

    const t1 = window.setTimeout(() => {
      if (cancelled) return;
      markCachedListStale('chartOfAccounts');
      void refetch({ force: true, liveBalances: true });
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
    };
  }, [refetch]);

  const [activeTab, setActiveTab] = useState('todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  // Always-current handlers for the global TopNav toolbar Delete/Edit buttons (avoids stale closures).
  const deleteSelectedRef = useRef<() => void>(() => {});
  const editSelectedRef = useRef<() => void>(() => {});
  const [ledgerAccount, setLedgerAccount] = useState<Account | null>(null);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false);
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  // Inline "+" quick-create of a parent/sub header account from inside the account dialog.
  const [isAddingInlineParent, setIsAddingInlineParent] = useState(false);
  const [inlineParentCode, setInlineParentCode] = useState('');
  const [inlineParentName, setInlineParentName] = useState('');
  const [creatingInlineParent, setCreatingInlineParent] = useState(false);

  const openNewClientDialog = () => {
    setActiveTab('clientes');
    setIsClientDialogOpen(true);
  };

  const openNewSupplierDialog = () => {
    setActiveTab('fornecedores');
    setIsSupplierDialogOpen(true);
  };

  useEffect(() => {
    const onAll = () => {
      setSelectedAccountId(null);
      setSearchTerm('');
      setIsDialogOpen(false);
      setEditingAccount(null);
      setIsLedgerOpen(false);
      setLedgerAccount(null);
      setIsClientDialogOpen(false);
      setIsSupplierDialogOpen(false);
    };
    window.addEventListener(NEXOR_TOOLBAR.ALL, onAll);
    return () => window.removeEventListener(NEXOR_TOOLBAR.ALL, onAll);
  }, []);

  // Wire the global TopNav toolbar Delete/Edit buttons to the selected account.
  useEffect(() => {
    const onDelete = () => deleteSelectedRef.current?.();
    const onEdit = () => editSelectedRef.current?.();
    window.addEventListener(NEXOR_TOOLBAR.DELETE, onDelete);
    window.addEventListener(NEXOR_TOOLBAR.EDIT, onEdit);
    return () => {
      window.removeEventListener(NEXOR_TOOLBAR.DELETE, onDelete);
      window.removeEventListener(NEXOR_TOOLBAR.EDIT, onEdit);
    };
  }, []);

  const openLedger = (account: Account) => {
    setLedgerAccount(account);
    setIsLedgerOpen(true);
  };

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    nif: '',
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
      const displayName = resolveAccountDisplayName(a, language, t);
      const q = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm ||
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        displayName.toLowerCase().includes(q);
      return matchesTab && matchesSearch;
    });
  }, [accounts, activeTab, searchTerm, currentTabConfig, language, t]);

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

  const openCreateDialog = (tabOverride?: string) => {
    const tabKey = tabOverride ?? activeTab;
    if (tabOverride) {
      setActiveTab(tabOverride);
    }
    setEditingAccount(null);
    setIsAddingInlineParent(false);
    setInlineParentName('');
    setInlineParentCode('');

    const emptyForm = {
      code: '',
      name: '',
      description: '',
      nif: '',
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
        code: buildSuggestedChildCode(parent.code, children.map(c => c.code), nextForm.is_header),
        account_type: parent.account_type,
        account_nature: parent.account_nature,
      };
    };

    const tabConfig = CATEGORY_TABS.find((tab) => tab.key === tabKey) || CATEGORY_TABS[CATEGORY_TABS.length - 1];
    const selectedMatchesCurrentTab = selectedAccount ? tabConfig.filter(selectedAccount) : false;

    if (selectedAccount && selectedMatchesCurrentTab) {
      applyParentDefaults(selectedAccount);
    } else {
      const tabDefault = TAB_ACCOUNT_DEFAULTS[tabKey];
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

    // Customer/supplier tabs always create an entity ledger account, which needs a NIF.
    // Make sure we land on the entity-registry parent (e.g. 321/311) so the NIF field shows
    // immediately on open — falling back from a group like 32 to 321 when needed.
    const tabDefaultForEntity = TAB_ACCOUNT_DEFAULTS[tabKey];
    const wantsEntityRegistry = !!tabDefaultForEntity && isEntityRegistryParent(tabDefaultForEntity.preferredParentCodes[0]);
    if (!nextForm.is_header && wantsEntityRegistry) {
      const resolvedParent = accounts.find(a => a.id === nextForm.parent_id);
      if (!resolvedParent || !isEntityRegistryParent(resolvedParent.code)) {
        const entityParent = tabDefaultForEntity.preferredParentCodes
          .map(code => accounts.find(a => a.code === code && a.is_active !== false))
          .find(p => p && isEntityRegistryParent(p.code));
        if (entityParent) applyParentDefaults(entityParent);
      }
    }

    // No parent resolved → this is a new top-level (parent) account. Auto-fill the next
    // sequential root code so the user can create it without a manual code collision.
    if (!nextForm.parent_id && !nextForm.code) {
      const rootCodes = accounts.filter(a => !a.parent_id).map(a => a.code);
      nextForm = { ...nextForm, level: 1, code: buildSuggestedRootCode(rootCodes) };
    }

    setFormData(nextForm);
    setIsDialogOpen(true);
  };

  // Open the dialog to create a brand-new top-level (parent) account: no parent, level 1,
  // header by default, with the next sequential root code auto-filled.
  const openCreateParentDialog = () => {
    setSelectedAccountId(null);
    setEditingAccount(null);
    setIsAddingInlineParent(false);
    setInlineParentName('');
    setInlineParentCode('');
    const rootCodes = accounts.filter(a => !a.parent_id).map(a => a.code);
    setFormData({
      code: buildSuggestedRootCode(rootCodes),
      name: '',
      description: '',
      nif: '',
      account_type: 'asset',
      account_nature: 'debit',
      parent_id: '',
      level: 1,
      is_header: true,
      opening_balance: 0,
    });
    setIsDialogOpen(true);
  };

  useEffect(() => {
    const onChartNew = (event: Event) => {
      const action = (event as CustomEvent<{ action?: ChartNewAction }>).detail?.action;
      if (!action) return;
      // Both "New client" and "New customer account" use the same client interface,
      // which captures contact details, pricing, and payment terms while also creating
      // the client's chart-of-accounts ledger entry.
      if (action === 'client' || action === 'account:clientes') {
        openNewClientDialog();
        return;
      }
      // Both "New supplier" and "New supplier account" use the same supplier interface,
      // which captures email/phone/address and saves the supplier to the supplier list
      // (while also creating its chart-of-accounts ledger entry).
      if (action === 'supplier' || action === 'account:fornecedores') {
        openNewSupplierDialog();
        return;
      }
      if (action === 'account:parent') {
        openCreateParentDialog();
        return;
      }
      const tab = chartNewActionTab(action);
      if (tab) {
        openCreateDialog(tab);
      }
    };
    window.addEventListener(NEXOR_TOOLBAR.CHART_NEW, onChartNew);
    return () => window.removeEventListener(NEXOR_TOOLBAR.CHART_NEW, onChartNew);
  });

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setIsAddingInlineParent(false);
    setInlineParentName('');
    setInlineParentCode('');
    const nifMatch = (account.description || '').match(/NIF:\s*([^\s]+)/i);
    setFormData({
      code: account.code,
      name: account.name,
      description: account.description || '',
      nif: nifMatch ? nifMatch[1] : '',
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
    if (!confirm(t.chartOfAccountsUi.deleteConfirm.replace('{name}', resolveAccountDisplayName(account, language, t)))) return;
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

    // Customer (31x) / supplier (32x) ledger accounts must carry a NIF (stored in description).
    const submitParent = accounts.find(a => a.id === formData.parent_id);
    const isEntityRegistry = !formData.is_header && !!submitParent && isEntityRegistryParent(submitParent.code);
    if (isEntityRegistry && !formData.nif.trim()) {
      toast.error(t.clientsUi.nifRequired);
      return;
    }

    const { nif, ...rest } = formData;
    const description = isEntityRegistry
      ? `NIF: ${nif.trim()}${rest.description && !/NIF:/i.test(rest.description) ? ` — ${rest.description}` : ''}`
      : rest.description;
    const payload = { ...rest, description, parent_id: formData.parent_id || null };

    setIsSubmitting(true);
    try {
      if (editingAccount) {
        await updateAccount(editingAccount.id, payload);
        toast.success(t.chartOfAccountsUi.updated);
      } else {
        await createAccount(payload);
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

  // Suggested code for a new header created inline under the currently selected parent.
  const inlineParentSuggestedCode = (() => {
    const parent = accounts.find(a => a.id === formData.parent_id);
    if (!parent) return buildSuggestedRootCode(accounts.filter(a => !a.parent_id).map(a => a.code));
    const children = accounts.filter(a => a.parent_id === parent.id && a.is_active !== false);
    return buildSuggestedChildCode(parent.code, children.map(c => c.code), true);
  })();

  // Open the inline "+" form pre-filled with the suggested compact header code (editable).
  const startInlineParent = () => {
    setInlineParentCode(inlineParentSuggestedCode);
    setInlineParentName('');
    setIsAddingInlineParent(true);
  };

  // Inline "+" : create a new header (sub/parent) account under the currently selected parent
  // using the code + name the user entered, then auto-select it as the parent of the account
  // being created (whose leaf code becomes 8-digit, e.g. 3211 -> 32110001).
  const handleCreateInlineParent = async () => {
    const name = inlineParentName.trim();
    const code = inlineParentCode.trim();
    if (!name || !code) return;
    if (accounts.some(a => a.code === code && a.is_active !== false)) {
      toast.error(`${code} — ${t.chartOfAccountsUi.saveError}`);
      return;
    }
    const parent = accounts.find(a => a.id === formData.parent_id) || null;
    setCreatingInlineParent(true);
    try {
      const created = await createAccount({
        code,
        name,
        account_type: parent ? parent.account_type : formData.account_type,
        account_nature: parent ? parent.account_nature : formData.account_nature,
        parent_id: parent ? parent.id : null,
        level: parent ? parent.level + 1 : 1,
        is_header: true,
        opening_balance: 0,
      });
      setFormData(prev => ({
        ...prev,
        parent_id: created.id,
        level: (created.level ?? 1) + 1,
        code: buildSuggestedChildCode(created.code, [], prev.is_header),
        account_type: created.account_type,
        account_nature: created.account_nature,
      }));
      setInlineParentName('');
      setInlineParentCode('');
      setIsAddingInlineParent(false);
      toast.success(`${code} — ${name}`);
    } catch (error: any) {
      toast.error(error?.message || t.chartOfAccountsUi.saveError);
    } finally {
      setCreatingInlineParent(false);
    }
  };

  const [isReseeding, setIsReseeding] = useState(false);
  const handleResetToPgc = async () => {
    if (!window.confirm(t.chartOfAccountsUi.resetPgcConfirm)) return;
    setIsReseeding(true);
    try {
      const response = await api.chartOfAccounts.reseed();
      if (response.error) throw new Error(response.error);
      await refetch();
      toast.success(t.chartOfAccountsUi.resetPgcSuccess);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.chartOfAccountsUi.resetPgcError);
    } finally {
      setIsReseeding(false);
    }
  };

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const selectedAccountInCurrentTab = selectedAccount && currentTabConfig.filter(selectedAccount) ? selectedAccount : null;

  // Keep the toolbar refs pointing at the latest selection + handlers.
  deleteSelectedRef.current = () => {
    if (selectedAccountInCurrentTab) void handleDelete(selectedAccountInCurrentTab);
  };
  editSelectedRef.current = () => {
    if (selectedAccountInCurrentTab) openEditDialog(selectedAccountInCurrentTab);
  };

  // Whether the open dialog is creating/editing a customer/supplier ledger account (needs a NIF).
  const dialogParent = accounts.find(a => a.id === formData.parent_id);
  const dialogIsEntityRegistry = !formData.is_header && !!dialogParent && isEntityRegistryParent(dialogParent.code);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Action Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b flex-wrap">
        <ChartOfAccountsNewMenu buttonClassName={NEXOR_TOOLBAR_BTN_SM} />
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} disabled={!selectedAccountInCurrentTab} onClick={() => selectedAccountInCurrentTab && openEditDialog(selectedAccountInCurrentTab)}>
          <Edit2 className="w-3 h-3" /> {t.common.edit}
        </Button>
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} disabled={!selectedAccountInCurrentTab}
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
          onClick={() => {
            const entityName = selectedAccount
              ? resolveAccountDisplayName(selectedAccount, language, t)
              : undefined;
            navigate('/payments', { state: { openReceipt: true, entityName } });
          }}>
          <Receipt className="w-3 h-3" /> {t.chartOfAccountsUi.receipt}
        </Button>
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} disabled={!selectedAccount}
          onClick={() => {
            const entityName = selectedAccount
              ? resolveAccountDisplayName(selectedAccount, language, t)
              : undefined;
            navigate('/payments', { state: { openPayment: true, entityName } });
          }}>
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
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} onClick={handleResetToPgc} disabled={isReseeding} title={t.chartOfAccountsUi.resetPgcTooltip}>
          <RotateCcw className={cn('w-3 h-3', isReseeding && 'animate-spin')} /> {t.chartOfAccountsUi.resetPgc}
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => void refetch({ force: true, liveBalances: true })}><RefreshCw className="w-3 h-3" /></Button>
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
      <div className="flex-1 overflow-auto relative">
        {isLoading && accounts.length > 0 && (
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 border-b bg-background/80 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {t.common.loading}
          </div>
        )}
        {isLoading && accounts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <table className={cn('w-full text-xs', isLoading && accounts.length > 0 && 'opacity-60')}>
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
                  language={language}
                  t={t}
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
      {selectedAccount && (() => {
        const footerRaw = Number(selectedAccount.current_balance) || 0;
        const footerFlipped = selectedAccount.account_nature === 'credit' ? -footerRaw : footerRaw;
        const footerBalance = Math.abs(footerFlipped) < 0.005 ? 0 : footerFlipped;
        return (
          <div className="h-6 bg-primary/10 border-t flex items-center px-3 text-[10px] gap-4">
            <span className="font-bold">{selectedAccount.code} - {resolveAccountDisplayName(selectedAccount, language, t)}</span>
            <span>{t.chartOfAccountsUi.typeLabel}: {resolveAccountTypeLabel(selectedAccount.account_type, t)}</span>
            <span>{t.chartOfAccountsUi.balanceLabel}: {footerBalance.toLocaleString(uiLocale)} Kz</span>
          </div>
        );
      })()}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) { setIsAddingInlineParent(false); setInlineParentName(''); setInlineParentCode(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingAccount ? t.chartOfAccountsUi.editTitle : t.chartOfAccountsUi.newTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className={cn('grid gap-4', dialogIsEntityRegistry ? 'grid-cols-1' : 'grid-cols-2')}>
              <div className="space-y-2">
                <Label>{t.chartOfAccountsUi.codeLabel}</Label>
                <Input value={formData.code} onChange={e => setFormData(prev => ({ ...prev, code: e.target.value }))} placeholder={t.chartOfAccountsUi.codePlaceholder} />
              </div>
              {/* Supplier/client ledger accounts always inherit type from their parent (liability/asset),
                  so the type selector is hidden — it's not needed when creating those entities. */}
              {!dialogIsEntityRegistry && (
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
              )}
            </div>
            <div className="space-y-2">
              <Label>{t.chartOfAccountsUi.nameLabel}</Label>
              <Input value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder={t.chartOfAccountsUi.namePlaceholder} />
            </div>
            {dialogIsEntityRegistry && (
              <div className="space-y-2">
                <Label>{t.clientsUi.nifLabel}</Label>
                <Input
                  value={formData.nif}
                  onChange={e => setFormData(prev => ({ ...prev, nif: e.target.value }))}
                  placeholder="NIF"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>{t.common.description}</Label>
              <Textarea value={formData.description} onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>{t.chartOfAccountsUi.parentAccountLabel}</Label>
              {isAddingInlineParent ? (
                <div className="space-y-2 rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">{t.chartOfAccountsUi.newParentAccount}</p>
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      className="w-28 font-mono"
                      value={inlineParentCode}
                      placeholder={t.chartOfAccountsUi.codeLabel}
                      onChange={e => setInlineParentCode(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void handleCreateInlineParent(); }
                        if (e.key === 'Escape') { setIsAddingInlineParent(false); }
                      }}
                    />
                    <Input
                      value={inlineParentName}
                      placeholder={t.chartOfAccountsUi.nameLabel}
                      onChange={e => setInlineParentName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void handleCreateInlineParent(); }
                        if (e.key === 'Escape') { setIsAddingInlineParent(false); }
                      }}
                    />
                    <Button type="button" size="sm" onClick={() => void handleCreateInlineParent()} disabled={creatingInlineParent || !inlineParentName.trim() || !inlineParentCode.trim()}>
                      {t.common.save}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setIsAddingInlineParent(false)} disabled={creatingInlineParent}>
                      {t.common.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Select value={formData.parent_id || ROOT_ACCOUNT_VALUE} onValueChange={v => {
                      const parentId = v === ROOT_ACCOUNT_VALUE ? '' : v;
                      const parent = accounts.find(a => a.id === parentId);
                      setFormData(prev => {
                        if (!parent) {
                          const rootCodes = accounts.filter(a => !a.parent_id).map(a => a.code);
                          return {
                            ...prev,
                            parent_id: '',
                            level: 1,
                            code: editingAccount ? prev.code : buildSuggestedRootCode(rootCodes),
                          };
                        }
                        const children = accounts.filter(a => a.parent_id === parent.id && a.is_active !== false);
                        return {
                          ...prev,
                          parent_id: parentId,
                          level: parent.level + 1,
                          code: editingAccount ? prev.code : buildSuggestedChildCode(parent.code, children.map(c => c.code), prev.is_header),
                          account_type: parent.account_type,
                          account_nature: parent.account_nature,
                        };
                      });
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
                              {resolveAccountDisplayName(a, language, t)}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {!editingAccount && (
                    <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" title={t.chartOfAccountsUi.newParentAccount}
                      onClick={startInlineParent}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.chartOfAccountsUi.openingBalanceLabel}</Label>
                <Input type="number" value={formData.opening_balance} onChange={e => setFormData(prev => ({ ...prev, opening_balance: Number(e.target.value) }))} />
              </div>
              <div className="flex items-center gap-2 pt-8">
                <Checkbox id="is_header" checked={formData.is_header} onCheckedChange={checked => setFormData(prev => {
                  const isHeader = !!checked;
                  const parent = accounts.find(a => a.id === prev.parent_id);
                  if (editingAccount || !parent) {
                    return { ...prev, is_header: isHeader };
                  }
                  const children = accounts.filter(a => a.parent_id === parent.id && a.is_active !== false);
                  return {
                    ...prev,
                    is_header: isHeader,
                    code: buildSuggestedChildCode(parent.code, children.map(c => c.code), isHeader),
                  };
                })} />
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
      <ClientFormDialog open={isClientDialogOpen} onOpenChange={setIsClientDialogOpen} onSaved={() => refetch()} />
      <SupplierFormDialog open={isSupplierDialogOpen} onOpenChange={setIsSupplierDialogOpen} onSaved={() => refetch()} />
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
  language: 'en' | 'pt';
  t: TranslationKeys;
}

function AccountTreeRow({ account, level, expandedIds, onToggle, onSelect, onDoubleClick, onViewLedger, selectedId, allAccounts, language, t }: AccountTreeRowProps) {
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const displayName = resolveAccountDisplayName(account, language, t);
  const isExpanded = expandedIds.has(account.id);
  const children = allAccounts.filter(a => a.parent_id === account.id);
  const hasChildren = children.length > 0;
  const isSelected = selectedId === account.id;
  
  // Roll up children AND keep postings on the parent itself (payments often landed
  // on 321 before supplier leaves existed — dropping own balance made them vanish).
  // Also include PGC code-prefix descendants when parent_id links are incomplete.
  // Dedupe by id so parent_id children + code-prefix kids are not double-counted.
  const computeBalance = (acc: Account): number => {
    const own = Number(acc.current_balance) || 0;
    const byParent = allAccounts.filter((a) => a.parent_id === acc.id);
    const prefixKids = allAccounts.filter(
      (a) =>
        a.id !== acc.id
        && a.parent_id !== acc.id
        && String(a.code || '').startsWith(String(acc.code || ''))
        && String(a.code || '').length > String(acc.code || '').length,
    );
    const kids = [...byParent, ...prefixKids];
    if (kids.length === 0) return own;
    const seen = new Set<string>();
    let sum = own;
    for (const kid of kids) {
      if (seen.has(kid.id)) continue;
      seen.add(kid.id);
      sum += computeBalance(kid);
    }
    return sum;
  };

  const rawBalance = hasChildren || account.is_header || String(account.code || '').length <= 3
    ? computeBalance(account)
    : (Number(account.current_balance) || 0);
  const ownBalance = Number(account.current_balance) || 0;
  // API stores debit−credit. Credit-nature accounts (suppliers/clients) flip for display
  // so payables appear as a positive amount in the Credit column.
  const isCreditNature = account.account_nature === 'credit';
  const flipped = isCreditNature ? -rawBalance : rawBalance;
  const displayBalance = Math.abs(flipped) < 0.005 ? 0 : flipped;
  const ownFlipped = isCreditNature ? -ownBalance : ownBalance;
  const ownDisplay = Math.abs(ownFlipped) < 0.005 ? 0 : ownFlipped;
  const showOwnResidual =
    (String(account.code) === '321' || String(account.code) === '311')
    && hasChildren
    && Math.abs(ownDisplay) >= 0.005;
  const debitCol = !isCreditNature && displayBalance > 0
    ? displayBalance
    : (isCreditNature && displayBalance < 0 ? Math.abs(displayBalance) : 0);
  const creditCol = isCreditNature && displayBalance > 0
    ? displayBalance
    : (!isCreditNature && displayBalance < 0 ? Math.abs(displayBalance) : 0);

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
        <td className="px-3 py-1.5">
          {displayName}
          {showOwnResidual && (
            <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-400 font-normal">
              ({t.chartOfAccountsUi.ownResidual.replace('{amount}', ownDisplay.toLocaleString(uiLocale))})
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 text-center text-muted-foreground">AOA</td>
        <td className="px-3 py-1.5 text-right font-mono">
          {debitCol > 0 ? `${debitCol.toLocaleString(uiLocale)}` : ''}
        </td>
        <td className="px-3 py-1.5 text-right font-mono">
          {creditCol > 0 ? `${creditCol.toLocaleString(uiLocale)}` : ''}
        </td>
        <td className={cn("px-3 py-1.5 text-right font-mono font-medium", displayBalance >= 0 ? "text-foreground" : "text-destructive")}>
          {`${displayBalance.toLocaleString(uiLocale)}`}
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
          language={language}
          t={t}
        />
      ))}
    </>
  );
}
