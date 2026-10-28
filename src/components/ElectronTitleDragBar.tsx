import { useEffect } from 'react';

const OVERLAY_CLASS = 'nexor-has-caption-overlay';

/** True when Windows paints min/max/close over the web page (titleBarOverlay). */
function captionOverlayHeight(): number {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;top:env(titlebar-area-height,0px);left:0;width:0;height:0;visibility:hidden;pointer-events:none;';
  document.documentElement.appendChild(probe);
  const top = probe.getBoundingClientRect().top;
  probe.remove();
  return Number.isFinite(top) ? top : 0;
}

function syncCaptionOverlayClass(): void {
  const overlay = captionOverlayHeight() >= 24;
  document.documentElement.classList.toggle(OVERLAY_CLASS, overlay);
}

/** Login-only 32px drag strip. Caption overlay class keeps fullscreen dialogs off Windows Close. */
export function ElectronTitleDragBar() {
  const isWinElectron = typeof window !== 'undefined'
    && !!window.electronAPI?.isElectron
    && /Windows/i.test(navigator.userAgent || '');

  useEffect(() => {
    if (!isWinElectron) return;
    document.documentElement.classList.add('nexor-electron-win');
    syncCaptionOverlayClass();
    const onResize = () => syncCaptionOverlayClass();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      document.documentElement.classList.remove('nexor-electron-win');
      document.documentElement.classList.remove(OVERLAY_CLASS);
    };
  }, [isWinElectron]);

  if (!isWinElectron) return null;
  return <div className="nexor-electron-drag" aria-hidden />;
}
