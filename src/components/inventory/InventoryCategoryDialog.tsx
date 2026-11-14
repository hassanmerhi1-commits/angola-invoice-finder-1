import { useEffect, useMemo, useState } from 'react';
import { Product, Category } from '@/types/erp';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api/client';
import { useCategories } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

function cleanName(raw: string) {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function nameKey(raw: string) {
  return cleanName(raw).toLowerCase();
}

function skuKey(raw: string) {
  return String(raw || '').trim().toLowerCase();
}

type CategoryRow = {
  key: string;
  name: string;
  count: number;
  saved: boolean;
};

export function InventoryCategoryDialog({
  open,
  onOpenChange,
  products,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  onApplied?: () => void;
}) {
  const { t } = useTranslation();
  const ui = t.inventoryPageUi.categoryManager;
  const { categories, createCategory, refreshCategories } = useCategories();
  const [categoryQuery, setCategoryQuery] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [addQuery, setAddQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteMoveTo, setDeleteMoveTo] = useState('');
  const [forceMove, setForceMove] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void refreshCategories();
    setChecked(new Set());
    setToAdd(new Set());
    setAddQuery('');
    setProductQuery('');
  }, [open, refreshCategories]);

  const catalog = useMemo(() => {
    const bySku = new Map<string, Product>();
    for (const product of products) {
      const key = skuKey(product.sku) || product.id;
      if (!key || bySku.has(key)) continue;
      bySku.set(key, product);
    }
    return [...bySku.values()];
  }, [products]);

  const rows = useMemo(() => {
    const map = new Map<string, CategoryRow>();
    for (const category of categories) {
      if (!category.isActive) continue;
      const name = cleanName(category.name);
      const key = nameKey(name);
      if (!key || map.has(key)) continue;
      map.set(key, { key, name, count: 0, saved: true });
    }
    let uncategorized = 0;
    for (const product of catalog) {
      const name = cleanName(product.category || '');
      const key = nameKey(name);
      if (!key) {
        uncategorized += 1;
        continue;
      }
      const row = map.get(key);
      if (row) row.count += 1;
      else map.set(key, { key, name, count: 1, saved: false });
    }
    const list = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    if (uncategorized > 0) {
      list.unshift({ key: '', name: '', count: uncategorized, saved: false });
    }
    return list;
  }, [categories, catalog]);

  useEffect(() => {
    if (!open) return;
    if (rows.some((row) => row.key === selectedKey)) return;
    const first = rows.find((row) => row.key) || rows[0];
    setSelectedKey(first?.key ?? '');
  }, [open, rows, selectedKey]);

  const selected = rows.find((row) => row.key === selectedKey) || null;

  useEffect(() => {
    setRenameDraft(selected?.name || '');
    setChecked(new Set());
    setToAdd(new Set());
    setMoveTo('');
    setProductQuery('');
    setAddQuery('');
  }, [selected?.key, selected?.name]);

  const visibleRows = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const label = row.key ? row.name : ui.uncategorized;
      return label.toLowerCase().includes(q);
    });
  }, [rows, categoryQuery, ui.uncategorized]);

  const inCategory = useMemo(() => {
    return catalog.filter((product) => nameKey(product.category || '') === selectedKey);
  }, [catalog, selectedKey]);

  const visibleProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    const list = !q
      ? inCategory
      : inCategory.filter((product) =>
        product.name.toLowerCase().includes(q) || skuKey(product.sku).includes(q),
      );
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [inCategory, productQuery]);

  const addMatches = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (q.length < 1 || !selectedKey) return [];
    return catalog
      .filter((product) => nameKey(product.category || '') !== selectedKey)
      .filter((product) => product.name.toLowerCase().includes(q) || skuKey(product.sku).includes(q))
      .slice(0, 30);
  }, [addQuery, catalog, selectedKey]);

  const otherCategories = rows.filter((row) => row.key && row.key !== selectedKey);

  const fail = (error: unknown) => {
    const code = error instanceof Error ? error.message : String(error || '');
    const description = code === 'duplicate_name'
      ? ui.duplicate
      : code === 'destination_required'
        ? ui.needDestination
        : code === 'name_required'
          ? ui.nameRequired
          : (code || ui.failed);
    toast.error(ui.failed, { description });
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await refreshCategories();
      onApplied?.();
    } catch (error) {
      if (error instanceof Error && error.message === 'destination_required') {
        setForceMove(true);
        setDeleteOpen(true);
        return;
      }
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const applyOrThrow = async (body: Parameters<typeof api.categories.apply>[0]) => {
    const result = await api.categories.apply(body);
    if (result.error || !result.data) throw new Error(result.error || ui.failed);
    return result.data;
  };

  const create = () => {
    const name = cleanName(newName);
    if (!name) {
      toast.error(ui.nameRequired);
      return;
    }
    void run(async () => {
      await createCategory({
        name,
        description: '',
        color: '#3b82f6',
        isActive: true,
        parentId: null,
      } as Omit<Category, 'id' | 'createdAt' | 'updatedAt'>);
      setNewName('');
      setSelectedKey(nameKey(name));
      toast.success(t.categoriesUi.createdTitle, { description: name });
    });
  };

  const rename = () => {
    if (!selected?.key) return;
    const next = cleanName(renameDraft);
    if (!next) {
      toast.error(ui.nameRequired);
      return;
    }
    if (nameKey(next) === selected.key && next === selected.name) return;
    void run(async () => {
      await applyOrThrow({ action: 'rename', name: selected.name, nextName: next });
      setSelectedKey(nameKey(next));
      toast.success(ui.renamed.replace('{name}', next));
    });
  };

  const assign = (skus: string[], successCount: number) => {
    if (!selected?.key || skus.length === 0) return;
    void run(async () => {
      const data = await applyOrThrow({ action: 'assign', name: selected.name, skus });
      setToAdd(new Set());
      setAddQuery('');
      setChecked(new Set());
      toast.success(ui.assigned.replace('{count}', String(data.skus || successCount)));
    });
  };

  const moveChecked = () => {
    const dest = otherCategories.find((row) => row.key === moveTo);
    if (!dest) {
      toast.error(ui.needDestination);
      return;
    }
    const skus = inCategory.filter((product) => checked.has(skuKey(product.sku) || product.id)).map((product) => product.sku);
    if (skus.length === 0) return;
    void run(async () => {
      const data = await applyOrThrow({ action: 'assign', name: dest.name, skus });
      setChecked(new Set());
      toast.success(ui.assigned.replace('{count}', String(data.skus || skus.length)));
    });
  };

  const confirmDelete = () => {
    if (!selected?.key) return;
    const dest = otherCategories.find((row) => row.key === deleteMoveTo);
    if ((selected.count > 0 || forceMove) && !dest) {
      toast.error(ui.needDestination);
      return;
    }
    void run(async () => {
      await applyOrThrow({
        action: 'delete',
        name: selected.name,
        nextName: dest?.name,
      });
      setDeleteOpen(false);
      setDeleteMoveTo('');
      setForceMove(false);
      setSelectedKey('');
      toast.success(ui.deleted);
    });
  };

  const toggle = (set: Set<string>, key: string, setter: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const allVisibleChecked = visibleProducts.length > 0
    && visibleProducts.every((product) => checked.has(skuKey(product.sku) || product.id));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(86vh,760px)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="space-y-1 px-5 pb-3 pt-5 pr-12">
            <DialogTitle>{ui.title}</DialogTitle>
            <DialogDescription>{ui.hint}</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(200px,240px)_1fr] border-t">
            <aside className="flex min-h-0 flex-col border-r">
              <div className="space-y-2 border-b p-3">
                <div className="flex gap-1.5">
                  <Input
                    value={newName}
                    placeholder={ui.newPlaceholder}
                    className="h-8 text-sm"
                    disabled={busy}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        create();
                      }
                    }}
                  />
                  <Button type="button" size="sm" className="h-8 shrink-0" disabled={busy} onClick={create}>
                    {ui.create}
                  </Button>
                </div>
                <Input
                  value={categoryQuery}
                  placeholder={ui.searchCategories}
                  className="h-8 text-sm"
                  onChange={(e) => setCategoryQuery(e.target.value)}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {visibleRows.map((row) => {
                  const label = row.key ? row.name : ui.uncategorized;
                  const active = row.key === selectedKey;
                  return (
                    <button
                      key={row.key || '__none__'}
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                        active && 'bg-accent font-medium',
                      )}
                      onClick={() => setSelectedKey(row.key)}
                    >
                      <span className="min-w-0 truncate">{label}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{row.count}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
            <section className="flex min-h-0 flex-col">
              {!selected ? (
                <p className="p-5 text-sm text-muted-foreground">{ui.empty}</p>
              ) : (
                <>
                  <div className="space-y-2 border-b p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {selected.key ? (
                        <>
                          <Input
                            value={renameDraft}
                            className="h-8 max-w-xs text-sm"
                            disabled={busy}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                rename();
                              }
                            }}
                          />
                          <Button type="button" size="sm" className="h-8" disabled={busy} onClick={rename}>
                            {ui.saveName}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={busy}
                            onClick={() => {
                              setDeleteMoveTo('');
                              setDeleteOpen(true);
                            }}
                          >
                            {ui.delete}
                          </Button>
                          {!selected.saved ? (
                            <span className="text-xs text-muted-foreground">{ui.onProductsOnly}</span>
                          ) : null}
                        </>
                      ) : (
                        <p className="text-sm font-medium">{ui.uncategorized}</p>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {ui.productCount.replace('{count}', String(selected.count))}
                      </span>
                    </div>
                    {selected.key ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={addQuery}
                          placeholder={ui.addSearch}
                          className="h-8 max-w-sm text-sm"
                          disabled={busy}
                          onChange={(e) => setAddQuery(e.target.value)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          disabled={busy || toAdd.size === 0}
                          onClick={() => assign([...toAdd], toAdd.size)}
                        >
                          {ui.add.replace('{count}', String(toAdd.size))}
                        </Button>
                      </div>
                    ) : null}
                    {addMatches.length > 0 ? (
                      <div className="max-h-36 overflow-y-auto rounded-md border">
                        {addMatches.map((product) => {
                          const key = skuKey(product.sku) || product.id;
                          return (
                            <label key={key} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-accent">
                              <Checkbox
                                checked={toAdd.has(product.sku)}
                                onCheckedChange={() => toggle(toAdd, product.sku, setToAdd)}
                              />
                              <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground">{product.sku}</span>
                              <span className="min-w-0 flex-1 truncate">{product.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 border-b px-3 py-2">
                    <Input
                      value={productQuery}
                      placeholder={ui.searchProducts}
                      className="h-8 max-w-sm text-sm"
                      onChange={(e) => setProductQuery(e.target.value)}
                    />
                    <Select value={moveTo} onValueChange={setMoveTo} disabled={busy || otherCategories.length === 0}>
                      <SelectTrigger className="h-8 w-48 text-sm">
                        <SelectValue placeholder={ui.moveSelected} />
                      </SelectTrigger>
                      <SelectContent>
                        {otherCategories.map((row) => (
                          <SelectItem key={row.key} value={row.key}>{row.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" size="sm" className="h-8" disabled={busy || checked.size === 0} onClick={moveChecked}>
                      {ui.move}
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {visibleProducts.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">{ui.noProducts}</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background">
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="w-10 px-3 py-2">
                              <Checkbox
                                checked={allVisibleChecked}
                                onCheckedChange={(value) => {
                                  const next = new Set(checked);
                                  for (const product of visibleProducts) {
                                    const key = skuKey(product.sku) || product.id;
                                    if (value) next.add(key);
                                    else next.delete(key);
                                  }
                                  setChecked(next);
                                }}
                              />
                            </th>
                            <th className="w-28 py-2 font-medium">SKU</th>
                            <th className="py-2 font-medium" />
                          </tr>
                        </thead>
                        <tbody>
                          {visibleProducts.map((product) => {
                            const key = skuKey(product.sku) || product.id;
                            return (
                              <tr key={key} className="border-b last:border-0">
                                <td className="px-3 py-1.5">
                                  <Checkbox
                                    checked={checked.has(key)}
                                    onCheckedChange={() => toggle(checked, key, setChecked)}
                                  />
                                </td>
                                <td className="truncate py-1.5 font-mono text-xs text-muted-foreground">{product.sku}</td>
                                <td className="truncate py-1.5 pr-3">{product.name}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ui.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {selected && (selected.count > 0 || forceMove)
                ? ui.deleteHint.replace('{name}', selected.name)
                : ui.deleteEmpty.replace('{name}', selected?.name || '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selected && (selected.count > 0 || forceMove) ? (
            <Select value={deleteMoveTo} onValueChange={setDeleteMoveTo}>
              <SelectTrigger>
                <SelectValue placeholder={ui.moveTo} />
              </SelectTrigger>
              <SelectContent>
                {otherCategories.map((row) => (
                  <SelectItem key={row.key} value={row.key}>{row.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); confirmDelete(); }}>
              {ui.confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
