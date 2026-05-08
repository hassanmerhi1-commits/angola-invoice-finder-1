import { generateId } from '@/lib/utils';
import { useState } from 'react';
import { useBranchContext } from '@/contexts/BranchContext';
import { Branch } from '@/types/erp';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Building2, MapPin, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';

export default function Branches() {
  const { t } = useTranslation();
  const { branches, refreshBranches } = useBranchContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [branchToDelete, setBranchToDelete] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '', code: '', address: '', phone: '', isMain: false,
  });

  const resetForm = () => {
    setFormData({ name: '', code: '', address: '', phone: '', isMain: false });
    setEditingBranch(null);
  };

  const openCreateDialog = () => { resetForm(); setDialogOpen(true); };

  const openEditDialog = (branch: Branch) => {
    setEditingBranch(branch);
    setFormData({
      name: branch.name, code: branch.code || '', address: branch.address || '',
      phone: branch.phone || '', isMain: branch.isMain || false,
    });
    setDialogOpen(true);
  };

  const openDeleteDialog = (branch: Branch) => {
    setBranchToDelete(branch);
    setDeleteDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error(t.branchesUi.nameRequired);
      return;
    }

    setIsLoading(true);
    try {
      if (editingBranch) {
        const response = await api.branches.update(editingBranch.id, formData);
        if (response.error) throw new Error(response.error);
        toast.success(t.branchesUi.updatedSuccess);
      } else {
        const response = await api.branches.create(formData);
        if (response.data) {
          toast.success(t.branchesUi.createdSuccess);
        } else {
          // API unavailable - save to localStorage as fallback
          const { saveBranch } = await import('@/lib/storage');
          const newBranch: Branch = {
            id: generateId(),
            name: formData.name,
            code: formData.code || `FIL${Date.now().toString().slice(-4)}`,
            address: formData.address || '',
            phone: formData.phone || '',
            isMain: formData.isMain || false,
            priceLevel: 1,
            createdAt: new Date().toISOString(),
          };
          await saveBranch(newBranch);
          toast.success(t.branchesUi.createdLocalSuccess);
        }
      }
      setDialogOpen(false);
      resetForm();
      await refreshBranches();
    } catch (error: any) {
      console.error('Error saving branch:', error);
      toast.error(error.message || t.branchesUi.saveError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!branchToDelete) return;

    if (branchToDelete.isMain) {
      toast.error(t.branchesUi.cannotDeleteMain);
      setDeleteDialogOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      // Try API delete
      toast.error(t.branchesUi.apiDeleteNotImplemented);
      setDeleteDialogOpen(false);
      setBranchToDelete(null);
    } catch (error: any) {
      console.error('Error deleting branch:', error);
      toast.error(error.message || t.branchesUi.deleteError);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-7 w-7" />
            {t.branchesUi.title}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t.branchesUi.subtitle}
          </p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          {t.branchesUi.newBranch}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t.branchesUi.registeredBranches}</CardTitle>
        </CardHeader>
        <CardContent>
          {branches.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>{t.branchesUi.emptyTitle}</p>
              <p className="text-sm">{t.branchesUi.emptyHint}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.branchesUi.colName}</TableHead>
                  <TableHead>{t.branchesUi.colCode}</TableHead>
                  <TableHead>{t.branchesUi.colAddress}</TableHead>
                  <TableHead>{t.branchesUi.colPhone}</TableHead>
                  <TableHead>{t.branchesUi.colType}</TableHead>
                  <TableHead className="text-right">{t.branchesUi.colActions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((branch) => (
                  <TableRow key={branch.id}>
                    <TableCell className="font-medium">{branch.name}</TableCell>
                    <TableCell>{branch.code || '-'}</TableCell>
                    <TableCell>
                      {branch.address ? (
                        <span className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {branch.address}
                        </span>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {branch.phone ? (
                        <span className="flex items-center gap-1 text-sm">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {branch.phone}
                        </span>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {branch.isMain ? (
                        <Badge variant="default">{t.branchesUi.typeHeadOffice}</Badge>
                      ) : (
                        <Badge variant="secondary">{t.branchesUi.typeBranch}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(branch)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(branch)} disabled={branch.isMain}>
                          <Trash2 className="h-4 w-4" />
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBranch ? t.branchesUi.editTitle : t.branchesUi.newTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t.branchesUi.nameLabel}</Label>
              <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder={t.branchesUi.namePlaceholder} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">{t.branchesUi.codeLabel}</Label>
              <Input id="code" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder={t.branchesUi.codePlaceholder} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">{t.branchesUi.addressLabel}</Label>
              <Input id="address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder={t.branchesUi.addressPlaceholder} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t.branchesUi.phoneLabel}</Label>
              <Input id="phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder={t.branchesUi.phonePlaceholder} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="isMain">{t.branchesUi.mainBranchLabel}</Label>
              <Switch id="isMain" checked={formData.isMain} onCheckedChange={(checked) => setFormData({ ...formData, isMain: checked })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleSave} disabled={isLoading}>{isLoading ? t.common.saving : t.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.branchesUi.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.branchesUi.deleteConfirm
                .replace('{name}', String(branchToDelete?.name || ''))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isLoading}>
              {isLoading ? t.common.deleting : t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
