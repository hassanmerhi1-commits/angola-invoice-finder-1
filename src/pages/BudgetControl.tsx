import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  PieChart, Plus, Edit, Target, TrendingUp, AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';

// Demo data
const DEMO_COST_CENTERS = [
  { id: '1', code: 'ADM', name_key: 'demoAdmin', desc_key: 'demoAdminDesc', is_active: true },
  { id: '2', code: 'COM', name_key: 'demoCommercial', desc_key: 'demoCommercialDesc', is_active: true },
  { id: '3', code: 'LOG', name_key: 'demoLogistics', desc_key: 'demoLogisticsDesc', is_active: true },
  { id: '4', code: 'PRD', name_key: 'demoProduction', desc_key: 'demoProductionDesc', is_active: true },
  { id: '5', code: 'TI', name_key: 'demoTechnology', desc_key: 'demoTechnologyDesc', is_active: true },
];

const DEMO_BUDGETS = [
  { id: '1', cost_center_code: 'ADM', cost_center_name_key: 'demoAdmin', period_month: 3, budget_amount: 500000, actual_amount: 420000, utilization_pct: 84 },
  { id: '2', cost_center_code: 'COM', cost_center_name_key: 'demoCommercial', period_month: 3, budget_amount: 800000, actual_amount: 750000, utilization_pct: 93.8 },
  { id: '3', cost_center_code: 'LOG', cost_center_name_key: 'demoLogistics', period_month: 3, budget_amount: 1200000, actual_amount: 980000, utilization_pct: 81.7 },
  { id: '4', cost_center_code: 'PRD', cost_center_name_key: 'demoProduction', period_month: 3, budget_amount: 2000000, actual_amount: 2150000, utilization_pct: 107.5 },
  { id: '5', cost_center_code: 'TI', cost_center_name_key: 'demoTechnology', period_month: 3, budget_amount: 300000, actual_amount: 180000, utilization_pct: 60 },
];

export default function BudgetControl() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';

  const [activeTab, setActiveTab] = useState('budgets');
  const costCenters = useMemo(() => (
    DEMO_COST_CENTERS.map((cc) => ({
      ...cc,
      name: t.budgetControlUi[cc.name_key as keyof typeof t.budgetControlUi] as string,
      description: t.budgetControlUi[cc.desc_key as keyof typeof t.budgetControlUi] as string,
    }))
  ), [t]);

  const budgets = useMemo(() => (
    DEMO_BUDGETS.map((b) => ({
      ...b,
      cost_center_name: t.budgetControlUi[b.cost_center_name_key as keyof typeof t.budgetControlUi] as string,
    }))
  ), [t]);

  const [dialogOpen, setDialogOpen] = useState(false);

  const totalBudget = budgets.reduce((s, b) => s + b.budget_amount, 0);
  const totalActual = budgets.reduce((s, b) => s + b.actual_amount, 0);
  const overBudgetCount = budgets.filter(b => b.utilization_pct > 100).length;

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
    const d = new Date(2026, 2, 1); // March 2026
    const label = d.toLocaleDateString(uiLocale, { month: 'long', year: 'numeric' });
    return label.slice(0, 1).toUpperCase() + label.slice(1);
  }, [uiLocale]);

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
        </div>
      </div>

      {/* Summary Cards */}
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
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{monthLabel}</CardTitle>
                <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
                  <Plus className="w-3.5 h-3.5" /> {t.budgetControlUi.setBudget}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {budgets.map(budget => (
                <div key={budget.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">{budget.cost_center_code}</Badge>
                      <span className="font-medium text-sm">{budget.cost_center_name}</span>
                      {budget.utilization_pct > 100 && (
                        <AlertTriangle className="w-4 h-4 text-destructive" />
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground">
                        {budget.actual_amount.toLocaleString(uiLocale)} / {budget.budget_amount.toLocaleString(uiLocale)} Kz
                      </span>
                      <span className={`font-bold min-w-[50px] text-right ${getUtilizationColor(budget.utilization_pct)}`}>
                        {budget.utilization_pct}%
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${getProgressColor(budget.utilization_pct)}`}
                      style={{ width: `${Math.min(budget.utilization_pct, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="centers" className="flex-1 p-4 overflow-auto">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t.budgetControlUi.costCentersTitle}</CardTitle>
                <Button size="sm" className="gap-1.5">
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
                      <TableCell className="text-sm text-muted-foreground">{cc.description}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={cc.is_active ? 'default' : 'secondary'}>
                          {cc.is_active ? t.common.active : t.common.inactive}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
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

      {/* Budget Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.budgetControlUi.setBudget}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.budgetControlUi.costCenterLabel}</Label>
              <Input placeholder={t.budgetControlUi.selectCenterPlaceholder} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t.budgetControlUi.yearLabel}</Label>
                <Input type="number" defaultValue={2026} />
              </div>
              <div className="space-y-2">
                <Label>{t.budgetControlUi.monthLabel}</Label>
                <Input type="number" defaultValue={3} min={1} max={12} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t.budgetControlUi.budgetAmountLabel}</Label>
              <Input type="number" placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>{t.budgetControlUi.notesLabel}</Label>
              <Textarea placeholder={t.budgetControlUi.notesPlaceholder} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t.common.cancel}</Button>
            <Button
              onClick={() => { setDialogOpen(false); toast.success(t.budgetControlUi.budgetSet); }}
            >
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
