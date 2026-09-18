import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { getApiUrl } from '@/lib/api/config';
import { getTillUiSource, switchTillToCityUi } from '@/lib/sync/cityUi';

/** Shown on POS and login — cashiers cannot open Settings. */
export function TillCityUiBanner() {
  const { t } = useTranslation();
  const [localUi, setLocalUi] = useState(false);
  const [loopbackApi, setLoopbackApi] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.isElectron) return;
    let cancelled = false;
    void getTillUiSource().then((source) => {
      if (!cancelled && source === 'local') setLocalUi(true);
    });
    try {
      const api = getApiUrl();
      if (/127\.0\.0\.1|localhost|\[::1\]/i.test(api)) setLoopbackApi(true);
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const onSwitch = useCallback(async () => {
    setBusy(true);
    try {
      const result = await switchTillToCityUi();
      if (result.ok) {
        toast.success(
          t.hotUpdateUi.reloadingFrom.replace('{source}', result.source || 'server'),
        );
        return;
      }
      toast.error(result.error === 'no-url' ? t.posUi.updates.useCityUiNoUrl : t.hotUpdateUi.reloadFailed);
    } finally {
      setBusy(false);
    }
  }, [t]);

  if (!localUi && !loopbackApi) return null;

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200 text-amber-950">
      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700" />
      <p className="text-xs font-medium min-w-0 flex-1 leading-snug">
        {loopbackApi ? t.posUi.updates.tillLoopbackApiBanner : t.posUi.updates.tillLocalUiBanner}
      </p>
      <Button
        type="button"
        size="sm"
        className="h-8 text-xs shrink-0 bg-amber-700 hover:bg-amber-800 text-white"
        disabled={busy}
        onClick={() => void onSwitch()}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 mr-1" />}
        {t.posUi.updates.tillLocalUiButton}
      </Button>
    </div>
  );
}
