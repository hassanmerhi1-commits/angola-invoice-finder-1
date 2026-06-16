import { useEffect, useState } from 'react';
import { Supplier } from '@/types/erp';
import { useSuppliers } from '@/hooks/useERP';
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

const PAYMENT_TERMS = [
  { value: 'immediate', labelKey: 'immediate' },
  { value: '15_days', labelKey: 'days15' },
  { value: '30_days', labelKey: 'days30' },
  { value: '60_days', labelKey: 'days60' },
  { value: '90_days', labelKey: 'days90' },
] as const;

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
  const { t } = useTranslation();
  const { toast } = useToast();
  const { createSupplier, saveSupplier, refreshSuppliers } = useSuppliers();
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

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
        saved = await createSupplier({ ...formData, balance: 0 });
        toast({
          title: t.suppliersUi.supplierCreatedTitle,
          description: t.suppliersUi.supplierCreatedDesc.replace('{name}', formData.name),
        });
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
