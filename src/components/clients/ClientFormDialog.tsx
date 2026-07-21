import { useEffect, useMemo, useRef, useState } from 'react';
import { Client } from '@/types/erp';
import { useClients } from '@/hooks/useERP';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { validateNIF } from '@/lib/companySettings';
import { ENTITY_ACCOUNT_CODE_LENGTH, nextEntityAccountCode } from '@/lib/entityAccounts';
import { Plus } from 'lucide-react';

function normalizeClientNif(nif: string): string {
  return nif.replace(/\s/g, '').trim();
}

// Angola PGC (novo com IVA): Clientes group is 31; client ledger accounts default
// to 311 (Clientes - correntes).
const CLIENT_GROUP_CODE = '31';
const DEFAULT_CLIENT_PARENT_CODE = '311';

const EMPTY_FORM = {
  name: '',
  nif: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  country: 'Angola',
  creditLimit: '0',
  defaultPriceLevel: '1',
  priceAdjustmentPct: '0',
  paymentTermsDays: '0',
  accountParentCode: DEFAULT_CLIENT_PARENT_CODE,
};

type ClientFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: Client | null;
  onSaved?: (client: Client) => void;
};

export function ClientFormDialog({
  open,
  onOpenChange,
  client = null,
  onSaved,
}: ClientFormDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { createClient, saveClient } = useClients();
  const { accounts, createAccount, refetch: refetchAccounts } = useChartOfAccounts();
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [isAddingSub, setIsAddingSub] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [creatingSub, setCreatingSub] = useState(false);
  const [newSubParentCode, setNewSubParentCode] = useState(CLIENT_GROUP_CODE);

  // Any non-leaf account under the Clientes group (31) can be a parent, at any depth.
  // Client leaf accounts are 8 digits and are excluded from the parent options.
  const clientParentOptions = useMemo(() => {
    const opts = accounts.filter(
      (a) =>
        a.is_active !== false &&
        a.code.startsWith(CLIENT_GROUP_CODE) &&
        a.code.length < ENTITY_ACCOUNT_CODE_LENGTH,
    );
    return opts.sort((a, b) => a.code.localeCompare(b.code));
  }, [accounts]);

  // The 8-digit account number that will be assigned on save, under the chosen parent.
  const previewAccountNumber = useMemo(
    () => nextEntityAccountCode(formData.accountParentCode, accounts),
    [formData.accountParentCode, accounts],
  );

  // Next compact code for a brand-new grouping sub-account (e.g. 31 -> 312, 311 -> 3111).
  const newSubBaseCode = newSubParentCode?.trim() || CLIENT_GROUP_CODE;
  const nextSubAccountCode = useMemo(() => {
    const used = new Set(accounts.map((a) => a.code));
    let n = 1;
    while (used.has(`${newSubBaseCode}${n}`)) n += 1;
    return `${newSubBaseCode}${n}`;
  }, [accounts, newSubBaseCode]);

  const startAddingSub = () => {
    setNewSubParentCode(formData.accountParentCode?.trim() || CLIENT_GROUP_CODE);
    setNewSubName('');
    setIsAddingSub(true);
  };

  const handleCreateSubAccount = async () => {
    const name = newSubName.trim();
    if (!name) return;
    setCreatingSub(true);
    try {
      const parent = accounts.find((a) => a.code === newSubBaseCode)
        || accounts.find((a) => a.code === CLIENT_GROUP_CODE);
      const code = nextSubAccountCode;
      await createAccount({
        code,
        name,
        account_type: 'asset',
        account_nature: 'debit',
        parent_id: parent?.id || null,
        level: (parent?.level ?? 1) + 1,
        is_header: true,
        opening_balance: 0,
      });
      await refetchAccounts();
      setFormData((prev) => ({ ...prev, accountParentCode: code }));
      setNewSubName('');
      setIsAddingSub(false);
      toast({ title: t.common.success, description: `${code} — ${name}` });
    } catch (error: unknown) {
      toast({
        title: t.common.error,
        description: error instanceof Error ? error.message : t.clientsUi.saveOrCreateFailed,
        variant: 'destructive',
      });
    } finally {
      setCreatingSub(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (client) {
      setFormData({
        name: client.name,
        nif: client.nif,
        email: client.email || '',
        phone: client.phone || '',
        address: client.address || '',
        city: client.city || '',
        country: client.country,
        creditLimit: client.creditLimit.toString(),
        defaultPriceLevel: String(client.defaultPriceLevel ?? 1),
        priceAdjustmentPct: String(client.priceAdjustmentPct ?? 0),
        paymentTermsDays: String(client.paymentTermsDays ?? 0),
        accountParentCode: DEFAULT_CLIENT_PARENT_CODE,
      });
    } else {
      setFormData(EMPTY_FORM);
    }
    setIsAddingSub(false);
    setNewSubName('');
  }, [open, client]);

  const canSave = formData.name.trim().length > 0 && validateNIF(normalizeClientNif(formData.nif));

  const handleSave = async () => {
    const name = formData.name.trim();
    const nif = normalizeClientNif(formData.nif);

    if (!name) {
      toast({
        title: t.clientsUi.toastErrorTitle,
        description: t.clientsUi.nameAndNifRequired,
        variant: 'destructive',
      });
      return;
    }

    if (!nif) {
      toast({
        title: t.clientsUi.toastErrorTitle,
        description: t.clientsUi.nifRequired,
        variant: 'destructive',
      });
      return;
    }

    if (!validateNIF(nif)) {
      toast({
        title: t.clientsUi.toastErrorTitle,
        description: t.clientsUi.nifInvalid10Digits,
        variant: 'destructive',
      });
      return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const levelNum = Math.trunc(Number(formData.defaultPriceLevel));
      const payload = {
        ...formData,
        name,
        nif,
        creditLimit: parseFloat(formData.creditLimit) || 0,
        defaultPriceLevel: levelNum >= 1 && levelNum <= 4 ? levelNum : 1,
        priceAdjustmentPct: parseFloat(formData.priceAdjustmentPct) || 0,
        paymentTermsDays: Math.max(0, Math.trunc(Number(formData.paymentTermsDays)) || 0),
      };

      let saved: Client;
      if (client) {
        await saveClient({ ...client, ...payload });
        saved = { ...client, ...payload };
        toast({
          title: t.clientsUi.updatedTitle,
          description: t.clientsUi.updatedDesc.replace('{name}', name),
        });
      } else {
        const assignedCode = previewAccountNumber;
        saved = await createClient({
          ...payload,
          currentBalance: 0,
          isActive: true,
        });
        toast({
          title: t.clientsUi.createdTitle,
          description: assignedCode
            ? `${t.clientsUi.createdDesc.replace('{name}', name)} (${assignedCode})`
            : t.clientsUi.createdDesc.replace('{name}', name),
        });
        void refetchAccounts();
      }

      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      console.error('[ClientFormDialog] save failed', e);
      toast({
        title: t.clientsUi.toastErrorTitle,
        description: e instanceof Error && e.message ? e.message : t.clientsUi.saveOrCreateFailed,
        variant: 'destructive',
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client ? t.clientsUi.editTitle : t.clientsUi.newTitle}</DialogTitle>
          <DialogDescription>
            {client ? t.clientsUi.editSubtitle : t.clientsUi.newSubtitle}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-3 space-y-2">
              <Label htmlFor="coa-client-name">{t.clientsUi.nameLabel}</Label>
              <Input
                id="coa-client-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t.clientsUi.namePlaceholder}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coa-client-nif">{t.clientsUi.nifLabel}</Label>
              <Input
                id="coa-client-nif"
                value={formData.nif}
                onChange={(e) => setFormData({ ...formData, nif: e.target.value })}
                placeholder={t.clientsUi.nifPlaceholder}
                required
                inputMode="numeric"
                maxLength={14}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coa-client-phone">{t.common.phone}</Label>
              <Input
                id="coa-client-phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+244 9XX XXX XXX"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coa-client-email">{t.common.email}</Label>
              <Input
                id="coa-client-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@exemplo.com"
              />
            </div>
            {!client && (
              <div className="col-span-3 space-y-2 rounded-md border p-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label>{t.chartOfAccountsUi.accountNumberLabel}</Label>
                  <span className="font-mono text-sm font-semibold">{previewAccountNumber || '—'}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{t.chartOfAccountsUi.accountNumberAutoHint}</p>
                <Label className="text-xs text-muted-foreground">{t.chartOfAccountsUi.parentAccountLabel}</Label>
                {isAddingSub ? (
                  <div className="space-y-2 rounded-md border p-2 bg-background">
                    <Select value={newSubParentCode} onValueChange={setNewSubParentCode}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {clientParentOptions.map((acc) => (
                          <SelectItem key={acc.code} value={acc.code}>
                            {acc.code} — {acc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={newSubName}
                        placeholder={`${nextSubAccountCode} — ${t.chartOfAccountsUi.accountNameLabel}`}
                        onChange={(e) => setNewSubName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); void handleCreateSubAccount(); }
                          if (e.key === 'Escape') { setIsAddingSub(false); setNewSubName(''); }
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
                        onClick={() => { setIsAddingSub(false); setNewSubName(''); }}
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
                          {clientParentOptions.map((acc) => (
                            <SelectItem key={acc.code} value={acc.code}>
                              {acc.code} — {acc.name}
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
            <div className="col-span-3 space-y-2">
              <Label htmlFor="coa-client-address">{t.common.address}</Label>
              <Input
                id="coa-client-address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder={t.clientsUi.addressPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coa-client-city">{t.clientsUi.cityLabel}</Label>
              <Input
                id="coa-client-city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Luanda"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coa-client-credit">{t.clientsUi.creditLimitLabel}</Label>
              <Input
                id="coa-client-credit"
                type="number"
                value={formData.creditLimit}
                onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
                placeholder="0"
              />
              <p className="text-[11px] text-muted-foreground">{t.clientsUi.creditLimitHint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="coa-client-terms">{t.clientsUi.paymentTermsDaysLabel}</Label>
              <Input
                id="coa-client-terms"
                type="number"
                min={0}
                step={1}
                value={formData.paymentTermsDays}
                onChange={(e) => setFormData({ ...formData, paymentTermsDays: e.target.value })}
                placeholder="0"
              />
              <p className="text-[11px] text-muted-foreground">{t.clientsUi.paymentTermsDaysHint}</p>
            </div>
            <div className="space-y-2">
              <Label>{t.clientsUi.defaultPriceLevelLabel}</Label>
              <Select
                value={formData.defaultPriceLevel}
                onValueChange={(v) => setFormData({ ...formData, defaultPriceLevel: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t.clientsUi.priceLevelOption.replace('{n}', '1')}</SelectItem>
                  <SelectItem value="2">{t.clientsUi.priceLevelOption.replace('{n}', '2')}</SelectItem>
                  <SelectItem value="3">{t.clientsUi.priceLevelOption.replace('{n}', '3')}</SelectItem>
                  <SelectItem value="4">{t.clientsUi.priceLevelOption.replace('{n}', '4')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="coa-client-price-adj">{t.clientsUi.priceAdjustmentLabel}</Label>
              <Input
                id="coa-client-price-adj"
                type="number"
                step="0.01"
                value={formData.priceAdjustmentPct}
                onChange={(e) => setFormData({ ...formData, priceAdjustmentPct: e.target.value })}
                placeholder="0"
              />
              <p className="text-[11px] text-muted-foreground">{t.clientsUi.priceAdjustmentHint}</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave || saving}>
            {client ? t.common.saveChanges : t.clientsUi.registerClient}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
