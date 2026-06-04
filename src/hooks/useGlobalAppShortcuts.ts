import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getAppInteractionSettings } from '@/lib/appInteractionSettings';
import { dispatchToolbarEvent, NEXOR_TOOLBAR } from '@/lib/nexorToolbarEvents';

function focusMainSearch() {
  const root = document.querySelector('main');
  if (!root) return;
  const input =
    root.querySelector<HTMLInputElement>('input[type="search"]') ||
    root.querySelector<HTMLInputElement>('input[placeholder*="Search"]') ||
    root.querySelector<HTMLInputElement>('input[placeholder*="Pesquis"]') ||
    root.querySelector<HTMLInputElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
  input?.focus();
  input?.select?.();
}

export function useGlobalAppShortcuts() {
  const location = useLocation();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!getAppInteractionSettings().globalShortcuts) return;

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
      const isFn = e.key.startsWith('F') && e.key.length <= 3;

      if (isInput && !isFn && e.key !== 'Escape') return;

      if (e.key === 'F2') {
        e.preventDefault();
        focusMainSearch();
        return;
      }

      if (e.key === 'F3' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dispatchToolbarEvent(NEXOR_TOOLBAR.NEW);
        return;
      }

      if (e.key === 'F4' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dispatchToolbarEvent(NEXOR_TOOLBAR.EDIT);
        return;
      }

      if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !isInput) {
        e.preventDefault();
        dispatchToolbarEvent(NEXOR_TOOLBAR.DELETE);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [location.pathname]);
}
