/**
 * Keep the same ERP chrome on tills, laptops, and resized windows.
 * Scale down (never up) when the viewport is smaller than the design size.
 */
const FIT_WIDTH = 1100;
const FIT_HEIGHT = 680;
const MIN_SCALE = 0.65;

function viewportSize(): { width: number; height: number } {
  const visual = window.visualViewport;
  return {
    width: visual?.width || window.innerWidth || document.documentElement.clientWidth || FIT_WIDTH,
    height: visual?.height || window.innerHeight || document.documentElement.clientHeight || FIT_HEIGHT,
  };
}

export function applyUiFit(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const { width, height } = viewportSize();
  const scale = Math.min(1, width / FIT_WIDTH, height / FIT_HEIGHT);
  const next = Math.max(MIN_SCALE, Math.round(scale * 1000) / 1000);
  const root = document.documentElement;
  const electron = !!(window as any).electronAPI?.isElectron;
  root.style.setProperty('--nexor-ui-fit', String(next));
  root.dataset.nexorUiFit = String(next);
  if (electron) {
    root.dataset.nexorElectron = '1';
    // Installed Chromium ignores CSS transform on #root more often than zoom.
    root.style.zoom = String(next);
  } else {
    delete root.dataset.nexorElectron;
    root.style.zoom = '';
  }
}

export function startUiFitWatcher(): () => void {
  applyUiFit();
  let frame = 0;
  const onResize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(applyUiFit);
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('scroll', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('scroll', onResize);
    cancelAnimationFrame(frame);
  };
}
