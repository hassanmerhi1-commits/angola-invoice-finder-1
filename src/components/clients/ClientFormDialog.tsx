import { useEffect, useState } from 'react';
import { Client } from '@/types/erp';
import { useClients } from '@/hooks/useERP';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

function normalizeClientNif(nif: string): string {
  return nif.replace(/\s/g, '').trim();
}

const EMPTY_FORM = {
  name: '',
  nif: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  country: 'Angola',
  creditLimit: '0',
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
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

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
      });
    } else {
      setFormData(EMPTY_FORM);
    }
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

    setSaving(true);
    try {
      const payload = {
        ...formData,
        name,
        nif,
        creditLimit: parseFloat(formData.creditLimit) || 0,
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
        saved = await createClient({
          ...payload,
          currentBalance: 0,
          isActive: true,
        });
        toast({
          title: t.clientsUi.createdTitle,
          description: t.clientsUi.createdDesc.replace('{name}', name),
        });
      }

      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      console.error('[ClientFormDialog] save failed', e);
      toast({
        title: t.clientsUi.toastErrorTitle,
        description: t.clientsUi.saveOrCreateFailed,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{client ? t.clientsUi.editTitle : t.clientsUi.newTitle}</DialogTitle>
          <DialogDescription>
            {client ? t.clientsUi.editSubtitle : t.clientsUi.newSubtitle}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
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
            <div className="col-span-2 space-y-2">
              <Label htmlFor="coa-client-email">{t.common.email}</Label>
              <Input
                id="coa-client-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@exemplo.com"
              />
            </div>
            <div className="col-span-2 space-y-2">
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
