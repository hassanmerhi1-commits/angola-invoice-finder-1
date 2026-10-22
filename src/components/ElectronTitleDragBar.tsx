import { useEffect } from 'react';

/** Login-only 32px drag strip. After login, File/Company sit in the Windows title bar. */
export function ElectronTitleDragBar() {
  const isWinElectron = typeof window !== 'undefined'
    && !!window.electronAPI?.isElectron
    && /Windows/i.test(navigator.userAgent || '');

  useEffect(() => {
    if (!isWinElectron) return;
    document.documentElement.classList.add('nexor-electron-win');
    return () => document.documentElement.classList.remove('nexor-electron-win');
  }, [isWinElectron]);

  if (!isWinElectron) return null;
  return <div className="nexor-electron-drag" aria-hidden />;
}
