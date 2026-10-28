import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';
import { api } from '@/lib/api/client';
import { isDemoMode, isServerDatabaseHost } from '@/lib/api/config';
import { toast } from 'sonner';

type UpdateStatus = Awaited<ReturnType<typeof api.deployment.updateStatus>>['data'];

const DISMISS_PREFIX = 'nexor:city-server-update-dismissed:';
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_CHECK_MS = 8000;
const FOCUS_DEBOUNCE_MS = 60_000;
const BUSY_PHASES = new Set(['checking', 'downloading', 'verifying', 'applying', 'restarting']);

function dismissedBuild(buildId: string): boolean {
  try {
    return sessionStorage.getItem(`${DISMISS_PREFIX}${buildId}`) === '1';
  } catch {
    return false;
  }
}

function dismissBuild(buildId: string): void {
  try {
    sessionStorage.setItem(`${DISMISS_PREFIX}${buildId}`, '1');
  } catch {
    /* ignore */
  }
}

/**
 * City server PC only: popup when a newer 1.3.8 pack is published.
 * Shop tills never see this — they load the screen from the city after apply.
 */
export function CityServerUpdatePrompt() {
  const { t } = useTranslation();
  const ui = t.settingsPage.serverUpdate;
  const { user } = useAuth();
  const { isAdmin, hasPermission } = usePermissions(user?.id);
  const canManage = isAdmin || hasPermission('admin_settings');
  const enabled =
    !isDemoMode()
    && isServerDatabaseHost()
    && !!user
    && user.role !== 'cashier'
    && canManage;

  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const lastFocusCheckRef = useRef(0);

  const check = useCallback(async () => {
    if (!enabled) return;
    const res = await api.deployment.updateStatus(true);
    if (res.error || !res.data) return;
    const data = res.data;
    setStatus(data);
    const phase = data.job?.phase;
    if (phase && BUSY_PHASES.has(phase)) return;
    if (!data.updateAvailable || !data.canApply) return;
    const buildId = String(data.latest?.buildId || '').trim();
    if (!buildId || dismissedBuild(buildId)) return;
    setOpen(true);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => {
      void check();
    }, FIRST_CHECK_MS);
    const interval = window.setInterval(() => {
      void check();
    }, CHECK_INTERVAL_MS);
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusCheckRef.current < FOCUS_DEBOUNCE_MS) return;
      lastFocusCheckRef.current = now;
      void check();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, check]);

  const latestBuild = status?.latest?.buildIdShort || status?.latest?.buildId?.slice(0, 7) || '';
  const buildId = String(status?.latest?.buildId || '').trim();

  const onLater = () => {
    if (buildId) dismissBuild(buildId);
    setConfirming(false);
    setOpen(false);
  };

  const onApply = async () => {
    setConfirming(false);
    setApplying(true);
    const res = await api.deployment.applyUpdate();
    if (res.error) {
      setApplying(false);
      toast.error(res.error);
      return;
    }
    if (buildId) dismissBuild(buildId);
    toast.message(ui.startedToast);
    setOpen(false);
    setApplying(false);
  };

  if (!enabled) return null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && applying) return;
        if (!next) onLater();
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={(e) => {
          if (applying) e.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            {confirming ? ui.confirmTitle : ui.popupTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirming
              ? ui.confirmBody
              : ui.popupBody.replace('{build}', latestBuild || '—')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={applying} onClick={onLater}>
            {confirming ? ui.cancel : ui.popupLater}
          </Button>
          {confirming ? (
            <Button type="button" disabled={applying} onClick={() => void onApply()}>
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {ui.confirm}
            </Button>
          ) : (
            <Button type="button" disabled={applying} onClick={() => setConfirming(true)}>
              {ui.apply}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
