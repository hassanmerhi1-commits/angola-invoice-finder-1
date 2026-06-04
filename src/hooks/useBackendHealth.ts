import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Phase 5 — Backend health UI bridge.
 *
 * Listens to `backend:status` events emitted from the Electron main process
 * (electron/backendManager.cjs → setStatusListener) and surfaces them as
 * sonner toasts.
 *
 * Event payload: { state, detail?, port?, mode?, code?, fails?, attempts?, ts }
 *   state ∈ 'healthy' | 'degraded' | 'down' | 'restarting' | 'restarted' | 'failed'
 *
 * Design choices:
 *  - Use a single sticky toast id per "incident" so we update in place
 *    instead of stacking 3 toasts during a 90-second outage.
 *  - Don't toast on the initial healthy event (avoid noise on app start).
 *  - In web preview / non-Electron, this hook is a no-op.
 */

type BackendStatus = {
  state: 'healthy' | 'degraded' | 'down' | 'restarting' | 'restarted' | 'failed';
  detail?: string;
  port?: number | null;
  mode?: string;
  code?: string;
  fails?: number;
  attempts?: number;
  ts?: number;
};

const INCIDENT_TOAST_ID = 'backend-health-incident';

export function useBackendHealth() {
  const sawFirstHealthy = useRef(false);
  const incidentOpen = useRef(false);

  useEffect(() => {
    const api = (typeof window !== 'undefined' ? window.electronAPI : undefined);
    if (!api?.backend?.onStatus) return; // web preview or older preload

    api.backend.onStatus((data: unknown) => {
      const raw = data as BackendStatus;
      switch (raw.state) {
        case 'healthy': {
          if (incidentOpen.current) {
            toast.success('Backend reconnected', {
              id: INCIDENT_TOAST_ID,
              description: raw.detail,
              duration: 4000,
            });
            incidentOpen.current = false;
          } else if (!sawFirstHealthy.current) {
            // first healthy after startup — silent
            sawFirstHealthy.current = true;
          }
          break;
        }
        case 'degraded': {
          if ((raw.fails ?? 0) < 2) break;
          incidentOpen.current = true;
          toast.warning('Backend not responding', {
            id: INCIDENT_TOAST_ID,
            description: raw.detail || `Health check failed (${raw.fails ?? 2}/4)`,
            duration: Infinity,
          });
          break;
        }
        case 'restarting': {
          incidentOpen.current = true;
          toast.loading('Backend reconnecting…', {
            id: INCIDENT_TOAST_ID,
            description: raw.detail || `Attempt ${raw.attempts ?? 1}/3`,
            duration: Infinity,
          });
          break;
        }
        case 'restarted': {
          toast.success('Backend reconnected', {
            id: INCIDENT_TOAST_ID,
            description: raw.detail || 'Service restored',
            duration: 4000,
          });
          incidentOpen.current = false;
          break;
        }
        case 'down': {
          incidentOpen.current = true;
          toast.error('Backend offline', {
            id: INCIDENT_TOAST_ID,
            description: raw.detail || raw.code || 'Connection lost',
            duration: Infinity,
          });
          break;
        }
        case 'failed': {
          incidentOpen.current = true;
          toast.error('Backend unrecoverable', {
            id: INCIDENT_TOAST_ID,
            description: raw.detail || 'Restart attempts exhausted. Check Docker Desktop and restart the app.',
            duration: Infinity,
            action: {
              label: 'Restart app',
              onClick: () => api?.app?.relaunch?.(),
            },
          });
          break;
        }
        default:
          break;
      }
    });
  }, []);
}
