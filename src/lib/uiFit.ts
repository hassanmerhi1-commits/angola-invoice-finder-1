/**
 * Keep the same ERP chrome on tills, laptops, and resized windows.
 * Scale down (never up) when the viewport is smaller than the design size.
 * Use a single #root zoom via --nexor-ui-fit — never zoom <html> as well.
 */
const FIT_WIDTH = 1100;
const FIT_HEIGHT = 680;
const MIN_SCALE = 0.65;

function viewportSize(): { width: number; height: number } {
  const visual = typeof window !== 'undefined' ? window.visualViewport : null;
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
  root.style.setProperty('--nexor-ui-fit', String(next));
  root.style.zoom = '';
  delete root.dataset.nexorElectron;
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
  return () => {
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    cancelAnimationFrame(frame);
  };
}
