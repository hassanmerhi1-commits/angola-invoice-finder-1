import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useCategories } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import {
  inventoryFoodCategoryLabel,
  mergeInventoryFoodCategorySelectOptions,
  resolveProductCategoryName,
  type CategorySelectOption,
} from '@/lib/inventoryFoodCategories';
import { cn } from '@/lib/utils';

function optionMatches(opt: CategorySelectOption, text: string): boolean {
  const k = text.trim().toLowerCase();
  if (!k) return false;
  return opt.name.toLowerCase() === k || opt.label.toLowerCase() === k;
}

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
  const { categories, createCategory, refreshCategories } = useCategories();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const focusedRef = useRef(false);
  const skipBlurRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const activeCategories = useMemo(() => categories.filter((c) => c.isActive), [categories]);
  const options = useMemo(
    () => mergeInventoryFoodCategorySelectOptions(activeCategories, language),
    [activeCategories, language],
  );
  const selected = resolveProductCategoryName(value, activeCategories, language);
  const selectedLabel = selected ? inventoryFoodCategoryLabel(selected, language) : '';

  useEffect(() => {
    void refreshCategories();
  }, [refreshCategories]);

  useEffect(() => {
    if (focusedRef.current || saving) return;
    setDraft(selectedLabel);
  }, [selectedLabel, saving]);

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) =>
      opt.label.toLowerCase().includes(q) || opt.name.toLowerCase().includes(q),
    );
  }, [draft, options]);

  const exact = options.find((opt) => optionMatches(opt, draft));
  const showCreate = draft.trim().length > 0 && !exact;

  const pick = (opt: CategorySelectOption) => {
    onChange(opt.name);
    setDraft(opt.label);
    setOpen(false);
  };

  const saveNew = async (raw: string) => {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (!name || saving) return;
    const match = options.find((opt) => optionMatches(opt, name));
    if (match) {
      pick(match);
      return;
    }
    const already = categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.isActive);
    if (already) {
      onChange(already.name);
      setDraft(inventoryFoodCategoryLabel(already.name, language));
      setOpen(false);
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
      setDraft(inventoryFoodCategoryLabel(savedName, language));
      setOpen(false);
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

  const commit = (raw: string) => {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (!name) {
      setDraft(selectedLabel);
      setOpen(false);
      return;
    }
    const match = options.find((opt) => optionMatches(opt, name));
    if (match) {
      pick(match);
      return;
    }
    void saveNew(name);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          value={draft}
          disabled={saving}
          placeholder={t.productFormUi.categoryPlaceholder}
          className={cn('w-full text-foreground caret-foreground', triggerClassName)}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            focusedRef.current = true;
            setOpen(true);
          }}
          onBlur={() => {
            focusedRef.current = false;
            window.setTimeout(() => {
              if (skipBlurRef.current) {
                skipBlurRef.current = false;
                return;
              }
              if (focusedRef.current) return;
              const raw = draftRef.current.replace(/\s+/g, ' ').trim();
              if (!raw || raw.toLowerCase() === selectedLabel.toLowerCase() || raw.toLowerCase() === selected.toLowerCase()) {
                setDraft(selectedLabel);
                return;
              }
              commit(draftRef.current);
            }, 120);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft);
            }
            if (e.key === 'Escape') {
              setDraft(selectedLabel);
              setOpen(false);
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className={cn('z-[80] w-[var(--radix-popover-trigger-width)] p-0', contentClassName)}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-[min(60vh,240px)] overflow-y-auto py-1">
          {filtered.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
              onMouseDown={(e) => {
                e.preventDefault();
                skipBlurRef.current = true;
                pick(opt);
              }}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: activeCategories.find((c) => c.id === opt.key)?.color || '#6b7280' }}
              />
              {opt.label}
            </button>
          ))}
          {showCreate ? (
            <button
              type="button"
              className="w-full px-2 py-1.5 text-left text-sm text-primary hover:bg-accent"
              onMouseDown={(e) => {
                e.preventDefault();
                skipBlurRef.current = true;
                void saveNew(draft);
              }}
            >
              {t.productFormUi.createCategory}: {draft.trim()}
            </button>
          ) : null}
          {!filtered.length && !showCreate ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{t.productFormUi.categoryPlaceholder}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
