import React, { useState, useMemo } from 'react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useCategories, useProducts } from '@/hooks/useERP';
import { Category } from '@/types/erp';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Search, Plus, Edit, Trash2, Tags, Package, ChevronRight, FolderOpen, Folder } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
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

const PRESET_COLORS = [
  '#22c55e', '#3b82f6', '#a855f7', '#ec4899',
  '#f59e0b', '#ef4444', '#14b8a6', '#6b7280',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316',
];

const initialFormData = {
  name: '',
  description: '',
  color: '#3b82f6',
  isActive: true,
  parentId: '' as string | null,
};

export default function Categories() {
  const { t } = useTranslation();
  const { apiBranchId } = useBranchScope();
  const { categories, saveCategory, deleteCategory, createCategory } = useCategories();
  // Branch-scoped light list for counts only — avoid company-wide catalog on this tab.
  const { products } = useProducts(apiBranchId, { light: true });
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState(initialFormData);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Build tree structure
  const rootCategories = useMemo(() => {
    return categories.filter(c => !c.parentId);
  }, [categories]);

  const getChildren = (parentId: string) => {
    return categories.filter(c => c.parentId === parentId);
  };

  const toggleExpand = (id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredCategories = useMemo(() => {
    if (!searchTerm) return null; // use tree view
    return categories.filter(category =>
      category.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      category.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [categories, searchTerm]);

  const getProductCount = (categoryName: string) => {
    return products.filter(p => p.category === categoryName).length;
  };

  // Get total product count including children
  const getTotalProductCount = (categoryId: string, categoryName: string): number => {
    let count = getProductCount(categoryName);
    const children = getChildren(categoryId);
    for (const child of children) {
      count += getTotalProductCount(child.id, child.name);
    }
    return count;
  };

  const handleOpenDialog = (category?: Category) => {
    if (category) {
      setSelectedCategory(category);
      setFormData({
        name: category.name,
        description: category.description || '',
        color: category.color || '#3b82f6',
        isActive: category.isActive,
        parentId: category.parentId || '',
      });
    } else {
      setSelectedCategory(null);
      setFormData(initialFormData);
    }
    setDialogOpen(true);
  };

  const handleAddChild = (parent: Category) => {
    setSelectedCategory(null);
    setFormData({
      ...initialFormData,
      parentId: parent.id,
      color: parent.color || '#3b82f6',
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({ title: t.categoriesUi.toastErrorTitle, description: t.categoriesUi.nameRequired, variant: 'destructive' });
      return;
    }

    const existingCategory = categories.find(
      c => c.name.toLowerCase() === formData.name.trim().toLowerCase() && c.id !== selectedCategory?.id
    );
    if (existingCategory) {
      toast({ title: t.categoriesUi.toastErrorTitle, description: t.categoriesUi.duplicateName, variant: 'destructive' });
      return;
    }

    const categoryData = {
      ...formData,
      parentId: formData.parentId || null,
    };

    if (selectedCategory) {
      saveCategory({
        ...selectedCategory,
        ...categoryData,
        updatedAt: new Date().toISOString(),
      });
      toast({
        title: t.categoriesUi.updatedTitle,
        description: t.categoriesUi.updatedDesc.replace('{name}', formData.name),
      });
    } else {
      createCategory(categoryData);
      toast({
        title: t.categoriesUi.createdTitle,
        description: t.categoriesUi.createdDesc.replace('{name}', formData.name),
      });
    }

    setDialogOpen(false);
  };

  const handleDelete = () => {
    if (selectedCategory) {
      const children = getChildren(selectedCategory.id);
      if (children.length > 0) {
        toast({
          title: t.categoriesUi.cannotDeleteTitle,
          description: t.categoriesUi.cannotDeleteHasChildren,
          variant: 'destructive',
        });
        setDeleteDialogOpen(false);
        return;
      }
      const productCount = getProductCount(selectedCategory.name);
      if (productCount > 0) {
        toast({
          title: t.categoriesUi.cannotDeleteTitle,
          description: t.categoriesUi.cannotDeleteHasProducts
            .replace('{count}', String(productCount)),
          variant: 'destructive',
        });
        setDeleteDialogOpen(false);
        return;
      }
      deleteCategory(selectedCategory.id);
      toast({
        title: t.categoriesUi.deletedTitle,
        description: t.categoriesUi.deletedDesc.replace('{name}', selectedCategory.name),
      });
      setDeleteDialogOpen(false);
      setSelectedCategory(null);
    }
  };

  const openDeleteDialog = (category: Category) => {
    setSelectedCategory(category);
    setDeleteDialogOpen(true);
  };

  // Get parent categories (those without a parent) for the select dropdown
  const parentOptions = categories.filter(c => !c.parentId && c.id !== selectedCategory?.id);

  const activeCount = categories.filter(c => c.isActive).length;

  const renderCategoryRow = (category: Category, depth: number = 0) => {
    const children = getChildren(category.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedCategories.has(category.id);
    const totalProducts = getTotalProductCount(category.id, category.name);
    const directProducts = getProductCount(category.name);

    return (
      <React.Fragment key={category.id}>
        <TableRow className={depth > 0 ? 'bg-muted/30' : ''}>
          <TableCell>
            <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 20}px` }}>
              {hasChildren ? (
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => toggleExpand(category.id)}>
                  <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </Button>
              ) : (
                <span className="w-5" />
              )}
              <div
                className="w-5 h-5 rounded-full border-2 border-background shadow-sm"
                style={{ backgroundColor: category.color || '#6b7280' }}
              />
            </div>
          </TableCell>
          <TableCell className="font-medium">
            <div className="flex items-center gap-2">
              {hasChildren ? <FolderOpen className="w-4 h-4 text-muted-foreground" /> : depth > 0 ? null : <Folder className="w-4 h-4 text-muted-foreground" />}
              {category.name}
              {!category.parentId && <Badge variant="outline" className="text-[10px] ml-1">{t.categoriesUi.familyBadge}</Badge>}
            </div>
          </TableCell>
          <TableCell className="text-muted-foreground text-sm">
            {category.description || '-'}
          </TableCell>
          <TableCell className="text-center">
            <Badge variant="secondary">
              {directProducts}{hasChildren ? ` (${totalProducts})` : ''}
            </Badge>
          </TableCell>
          <TableCell>
            <Badge variant={category.isActive ? 'default' : 'secondary'}>
              {category.isActive ? t.categoriesUi.active : t.categoriesUi.inactive}
            </Badge>
          </TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              {!category.parentId && (
                <Button variant="ghost" size="icon" className="h-7 w-7" title={t.categoriesUi.addSubcategory} onClick={() => handleAddChild(category)}>
                  <Plus className="w-3 h-3" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenDialog(category)}>
                <Edit className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDeleteDialog(category)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
        {isExpanded && children.map(child => renderCategoryRow(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t.categoriesUi.title}</h1>
          <p className="text-muted-foreground">
            {t.categoriesUi.subtitle}
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="w-4 h-4 mr-2" />
          {t.categoriesUi.newFamily}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-lg">
                <Tags className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t.categoriesUi.statsTotalCategories}</p>
                <p className="text-2xl font-bold">{categories.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-accent/50 rounded-lg">
                <Tags className="w-6 h-6 text-accent-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t.categoriesUi.statsActive}</p>
                <p className="text-2xl font-bold">{activeCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-secondary rounded-lg">
                <Package className="w-6 h-6 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t.categoriesUi.statsTotalProducts}</p>
                <p className="text-2xl font-bold">{products.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t.categoriesUi.treeTitle}</CardTitle>
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
          {(filteredCategories || rootCategories).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Tags className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{t.categoriesUi.emptyTitle}</p>
              <p className="text-sm mt-1">{t.categoriesUi.emptyHint}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">{t.categoriesUi.colColor}</TableHead>
                  <TableHead>{t.categoriesUi.colName}</TableHead>
                  <TableHead>{t.categoriesUi.colDescription}</TableHead>
                  <TableHead className="text-center">{t.categoriesUi.colProducts}</TableHead>
                  <TableHead>{t.categoriesUi.colStatus}</TableHead>
                  <TableHead className="text-right">{t.categoriesUi.colActions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCategories
                  ? filteredCategories.map(c => renderCategoryRow(c))
                  : rootCategories.map(c => renderCategoryRow(c))
                }
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedCategory
                ? t.categoriesUi.editTitle
                : formData.parentId
                  ? t.categoriesUi.newSubcategoryTitle
                  : t.categoriesUi.newFamilyTitle}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>{t.categoriesUi.parentFamilyLabel}</Label>
              <Select
                value={formData.parentId || '__root__'}
                onValueChange={v => setFormData({ ...formData, parentId: v === '__root__' ? null : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border shadow-lg z-50">
                  <SelectItem value="__root__">{t.categoriesUi.rootOption}</SelectItem>
                  {parentOptions.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="name">{t.categoriesUi.nameLabel}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={formData.parentId ? t.categoriesUi.subcategoryNamePlaceholder : t.categoriesUi.familyNamePlaceholder}
              />
            </div>

            <div>
              <Label htmlFor="description">{t.categoriesUi.descriptionLabel}</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t.categoriesUi.descriptionPlaceholder}
                rows={2}
              />
            </div>

            <div>
              <Label>{t.categoriesUi.colorLabel}</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${
                      formData.color === color
                        ? 'border-foreground scale-110'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setFormData({ ...formData, color })}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Label htmlFor="customColor" className="text-sm">{t.categoriesUi.customColorLabel}</Label>
                <Input
                  id="customColor"
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-12 h-8 p-1 cursor-pointer"
                />
                <span className="text-sm text-muted-foreground">{formData.color}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
              <Label htmlFor="isActive">{t.categoriesUi.activeCategoryLabel}</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit">
                {selectedCategory ? t.common.saveChanges : t.categoriesUi.createCategory}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.categoriesUi.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.categoriesUi.deleteConfirm.replace('{name}', String(selectedCategory?.name || ''))}
              {getProductCount(selectedCategory?.name || '') > 0 && (
                <span className="block mt-2 text-destructive font-medium">
                  {t.categoriesUi.deleteWarnProducts
                    .replace('{count}', String(getProductCount(selectedCategory?.name || '')))}
                </span>
              )}
              {selectedCategory && getChildren(selectedCategory.id).length > 0 && (
                <span className="block mt-2 text-destructive font-medium">
                  {t.categoriesUi.deleteWarnChildren}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
