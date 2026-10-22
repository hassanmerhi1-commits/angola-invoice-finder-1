import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useCategories } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import {
  mergeInventoryFoodCategorySelectOptions,
  resolveProductCategoryName,
} from '@/lib/inventoryFoodCategories';
import { cn } from '@/lib/utils';

const NEW_VALUE = '__nexor_new_category__';

export function ProductCategoryField({
  value,
  onChange,
  triggerClassName,
  contentClassName,
}: {
  value: string;
  onChange: (categoryName: string) => void;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const { categories, createCategory } = useCategories();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const activeCategories = useMemo(() => categories.filter((c) => c.isActive), [categories]);
  const options = useMemo(
    () => mergeInventoryFoodCategorySelectOptions(activeCategories, language),
    [activeCategories, language],
  );
  const selected = resolveProductCategoryName(value, activeCategories, language);

  const startCreate = () => {
    setNewName('');
    setCreating(true);
  };

  const saveNew = async () => {
    const name = newName.replace(/\s+/g, ' ').trim();
    if (!name) {
      toast({ title: t.categoriesUi.toastErrorTitle, description: t.categoriesUi.nameRequired, variant: 'destructive' });
      return;
    }
    const duplicate = categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      toast({ title: t.categoriesUi.toastErrorTitle, description: t.categoriesUi.duplicateName, variant: 'destructive' });
      onChange(name);
      setCreating(false);
      return;
    }
    setSaving(true);
    try {
      const created = await createCategory({
        name,
        description: '',
        color: '#3b82f6',
        isActive: true,
        parentId: null,
      });
      const savedName = String(created?.name || name).replace(/\s+/g, ' ').trim();
      onChange(savedName);
      setCreating(false);
      setNewName('');
      toast({
        title: t.categoriesUi.createdTitle,
        description: t.categoriesUi.createdDesc.replace('{name}', savedName),
      });
    } catch (error) {
      toast({
        title: t.productFormUi.errorTitle,
        description: error instanceof Error ? error.message : t.productFormUi.categoryCreateFailed,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Select
          value={selected}
          onValueChange={(next) => {
            if (next === NEW_VALUE) {
              startCreate();
              return;
            }
            onChange(next);
          }}
        >
          <SelectTrigger className={cn('min-w-0 flex-1', triggerClassName)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={cn('max-h-[min(60vh,320px)]', contentClassName)}>
            <SelectItem value={NEW_VALUE}>
              <span className="flex items-center gap-1.5 text-primary">
                <Plus className="h-3.5 w-3.5" />
                {t.productFormUi.newCategory}
              </span>
            </SelectItem>
            {options.map((opt) => {
              const cat = activeCategories.find((c) => c.id === opt.key);
              return (
                <SelectItem key={opt.key} value={opt.name}>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: cat?.color || '#6b7280' }}
                    />
                    {opt.label}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn('shrink-0', triggerClassName?.includes('h-8') ? 'h-8 w-8' : 'h-10 w-10')}
          title={t.productFormUi.newCategory}
          onClick={startCreate}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {creating ? (
        <div className="space-y-1.5">
          <Input
            autoFocus
            value={newName}
            placeholder={t.productFormUi.newCategoryPlaceholder}
            className="h-9 w-full min-w-0 px-3 text-sm text-foreground bg-background caret-foreground"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveNew();
              }
              if (e.key === 'Escape') setCreating(false);
            }}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" className="h-8 shrink-0" disabled={saving} onClick={() => void saveNew()}>
              {t.productFormUi.createCategory}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0" disabled={saving} onClick={() => setCreating(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
