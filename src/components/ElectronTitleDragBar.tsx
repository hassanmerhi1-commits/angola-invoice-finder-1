/** 32px drag strip under the Windows title-bar overlay so ink is not a white caption. */
export function ElectronTitleDragBar() {
  if (typeof window === 'undefined') return null;
  if (!window.electronAPI?.isElectron) return null;
  if (!/Windows/i.test(navigator.userAgent || '')) return null;
  return <div className="nexor-electron-drag" aria-hidden />;
}
