import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/hooks/useERP';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Lock, Unlock, Calendar, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AccountingPeriod } from '@/types/erp';
import { useTranslation } from '@/i18n';

function useAccountingPeriods(formatPeriodName: (month: number, year: number) => string) {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);

  const refresh = useCallback(() => {
    try {
      const stored = localStorage.getItem('kwanzaerp_accounting_periods');
      if (stored) {
        setPeriods(JSON.parse(stored));
      } else {
        // Initialize current year periods
        const year = new Date().getFullYear();
        const initial: AccountingPeriod[] = Array.from({ length: 12 }, (_, i) => ({
          id: `period_${year}_${i + 1}`,
          year,
          month: i + 1,
          name: formatPeriodName(i + 1, year),
          status: 'open' as const,
        }));
        localStorage.setItem('kwanzaerp_accounting_periods', JSON.stringify(initial));
        setPeriods(initial);
      }
    } catch { setPeriods([]); }
  }, [formatPeriodName]);

  useEffect(() => { refresh(); }, [refresh]);

  const closePeriod = useCallback((periodId: string, userId: string) => {
    const all: AccountingPeriod[] = JSON.parse(localStorage.getItem('kwanzaerp_accounting_periods') || '[]');
    const idx = all.findIndex(p => p.id === periodId);
    if (idx >= 0) {
      all[idx].status = 'closed';
      all[idx].closedBy = userId;
      all[idx].closedAt = new Date().toISOString();
      localStorage.setItem('kwanzaerp_accounting_periods', JSON.stringify(all));
      refresh();
    }
  }, [refresh]);

  const lockPeriod = useCallback((periodId: string) => {
    const all: AccountingPeriod[] = JSON.parse(localStorage.getItem('kwanzaerp_accounting_periods') || '[]');
    const idx = all.findIndex(p => p.id === periodId);
    if (idx >= 0) {
      all[idx].status = 'locked';
      localStorage.setItem('kwanzaerp_accounting_periods', JSON.stringify(all));
      refresh();
    }
  }, [refresh]);

  const reopenPeriod = useCallback((periodId: string) => {
    const all: AccountingPeriod[] = JSON.parse(localStorage.getItem('kwanzaerp_accounting_periods') || '[]');
    const idx = all.findIndex(p => p.id === periodId);
    if (idx >= 0) {
      all[idx].status = 'open';
      all[idx].closedBy = undefined;
      all[idx].closedAt = undefined;
      localStorage.setItem('kwanzaerp_accounting_periods', JSON.stringify(all));
      refresh();
    }
  }, [refresh]);

  return { periods, closePeriod, lockPeriod, reopenPeriod, refresh };
}

export default function AccountingPeriods() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; periodId: string; periodName: string } | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const monthName = (month: number) =>
    new Date(2000, month - 1, 1).toLocaleString(uiLocale, { month: 'long' });

  const formatPeriodName = (month: number, year: number) =>
    `${monthName(month)} ${year}`;

  const { periods, closePeriod, lockPeriod, reopenPeriod } = useAccountingPeriods(formatPeriodName);

  const yearPeriods = periods.filter(p => p.year === selectedYear).sort((a, b) => a.month - b.month);
  const openCount = yearPeriods.filter(p => p.status === 'open').length;
  const closedCount = yearPeriods.filter(p => p.status === 'closed').length;
  const lockedCount = yearPeriods.filter(p => p.status === 'locked').length;

  const handleConfirm = () => {
    if (!confirmDialog) return;
    const { action, periodId, periodName } = confirmDialog;

    if (action === 'close') {
      closePeriod(periodId, user?.id || '');
      toast.success(t.accountingPeriodsUi.toastClosed.replace('{period}', periodName));
    } else if (action === 'lock') {
      lockPeriod(periodId);
      toast.success(t.accountingPeriodsUi.toastLocked.replace('{period}', periodName));
    } else if (action === 'reopen') {
      reopenPeriod(periodId);
      toast.success(t.accountingPeriodsUi.toastReopened.replace('{period}', periodName));
    }
    setConfirmDialog(null);
  };

  return (
    <div className="flex flex-col h-full bg-background p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t.accountingPeriodsUi.title}</h1>
          <p className="text-sm text-muted-foreground">{t.accountingPeriodsUi.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelectedYear(y => y - 1)}>
            ← {selectedYear - 1}
          </Button>
          <span className="font-bold text-lg px-3">{selectedYear}</span>
          <Button variant="outline" size="sm" onClick={() => setSelectedYear(y => y + 1)}>
            {selectedYear + 1} →
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <Calendar className="w-8 h-8 text-green-500" />
            <div>
              <p className="text-2xl font-bold">{openCount}</p>
              <p className="text-xs text-muted-foreground">{t.accountingPeriodsUi.openPeriods}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-orange-500" />
            <div>
              <p className="text-2xl font-bold">{closedCount}</p>
              <p className="text-xs text-muted-foreground">{t.accountingPeriodsUi.closedPeriods}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <Lock className="w-8 h-8 text-red-500" />
            <div>
              <p className="text-2xl font-bold">{lockedCount}</p>
              <p className="text-xs text-muted-foreground">{t.accountingPeriodsUi.lockedPeriods}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Period Grid */}
      <div className="grid grid-cols-3 gap-3 flex-1">
        {yearPeriods.map(period => {
          const isCurrentMonth = period.year === new Date().getFullYear() && period.month === new Date().getMonth() + 1;
          return (
            <Card key={period.id} className={cn(
              "transition-all",
              isCurrentMonth && "ring-2 ring-primary",
              period.status === 'locked' && "opacity-60"
            )}>
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{monthName(period.month)}</span>
                  <Badge variant={period.status === 'open' ? 'default' : period.status === 'closed' ? 'secondary' : 'destructive'} className="text-xs">
                    {period.status === 'open'
                      ? t.accountingPeriodsUi.statusOpen
                      : period.status === 'closed'
                        ? t.accountingPeriodsUi.statusClosed
                        : t.accountingPeriodsUi.statusLocked}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                {period.closedAt && (
                  <p className="text-xs text-muted-foreground mb-2">
                    {t.accountingPeriodsUi.closedAtLabel}: {new Date(period.closedAt).toLocaleDateString(uiLocale)}
                  </p>
                )}
                <div className="flex gap-1">
                  {period.status === 'open' && (
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1 flex-1"
                      onClick={() => setConfirmDialog({ action: 'close', periodId: period.id, periodName: period.name })}>
                      <CheckCircle className="w-3 h-3" /> {t.accountingPeriodsUi.close}
                    </Button>
                  )}
                  {period.status === 'closed' && (
                    <>
                      <Button size="sm" variant="outline" className="text-xs h-7 gap-1 flex-1"
                        onClick={() => setConfirmDialog({ action: 'reopen', periodId: period.id, periodName: period.name })}>
                        <Unlock className="w-3 h-3" /> {t.accountingPeriodsUi.reopen}
                      </Button>
                      <Button size="sm" variant="destructive" className="text-xs h-7 gap-1 flex-1"
                        onClick={() => setConfirmDialog({ action: 'lock', periodId: period.id, periodName: period.name })}>
                        <Lock className="w-3 h-3" /> {t.accountingPeriodsUi.lock}
                      </Button>
                    </>
                  )}
                  {period.status === 'locked' && (
                    <p className="text-xs text-muted-foreground italic">{t.accountingPeriodsUi.permanentlyLocked}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Confirm Dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              {t.accountingPeriodsUi.confirmTitle}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {confirmDialog?.action === 'close' &&
              t.accountingPeriodsUi.confirmClose.replace('{period}', confirmDialog.periodName)}
            {confirmDialog?.action === 'lock' &&
              t.accountingPeriodsUi.confirmLock.replace('{period}', confirmDialog.periodName)}
            {confirmDialog?.action === 'reopen' &&
              t.accountingPeriodsUi.confirmReopen.replace('{period}', confirmDialog.periodName)}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>{t.accountingPeriodsUi.cancel}</Button>
            <Button variant={confirmDialog?.action === 'lock' ? 'destructive' : 'default'} onClick={handleConfirm}>
              {t.accountingPeriodsUi.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
