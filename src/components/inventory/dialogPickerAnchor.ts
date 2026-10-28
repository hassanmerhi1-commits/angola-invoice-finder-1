/** True when the input moved enough that the suggestion box must be repositioned. */
export function anchorRectChanged(prev: DOMRect | null, next: DOMRect | null): boolean {
  if (!prev || !next) return prev !== next;
  return (
    Math.abs(prev.top - next.top) >= 0.5
    || Math.abs(prev.left - next.left) >= 0.5
    || Math.abs(prev.width - next.width) >= 0.5
    || Math.abs(prev.bottom - next.bottom) >= 0.5
  );
}

/**
 * A native confirm() inside a Radix dialog blurs the page. Radix then leaves
 * document.body pointer-events: none, so the whole window ignores clicks until
 * the app is restarted.
 */
export function confirmInOpenDialog(message: string): boolean {
  const ok = window.confirm(message);
  releaseStuckDialogPointerLock();
  return ok;
}

export function releaseStuckDialogPointerLock(): void {
  if (typeof document === 'undefined') return;
  const clear = () => {
    if (document.body.style.pointerEvents === 'none') {
      document.body.style.pointerEvents = '';
    }
  };
  clear();
  window.setTimeout(clear, 0);
  window.setTimeout(clear, 80);
}
