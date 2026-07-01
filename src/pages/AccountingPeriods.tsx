import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/hooks/useERP';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Lock, Unlock, Calendar, CheckCircle, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AccountingPeriod } from '@/types/erp';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';

function mapPeriodRow(row: Record<string, unknown>): AccountingPeriod {
  const status = String(row.status || 'open');
  return {
    id: String(row.id),
    year: Number(row.year),
    month: Number(row.month),
    name: String(row.name || ''),
    status: status === 'closed' || status === 'locked' ? status : 'open',
    closedBy: row.closed_by != null ? String(row.closed_by) : undefined,
    closedAt: row.closed_at != null ? String(row.closed_at) : undefined,
  };
}

function useAccountingPeriods(year: number) {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.payments.periods(year);
      if (res.error) {
        setError(res.error);
        setPeriods([]);
        return;
      }
      const rows = Array.isArray(res.data) ? res.data : [];
      setPeriods(
        rows
          .map((row) => mapPeriodRow(row as Record<string, unknown>))
          .sort((a, b) => a.month - b.month),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load periods');
      setPeriods([]);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const closePeriod = useCallback(async (periodId: string, userId: string) => {
    const res = await api.payments.closePeriod(periodId, userId);
    if (res.error) throw new Error(res.error);
    await refresh();
  }, [refresh]);

  const lockPeriod = useCallback(async (periodId: string) => {
    const res = await api.payments.lockPeriod(periodId);
    if (res.error) throw new Error(res.error);
    await refresh();
  }, [refresh]);

  const reopenPeriod = useCallback(async (periodId: string) => {
    const res = await api.payments.reopenPeriod(periodId);
    if (res.error) throw new Error(res.error);
    await refresh();
  }, [refresh]);

  return { periods, loading, error, closePeriod, lockPeriod, reopenPeriod, refresh };
}

export default function AccountingPeriods() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; periodId: string; periodName: string } | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [acting, setActing] = useState(false);

  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const monthName = (month: number) =>
    new Date(2000, month - 1, 1).toLocaleString(uiLocale, { month: 'long' });

  const { periods, loading, error, closePeriod, lockPeriod, reopenPeriod, refresh } =
    useAccountingPeriods(selectedYear);

  const openCount = periods.filter((p) => p.status === 'open').length;
  const closedCount = periods.filter((p) => p.status === 'closed').length;
  const lockedCount = periods.filter((p) => p.status === 'locked').length;

  const handleConfirm = async () => {
    if (!confirmDialog || acting) return;
    const { action, periodId, periodName } = confirmDialog;
    setActing(true);
    try {
      if (action === 'close') {
        await closePeriod(periodId, user?.id || '');
        toast.success(t.accountingPeriodsUi.toastClosed.replace('{period}', periodName));
      } else if (action === 'lock') {
        await lockPeriod(periodId);
        toast.success(t.accountingPeriodsUi.toastLocked.replace('{period}', periodName));
      } else if (action === 'reopen') {
        await reopenPeriod(periodId);
        toast.success(t.accountingPeriodsUi.toastReopened.replace('{period}', periodName));
      }
      setConfirmDialog(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.accountingPeriodsUi.actionFailed);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t.accountingPeriodsUi.title}</h1>
          <p className="text-sm text-muted-foreground">{t.accountingPeriodsUi.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelectedYear((y) => y - 1)}>
            ← {selectedYear - 1}
          </Button>
          <span className="font-bold text-lg px-3">{selectedYear}</span>
          <Button variant="outline" size="sm" onClick={() => setSelectedYear((y) => y + 1)}>
            {selectedYear + 1} →
          </Button>
        </div>
      </div>

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

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4 pb-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading && periods.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          {t.accountingPeriodsUi.loading}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 flex-1">
          {periods.map((period) => {
            const isCurrentMonth =
              period.year === new Date().getFullYear() && period.month === new Date().getMonth() + 1;
            const displayName = period.name || `${monthName(period.month)} ${period.year}`;
            return (
              <Card
                key={period.id}
                className={cn(
                  'transition-all',
                  isCurrentMonth && 'ring-2 ring-primary',
                  period.status === 'locked' && 'opacity-60',
                )}
              >
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{monthName(period.month)}</span>
                    <Badge
                      variant={
                        period.status === 'open'
                          ? 'default'
                          : period.status === 'closed'
                            ? 'secondary'
                            : 'destructive'
                      }
                      className="text-xs"
                    >
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
                      {t.accountingPeriodsUi.closedAtLabel}:{' '}
                      {new Date(period.closedAt).toLocaleDateString(uiLocale)}
                    </p>
                  )}
                  <div className="flex gap-1">
                    {period.status === 'open' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 gap-1 flex-1"
                        disabled={acting}
                        onClick={() =>
                          setConfirmDialog({ action: 'close', periodId: period.id, periodName: displayName })
                        }
                      >
                        <CheckCircle className="w-3 h-3" /> {t.accountingPeriodsUi.close}
                      </Button>
                    )}
                    {period.status === 'closed' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 gap-1 flex-1"
                          disabled={acting}
                          onClick={() =>
                            setConfirmDialog({ action: 'reopen', periodId: period.id, periodName: displayName })
                          }
                        >
                          <Unlock className="w-3 h-3" /> {t.accountingPeriodsUi.reopen}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="text-xs h-7 gap-1 flex-1"
                          disabled={acting}
                          onClick={() =>
                            setConfirmDialog({ action: 'lock', periodId: period.id, periodName: displayName })
                          }
                        >
                          <Lock className="w-3 h-3" /> {t.accountingPeriodsUi.lock}
                        </Button>
                      </>
                    )}
                    {period.status === 'locked' && (
                      <p className="text-xs text-muted-foreground italic">
                        {t.accountingPeriodsUi.permanentlyLocked}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!confirmDialog} onOpenChange={() => !acting && setConfirmDialog(null)}>
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
            <Button variant="outline" onClick={() => setConfirmDialog(null)} disabled={acting}>
              {t.accountingPeriodsUi.cancel}
            </Button>
            <Button
              variant={confirmDialog?.action === 'lock' ? 'destructive' : 'default'}
              onClick={() => void handleConfirm()}
              disabled={acting}
            >
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : t.accountingPeriodsUi.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
