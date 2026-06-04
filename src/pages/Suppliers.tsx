import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { useSuppliers } from '@/hooks/useERP';
import { api } from '@/lib/api/client';
import { ensureSupplierAccount } from '@/lib/chartOfAccountsEngine';
import { NEXOR_TOOLBAR, NEXOR_SUPPLIERS_NEW } from '@/lib/nexorToolbarEvents';
import { Supplier } from '@/types/erp';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Search, Plus, Edit, Trash2, Truck, Phone, Mail, FileSpreadsheet, Upload, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
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
import { exportSuppliersToExcel, parseSuppliersFromExcel, validateImportedSuppliers, downloadSupplierImportTemplate, ExcelSupplier } from '@/lib/excel';
import { ExcelImportDialog } from '@/components/import/ExcelImportDialog';

const PAYMENT_TERMS = [
  { value: 'immediate', labelKey: 'immediate' },
  { value: '15_days', labelKey: 'days15' },
  { value: '30_days', labelKey: 'days30' },
  { value: '60_days', labelKey: 'days60' },
  { value: '90_days', labelKey: 'days90' },
] as const;

const initialFormData = {
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

export default function Suppliers() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { suppliers, saveSupplier, deleteSupplier, createSupplier, refreshSuppliers } = useSuppliers();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState(initialFormData);

  const filteredSuppliers = suppliers.filter(supplier =>
    supplier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    supplier.nif.includes(searchTerm) ||
    supplier.contactPerson?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleOpenDialog = (supplier?: Supplier) => {
    if (supplier) {
      setSelectedSupplier(supplier);
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
      setSelectedSupplier(null);
      setFormData(initialFormData);
    }
    setDialogOpen(true);
  };

  // TopNav toolbar "Novo" (router state + event for same-page clicks)
  useEffect(() => {
    const openNew = () => {
      setSelectedSupplier(null);
      setFormData(initialFormData);
      setDialogOpen(true);
    };

    const st = location.state as { nexorToolbarNewSupplier?: boolean } | null;
    if (st?.nexorToolbarNewSupplier) {
      openNew();
      navigate('.', { replace: true, state: {} });
    }

    window.addEventListener(NEXOR_SUPPLIERS_NEW, openNew);
    return () => window.removeEventListener(NEXOR_SUPPLIERS_NEW, openNew);
  }, [location.state, navigate]);

  useEffect(() => {
    const onEdit = () => {
      if (selectedSupplier) handleOpenDialog(selectedSupplier);
    };
    const onDelete = () => {
      if (selectedSupplier && confirm(t.suppliersUi.deleteConfirm)) {
        deleteSupplier(selectedSupplier.id);
        setSelectedSupplier(null);
      }
    };
    const onAll = () => setSelectedSupplier(null);
    const handlers: Record<string, () => void> = {
      [NEXOR_TOOLBAR.EDIT]: onEdit,
      [NEXOR_TOOLBAR.DELETE]: onDelete,
      [NEXOR_TOOLBAR.ALL]: onAll,
    };
    for (const [event, handler] of Object.entries(handlers)) {
      window.addEventListener(event, handler);
    }
    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        window.removeEventListener(event, handler);
      }
    };
  }, [selectedSupplier, deleteSupplier, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.nif.trim()) {
      toast({
        title: t.common.error,
        description: t.suppliersUi.nameAndNifRequired,
        variant: 'destructive',
      });
      return;
    }

    try {
      if (selectedSupplier) {
        await saveSupplier({
          ...selectedSupplier,
          ...formData,
          updatedAt: new Date().toISOString(),
        });
        toast({
          title: t.suppliersUi.supplierUpdatedTitle,
          description: t.suppliersUi.supplierUpdatedDesc.replace('{name}', formData.name),
        });
      } else {
        await createSupplier({ ...formData, balance: 0 });
        toast({
          title: t.suppliersUi.supplierCreatedTitle,
          description: t.suppliersUi.supplierCreatedDesc.replace('{name}', formData.name),
        });
      }

      await refreshSuppliers();
      setDialogOpen(false);
      setSelectedSupplier(null);
      setFormData(initialFormData);
    } catch (error: any) {
      toast({
        title: t.common.error,
        description: error?.message || t.suppliersUi.saveFailed,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = () => {
    if (selectedSupplier) {
      deleteSupplier(selectedSupplier.id);
      toast({
        title: t.suppliersUi.supplierDeletedTitle,
        description: t.suppliersUi.supplierDeletedDesc.replace('{name}', selectedSupplier.name),
      });
      setDeleteDialogOpen(false);
      setSelectedSupplier(null);
    }
  };

  const openDeleteDialog = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setDeleteDialogOpen(true);
  };

  const handleImportSuppliers = useCallback(async (data: ExcelSupplier[], options?: { updateDuplicates?: boolean }) => {
    const paymentTermsMap: Record<string, Supplier['paymentTerms']> = {
      'immediate': 'immediate',
      '15_days': '15_days',
      '30_days': '30_days',
      '60_days': '60_days',
      '90_days': '90_days',
    };

    // Map to supplier format
    const supplierList = data.map(item => ({
      name: item.nome,
      nif: item.nif,
      contactPerson: item.pessoaContacto || '',
      phone: item.telefone || '',
      email: item.email || '',
      address: item.morada || '',
      city: item.cidade || '',
      country: item.pais || 'Angola',
      paymentTerms: paymentTermsMap[item.prazoPagamento || ''] || 'immediate',
      notes: item.notas || '',
    }));

    // Use batch API — the backend auto-creates 3.2.XXX sub-accounts
    const result = await api.suppliers.batchImport(supplierList);
    if (result.data) {
      await refreshSuppliers();
      toast({
        title: t.suppliersUi.importCompletedTitle,
        description: t.suppliersUi.importCompletedDesc
          .replace('{imported}', String(result.data.imported))
          .replace('{failedPart}', result.data.failed > 0 ? t.suppliersUi.importFailedPart.replace('{count}', String(result.data.failed)) : ''),
      });
      return;
    }

    // API returned an error — do NOT silently fall back to localStorage
    throw new Error(result.error || t.suppliersUi.importFailedCheckConnection);
  }, [refreshSuppliers, toast]);

  // Get existing NIFs for duplicate detection
  const existingNifs = suppliers.map(s => s.nif);

  const supplierImportColumns: { key: keyof ExcelSupplier; label: string }[] = [
    { key: 'nome', label: t.importUi.fields.name },
    { key: 'nif', label: t.importUi.fields.nif },
    { key: 'pessoaContacto', label: t.importUi.fields.contactPerson },
    { key: 'telefone', label: t.importUi.fields.phone },
    { key: 'cidade', label: t.importUi.fields.city },
  ];

  const supplierImportValidation = useMemo(
    () => ({
      nameRequired: t.importUi.validation.nameRequired,
      nifRequired: t.importUi.validation.nifRequired,
    }),
    [t],
  );

  const supplierImportTemplate = useMemo(
    () => ({
      columns: t.importUi.supplierTemplate.columns,
      name: t.importUi.supplierTemplate.name,
      contact: t.importUi.supplierTemplate.contact,
      phone: t.importUi.supplierTemplate.phone,
      email: t.importUi.supplierTemplate.email,
      address: t.importUi.supplierTemplate.address,
      city: t.importUi.supplierTemplate.city,
      country: t.importUi.supplierTemplate.country,
      notes: t.importUi.supplierTemplate.notes,
      sheetName: t.importUi.supplierTemplate.sheetName,
      filename: t.importUi.supplierTemplate.filename,
    }),
    [t],
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{t.suppliersUi.title}</h1>
            <p className="text-sm text-muted-foreground font-medium">
              {t.suppliersUi.subtitle}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => setImportDialogOpen(true)}>
            <Upload className="w-4 h-4 mr-2" />
            {t.common.import}
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => exportSuppliersToExcel(suppliers)}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            {t.common.export}
          </Button>
          <Button className="rounded-xl gradient-primary shadow-glow" onClick={() => handleOpenDialog()}>
            <Plus className="w-4 h-4 mr-2" />
            {t.suppliersUi.newSupplierCta}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl gradient-primary shadow-md">
                <Truck className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t.suppliersUi.totalSuppliers}</p>
                <p className="text-3xl font-extrabold tracking-tight">{suppliers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl gradient-success shadow-md">
                <Truck className="w-6 h-6 text-success-foreground" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t.common.active}</p>
                <p className="text-3xl font-extrabold tracking-tight">
                  {suppliers.filter(s => s.isActive).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl gradient-warm shadow-md">
                <Truck className="w-6 h-6 text-warning-foreground" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t.common.inactive}</p>
                <p className="text-3xl font-extrabold tracking-tight">
                  {suppliers.filter(s => !s.isActive).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t.suppliersUi.listTitle}</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t.common.search}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredSuppliers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {suppliers.length === 0 ? (
                <>
                  <Truck className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{t.suppliersUi.noneRegistered}</p>
                  <Button variant="link" onClick={() => handleOpenDialog()}>
                    {t.suppliersUi.addFirstSupplier}
                  </Button>
                </>
              ) : (
                <p>{t.suppliersUi.noneFoundFor.replace('{term}', searchTerm)}</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.suppliersUi.colName}</TableHead>
                  <TableHead>{t.suppliersUi.colNif}</TableHead>
                  <TableHead>{t.suppliersUi.colContact}</TableHead>
                  <TableHead>{t.suppliersUi.colPaymentTerms}</TableHead>
                  <TableHead className="text-right">{t.suppliersUi.colBalance}</TableHead>
                  <TableHead>{t.suppliersUi.colStatus}</TableHead>
                  <TableHead className="text-right">{t.suppliersUi.colActions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSuppliers.map(supplier => (
                  <TableRow key={supplier.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{supplier.name}</p>
                        {supplier.contactPerson && (
                          <p className="text-xs text-muted-foreground">
                            {supplier.contactPerson}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">{supplier.nif}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {supplier.phone && (
                          <span className="flex items-center gap-1 text-sm">
                            <Phone className="w-3 h-3" /> {supplier.phone}
                          </span>
                        )}
                        {supplier.email && (
                          <span className="flex items-center gap-1 text-sm">
                            <Mail className="w-3 h-3" /> {supplier.email}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const term = PAYMENT_TERMS.find((pt) => pt.value === supplier.paymentTerms);
                        return term
                          ? (t.suppliersUi.paymentTerms[term.labelKey] as string)
                          : supplier.paymentTerms;
                      })()}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      {(supplier.balance || 0).toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={supplier.isActive ? 'default' : 'secondary'}>
                        {supplier.isActive ? t.common.active : t.common.inactive}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(supplier)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDeleteDialog(supplier)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedSupplier ? t.suppliersUi.editSupplierTitle : t.suppliersUi.newSupplierTitle}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="name">{t.suppliersUi.companyNameLabel}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t.suppliersUi.namePlaceholder}
                />
              </div>

              <div>
                <Label htmlFor="nif">{t.suppliersUi.colNif} *</Label>
                <Input
                  id="nif"
                  value={formData.nif}
                  onChange={(e) => setFormData({ ...formData, nif: e.target.value })}
                  placeholder={t.suppliersUi.nifPlaceholder}
                />
              </div>

              <div>
                <Label htmlFor="contactPerson">{t.suppliersUi.contactPersonLabel}</Label>
                <Input
                  id="contactPerson"
                  value={formData.contactPerson}
                  onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                  placeholder={t.suppliersUi.contactPersonPlaceholder}
                />
              </div>

              <div>
                <Label htmlFor="phone">{t.common.phone}</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder={t.suppliersUi.phonePlaceholder}
                />
              </div>

              <div>
                <Label htmlFor="email">{t.common.email}</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder={t.suppliersUi.emailPlaceholder}
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="address">{t.common.address}</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder={t.suppliersUi.addressPlaceholder}
                />
              </div>

              <div>
                <Label htmlFor="city">{t.suppliersUi.cityLabel}</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder={t.suppliersUi.cityPlaceholder}
                />
              </div>

              <div>
                <Label htmlFor="country">{t.suppliersUi.countryLabel}</Label>
                <Input
                  id="country"
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="paymentTerms">{t.suppliersUi.paymentTermsLabel}</Label>
                <Select
                  value={formData.paymentTerms}
                  onValueChange={(value: Supplier['paymentTerms']) =>
                    setFormData({ ...formData, paymentTerms: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS.map((term) => (
                      <SelectItem key={term.value} value={term.value}>
                        {t.suppliersUi.paymentTerms[term.labelKey as keyof typeof t.suppliersUi.paymentTerms] as string}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3 pt-6">
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
                <Label htmlFor="isActive">{t.suppliersUi.activeSupplierLabel}</Label>
              </div>

              <div className="col-span-2">
                <Label htmlFor="notes">{t.common.notes}</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder={t.suppliersUi.notesPlaceholder}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit">
                {selectedSupplier ? t.common.saveChanges : t.suppliersUi.createSupplier}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.suppliersUi.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.suppliersUi.deleteDialogDescription.replace(
                '{name}',
                selectedSupplier?.name ?? '',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              {t.suppliersUi.deleteDialogConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Excel Import Dialog */}
      <ExcelImportDialog<ExcelSupplier>
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title={t.suppliersUi.importTitle}
        description={t.suppliersUi.importDesc}
        parseFile={parseSuppliersFromExcel}
        validateData={(data) => validateImportedSuppliers(data, supplierImportValidation)}
        onImport={handleImportSuppliers}
        downloadTemplate={() => downloadSupplierImportTemplate(supplierImportTemplate)}
        columns={supplierImportColumns}
        duplicateKey="nif"
        existingKeys={existingNifs}
        duplicateLabel={t.importUi.fields.nif}
        mappingType="suppliers"
      />
    </div>
  );
}