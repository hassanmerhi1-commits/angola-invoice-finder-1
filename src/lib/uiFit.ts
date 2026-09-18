/**
 * Keep the same ERP chrome on tills, laptops, and resized windows.
 * Scale down (never up) when the viewport is smaller than the design size.
 */
const FIT_WIDTH = 1200;
const FIT_HEIGHT = 740;
const MIN_SCALE = 0.82;

export function applyUiFit(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const scale = Math.min(1, window.innerWidth / FIT_WIDTH, window.innerHeight / FIT_HEIGHT);
  const next = Math.max(MIN_SCALE, Math.round(scale * 1000) / 1000);
  document.documentElement.style.setProperty('--nexor-ui-fit', String(next));
}

export function startUiFitWatcher(): () => void {
  applyUiFit();
  let frame = 0;
  const onResize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(applyUiFit);
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    cancelAnimationFrame(frame);
  };
}
