import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  PieChart, Plus, Edit, Target, TrendingUp, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { useBudgets, type CostCenterRow } from '@/hooks/useBudgets';

const now = new Date();

export default function BudgetControl() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';

  const [activeTab, setActiveTab] = useState('budgets');
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);

  const {
    costCenters,
    budgets,
    loading,
    refresh,
    createCostCenter,
    updateCostCenter,
    saveBudget,
  } = useBudgets(periodYear, periodMonth);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [centerDialogOpen, setCenterDialogOpen] = useState(false);
  const [editingCenter, setEditingCenter] = useState<CostCenterRow | null>(null);
  const [centerForm, setCenterForm] = useState({ code: '', name: '', description: '' });
  const [budgetForm, setBudgetForm] = useState({
    costCenterId: '',
    budgetAmount: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const totalBudget = budgets.reduce((s, b) => s + (b.budgetAmount ?? 0), 0);
  const totalActual = budgets.reduce((s, b) => s + (b.actualAmount ?? 0), 0);
  const overBudgetCount = budgets.filter(b => (b.utilizationPct ?? 0) > 100).length;

  const getUtilizationColor = (pct: number) => {
    if (pct > 100) return 'text-destructive';
    if (pct > 90) return 'text-orange-500';
    if (pct > 70) return 'text-primary';
    return 'text-green-600';
  };

  const getProgressColor = (pct: number) => {
    if (pct > 100) return 'bg-destructive';
    if (pct > 90) return 'bg-orange-500';
    return 'bg-primary';
  };

  const monthLabel = useMemo(() => {
    const d = new Date(periodYear, periodMonth - 1, 1);
    const label = d.toLocaleDateString(uiLocale, { month: 'long', year: 'numeric' });
    return label.slice(0, 1).toUpperCase() + label.slice(1);
  }, [periodYear, periodMonth, uiLocale]);

  const handleSaveBudget = async () => {
    if (!budgetForm.costCenterId) {
      toast.error(t.budgetControlUi.selectCenterPlaceholder);
      return;
    }
    const amount = Number(budgetForm.budgetAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t.budgetControlUi.budgetAmountLabel);
      return;
    }
    setSaving(true);
    try {
      await saveBudget({
        costCenterId: budgetForm.costCenterId,
        periodYear,
        periodMonth,
        budgetAmount: amount,
        notes: budgetForm.notes,
      });
      toast.success(t.budgetControlUi.budgetSet);
      setDialogOpen(false);
      setBudgetForm({ costCenterId: '', budgetAmount: '', notes: '' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.budgetControlUi.budgetSet);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCenter = async () => {
    if (!centerForm.code.trim() || !centerForm.name.trim()) {
      toast.error(t.budgetControlUi.colName);
      return;
    }
    setSaving(true);
    try {
      if (editingCenter) {
        await updateCostCenter(editingCenter.id, {
          name: centerForm.name.trim(),
          description: centerForm.description.trim(),
        });
        toast.success(t.common.saveChanges);
      } else {
        await createCostCenter({
          code: centerForm.code.trim().toUpperCase(),
          name: centerForm.name.trim(),
          description: centerForm.description.trim(),
        });
        toast.success(t.budgetControlUi.newCenter);
      }
      setCenterDialogOpen(false);
      setEditingCenter(null);
      setCenterForm({ code: '', name: '', description: '' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Target className="w-5 h-5" />
              {t.budgetControlUi.title}
            </h1>
            <p className="text-sm text-muted-foreground">{t.budgetControlUi.subtitle}</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t.common.refresh}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 p-4">
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">{t.budgetControlUi.totalBudget}</p>
            <p className="text-xl font-bold">{totalBudget.toLocaleString(uiLocale)} Kz</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">{t.budgetControlUi.actual}</p>
            <p className="text-xl font-bold">{totalActual.toLocaleString(uiLocale)} Kz</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">{t.budgetControlUi.available}</p>
            <p className={`text-xl font-bold ${totalBudget - totalActual >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              {(totalBudget - totalActual).toLocaleString(uiLocale)} Kz
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">{t.budgetControlUi.overBudget}</p>
            <p className={`text-xl font-bold ${overBudgetCount > 0 ? 'text-destructive' : 'text-green-600'}`}>
              {overBudgetCount === 1
                ? t.budgetControlUi.overBudgetCountOne.replace('{count}', String(overBudgetCount))
                : t.budgetControlUi.overBudgetCountOther.replace('{count}', String(overBudgetCount))}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4">
          <TabsTrigger value="budgets" className="gap-1.5">
            <TrendingUp className="w-4 h-4" /> {t.budgetControlUi.tabBudgetVsActual}
          </TabsTrigger>
          <TabsTrigger value="centers" className="gap-1.5">
            <PieChart className="w-4 h-4" /> {t.budgetControlUi.tabCostCenters}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="budgets" className="flex-1 p-4 overflow-auto">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base">{monthLabel}</CardTitle>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="h-8 w-24 text-xs"
                    value={periodYear}
                    onChange={(e) => setPeriodYear(Number(e.target.value) || periodYear)}
                  />
                  <Input
                    type="number"
                    className="h-8 w-16 text-xs"
                    min={1}
                    max={12}
                    value={periodMonth}
                    onChange={(e) => setPeriodMonth(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                  />
                  <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
                    <Plus className="w-3.5 h-3.5" /> {t.budgetControlUi.setBudget}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {budgets.length === 0 && !loading && (
                <p className="text-sm text-muted-foreground text-center py-8">{t.budgetControlUi.selectCenterPlaceholder}</p>
              )}
              {budgets.map(budget => {
                const pct = budget.utilizationPct ?? 0;
                const actual = budget.actualAmount ?? 0;
                const planned = budget.budgetAmount ?? 0;
                return (
                  <div key={budget.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs">{budget.costCenterCode}</Badge>
                        <span className="font-medium text-sm">{budget.costCenterName}</span>
                        {pct > 100 && (
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">
                          {actual.toLocaleString(uiLocale)} / {planned.toLocaleString(uiLocale)} Kz
                        </span>
                        <span className={`font-bold min-w-[50px] text-right ${getUtilizationColor(pct)}`}>
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${getProgressColor(pct)}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="centers" className="flex-1 p-4 overflow-auto">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t.budgetControlUi.costCentersTitle}</CardTitle>
                <Button size="sm" className="gap-1.5" onClick={() => {
                  setEditingCenter(null);
                  setCenterForm({ code: '', name: '', description: '' });
                  setCenterDialogOpen(true);
                }}>
                  <Plus className="w-3.5 h-3.5" /> {t.budgetControlUi.newCenter}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">{t.budgetControlUi.colCode}</TableHead>
                    <TableHead>{t.budgetControlUi.colName}</TableHead>
                    <TableHead>{t.budgetControlUi.colDescription}</TableHead>
                    <TableHead className="w-20 text-center">{t.budgetControlUi.colStatus}</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costCenters.map(cc => (
                    <TableRow key={cc.id}>
                      <TableCell className="font-mono font-medium">{cc.code}</TableCell>
                      <TableCell className="font-medium">{cc.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{cc.description || '—'}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={cc.isActive !== false ? 'default' : 'secondary'}>
                          {cc.isActive !== false ? t.common.active : t.common.inactive}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                          setEditingCenter(cc);
                          setCenterForm({ code: cc.code, name: cc.name, description: cc.description || '' });
                          setCenterDialogOpen(true);
                        }}>
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.budgetControlUi.setBudget}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.budgetControlUi.costCenterLabel}</Label>
              <Select value={budgetForm.costCenterId} onValueChange={(v) => setBudgetForm((f) => ({ ...f, costCenterId: v }))}>
                <SelectTrigger><SelectValue placeholder={t.budgetControlUi.selectCenterPlaceholder} /></SelectTrigger>
                <SelectContent>
                  {costCenters.filter((cc) => cc.isActive !== false).map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>{cc.code} — {cc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t.budgetControlUi.yearLabel}</Label>
                <Input type="number" value={periodYear} readOnly className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>{t.budgetControlUi.monthLabel}</Label>
                <Input type="number" value={periodMonth} readOnly className="bg-muted" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t.budgetControlUi.budgetAmountLabel}</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={budgetForm.budgetAmount}
                onChange={(e) => setBudgetForm((f) => ({ ...f, budgetAmount: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.budgetControlUi.notesLabel}</Label>
              <Textarea
                placeholder={t.budgetControlUi.notesPlaceholder}
                value={budgetForm.notes}
                onChange={(e) => setBudgetForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={() => void handleSaveBudget()} disabled={saving}>
              {saving ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={centerDialogOpen} onOpenChange={setCenterDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCenter ? t.common.edit : t.budgetControlUi.newCenter}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.budgetControlUi.colCode}</Label>
              <Input
                value={centerForm.code}
                onChange={(e) => setCenterForm((f) => ({ ...f, code: e.target.value }))}
                disabled={!!editingCenter}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.budgetControlUi.colName}</Label>
              <Input value={centerForm.name} onChange={(e) => setCenterForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>{t.budgetControlUi.colDescription}</Label>
              <Textarea value={centerForm.description} onChange={(e) => setCenterForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCenterDialogOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={() => void handleSaveCenter()} disabled={saving}>
              {saving ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
