import { useEffect, useMemo, useState } from 'react';
import { Supplier } from '@/types/erp';
import { useSuppliers } from '@/hooks/useERP';
import { useChartOfAccounts } from '@/hooks/useChartOfAccounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { resolveAccountDisplayName } from '@/lib/chartOfAccountsDisplay';
import { nextEntityAccountCode } from '@/lib/entityAccounts';
import { Plus } from 'lucide-react';

const PAYMENT_TERMS = [
  { value: 'immediate', labelKey: 'immediate' },
  { value: '15_days', labelKey: 'days15' },
  { value: '30_days', labelKey: 'days30' },
  { value: '60_days', labelKey: 'days60' },
  { value: '90_days', labelKey: 'days90' },
] as const;

const SUPPLIER_GROUP_CODE = '32';
const DEFAULT_SUPPLIER_PARENT_CODE = '321';
const ENTITY_ACCOUNT_CODE_LENGTH = 8;

const EMPTY_FORM = {
  name: '',
  nif: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  country: 'Angola',
  contactPerson: '',
  paymentTerms: 'immediate' as Supplier['paymentTerms'],
  isActive: true,
  notes: '',
  accountParentCode: DEFAULT_SUPPLIER_PARENT_CODE,
};

type SupplierFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier?: Supplier | null;
  onSaved?: (supplier: Supplier) => void;
};

export function SupplierFormDialog({
  open,
  onOpenChange,
  supplier = null,
  onSaved,
}: SupplierFormDialogProps) {
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const { createSupplier, saveSupplier, refreshSuppliers } = useSuppliers();
  const { accounts, createAccount, refetch: refetchAccounts } = useChartOfAccounts();
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [isAddingSub, setIsAddingSub] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [creatingSub, setCreatingSub] = useState(false);
  // Where the new parent/sub account will be created (the group 32 = a new top-level parent).
  const [newSubParentCode, setNewSubParentCode] = useState(SUPPLIER_GROUP_CODE);

  // Any non-leaf account under the Fornecedores group (32) can be a parent — at any depth
  // (321, then 3211 under it, etc.). Supplier leaf accounts are 8 digits and are excluded.
  const supplierParentOptions = useMemo(() => {
    const opts = accounts.filter(
      (a) =>
        a.is_active !== false &&
        a.code.startsWith(SUPPLIER_GROUP_CODE) &&
        a.code.length < ENTITY_ACCOUNT_CODE_LENGTH,
    );
    return opts.sort((a, b) => a.code.localeCompare(b.code));
  }, [accounts]);

  // Next compact code under the chosen base (group 32 -> 323 = new top parent; 321 -> 3211).
  const newSubBaseCode = newSubParentCode?.trim() || SUPPLIER_GROUP_CODE;

  const nextSubAccountCode = useMemo(() => {
    const used = new Set(accounts.map((a) => a.code));
    let n = 1;
    while (used.has(`${newSubBaseCode}${n}`)) n += 1;
    return `${newSubBaseCode}${n}`;
  }, [accounts, newSubBaseCode]);

  // The 8-digit account number that will be assigned on save, under the chosen parent.
  const previewAccountNumber = useMemo(
    () => nextEntityAccountCode(formData.accountParentCode, accounts),
    [formData.accountParentCode, accounts],
  );

  const startAddingSub = () => {
    // Default the new account's parent to the group (creates a new top-level parent), or to
    // the currently selected sub if one is chosen.
    setNewSubParentCode(formData.accountParentCode?.trim() || SUPPLIER_GROUP_CODE);
    setNewSubName('');
    setIsAddingSub(true);
  };

  const handleCreateSubAccount = async () => {
    const name = newSubName.trim();
    if (!name) return;
    setCreatingSub(true);
    try {
      const parent = accounts.find((a) => a.code === newSubBaseCode)
        || accounts.find((a) => a.code === SUPPLIER_GROUP_CODE);
      const code = nextSubAccountCode;
      await createAccount({
        code,
        name,
        account_type: 'liability',
        account_nature: 'credit',
        parent_id: parent?.id || null,
        level: (parent?.level ?? 1) + 1,
        is_header: true,
        opening_balance: 0,
      });
      await refetchAccounts();
      setFormData((prev) => ({ ...prev, accountParentCode: code }));
      setNewSubName('');
      setIsAddingSub(false);
      toast({
        title: t.common.success,
        description: `${code} — ${name}`,
      });
    } catch (error: unknown) {
      toast({
        title: t.common.error,
        description: error instanceof Error ? error.message : t.suppliersUi.saveFailed,
        variant: 'destructive',
      });
    } finally {
      setCreatingSub(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (supplier) {
      setFormData({
        name: supplier.name,
        nif: supplier.nif,
        email: supplier.email || '',
        phone: supplier.phone || '',
        address: supplier.address || '',
        city: supplier.city || '',
        country: supplier.country,
        contactPerson: supplier.contactPerson || '',
        paymentTerms: supplier.paymentTerms,
        isActive: supplier.isActive,
        notes: supplier.notes || '',
        accountParentCode: DEFAULT_SUPPLIER_PARENT_CODE,
      });
    } else {
      setFormData(EMPTY_FORM);
    }
  }, [open, supplier]);

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.nif.trim()) {
      toast({
        title: t.common.error,
        description: t.suppliersUi.nameAndNifRequired,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      let saved: Supplier;
      if (supplier) {
        await saveSupplier({
          ...supplier,
          ...formData,
          updatedAt: new Date().toISOString(),
        });
        saved = { ...supplier, ...formData };
        toast({
          title: t.suppliersUi.supplierUpdatedTitle,
          description: t.suppliersUi.supplierUpdatedDesc.replace('{name}', formData.name),
        });
      } else {
        const assignedCode = previewAccountNumber;
        saved = await createSupplier({ ...formData, balance: 0 });
        toast({
          title: t.suppliersUi.supplierCreatedTitle,
          description: assignedCode
            ? `${t.suppliersUi.supplierCreatedDesc.replace('{name}', formData.name)} (${assignedCode})`
            : t.suppliersUi.supplierCreatedDesc.replace('{name}', formData.name),
        });
        void refetchAccounts();
      }
      await refreshSuppliers();
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error: unknown) {
      toast({
        title: t.common.error,
        description: error instanceof Error ? error.message : t.suppliersUi.saveFailed,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {supplier ? t.suppliersUi.editSupplierTitle : t.suppliersUi.newSupplierTitle}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2 space-y-2">
            <Label htmlFor="coa-supplier-name">{t.suppliersUi.colName}</Label>
            <Input
              id="coa-supplier-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coa-supplier-nif">{t.suppliersUi.colNif}</Label>
            <Input
              id="coa-supplier-nif"
              value={formData.nif}
              onChange={(e) => setFormData({ ...formData, nif: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coa-supplier-phone">{t.common.phone}</Label>
            <Input
              id="coa-supplier-phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label htmlFor="coa-supplier-email">{t.common.email}</Label>
            <Input
              id="coa-supplier-email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coa-supplier-contact">{t.suppliersUi.contactPersonLabel}</Label>
            <Input
              id="coa-supplier-contact"
              value={formData.contactPerson}
              onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t.suppliersUi.colPaymentTerms}</Label>
            <Select
              value={formData.paymentTerms}
              onValueChange={(v) => setFormData({ ...formData, paymentTerms: v as Supplier['paymentTerms'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_TERMS.map((pt) => (
                  <SelectItem key={pt.value} value={pt.value}>
                    {t.suppliersUi.paymentTerms[pt.labelKey]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!supplier && (
            <div className="col-span-2 space-y-2">
              <div className="flex items-center justify-between rounded-md border p-2 bg-muted/30">
                <Label className="m-0">{t.chartOfAccountsUi.accountNumberLabel}</Label>
                <span className="font-mono text-sm font-semibold">{previewAccountNumber || '—'}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{t.chartOfAccountsUi.accountNumberAutoHint}</p>
              <Label>{t.chartOfAccountsUi.parentAccountLabel}</Label>
              {isAddingSub ? (
                <div className="space-y-2 rounded-md border p-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t.chartOfAccountsUi.parentAccountLabel}</Label>
                    <Select value={newSubParentCode} onValueChange={setNewSubParentCode}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {supplierParentOptions.map((acc) => (
                          <SelectItem key={acc.code} value={acc.code}>
                            {acc.code} — {resolveAccountDisplayName(acc, language, t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={newSubName}
                      placeholder={`${nextSubAccountCode} — ${t.chartOfAccountsUi.accountNameLabel}`}
                      onChange={(e) => setNewSubName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleCreateSubAccount();
                        }
                        if (e.key === 'Escape') {
                          setIsAddingSub(false);
                          setNewSubName('');
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleCreateSubAccount()}
                      disabled={creatingSub || !newSubName.trim()}
                    >
                      {t.common.save}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsAddingSub(false);
                        setNewSubName('');
                      }}
                      disabled={creatingSub}
                    >
                      {t.common.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Select
                      value={formData.accountParentCode}
                      onValueChange={(v) => setFormData({ ...formData, accountParentCode: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {supplierParentOptions.map((acc) => (
                          <SelectItem key={acc.code} value={acc.code}>
                            {acc.code} — {resolveAccountDisplayName(acc, language, t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={startAddingSub}>
                    <Plus className="w-4 h-4 mr-1" />
                    {t.common.new}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="col-span-2 space-y-2">
            <Label htmlFor="coa-supplier-address">{t.common.address}</Label>
            <Input
              id="coa-supplier-address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coa-supplier-city">{t.clientsUi.cityLabel}</Label>
            <Input
              id="coa-supplier-city"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {supplier ? t.common.saveChanges : t.suppliersUi.newSupplierCta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
