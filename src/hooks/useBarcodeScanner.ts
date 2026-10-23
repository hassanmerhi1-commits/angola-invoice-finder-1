import { useEffect, useRef } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  minLength?: number;
  /** Max ms between keystrokes that still count as one gun burst. */
  maxDelay?: number;
  enabled?: boolean;
}

const BARCODE_CHAR = /^[a-zA-Z0-9\-_.\/]$/;

function isPasswordField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === 'password';
}

function shouldIgnoreTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-nexor-ignore-barcode]')) return true;
  return isPasswordField(target);
}

/**
 * HID / keyboard-wedge guns type the code then Enter (sometimes Tab, sometimes nothing).
 * POS almost always has quantity or search focused, so we must read those bursts
 * instead of ignoring every INPUT.
 */
export function useBarcodeScanner({
  onScan,
  minLength = 4,
  maxDelay = 140,
  enabled = true,
}: UseBarcodeScannerOptions) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const burstCountRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const clearIdle = () => {
      if (idleTimerRef.current != null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };

    const reset = () => {
      bufferRef.current = '';
      burstCountRef.current = 0;
      clearIdle();
    };

    const commit = (code: string) => {
      reset();
      if (code.length >= minLength) onScanRef.current(code);
    };

    const scheduleIdleCommit = () => {
      clearIdle();
      if (bufferRef.current.length < 8 || burstCountRef.current < 8) return;
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        const code = bufferRef.current;
        if (code.length >= 8 && burstCountRef.current >= 8) commit(code);
      }, maxDelay + 40);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      if (shouldIgnoreTarget(event.target)) return;

      const now = Date.now();
      const gap = lastKeyTimeRef.current ? now - lastKeyTimeRef.current : Number.POSITIVE_INFINITY;

      if (event.key === 'Enter' || event.key === 'Tab') {
        const code = bufferRef.current;
        const isBurst = burstCountRef.current >= minLength && code.length >= minLength;
        if (isBurst) {
          event.preventDefault();
          event.stopPropagation();
          commit(code);
          return;
        }
        reset();
        return;
      }

      if (event.key === 'Shift') return;

      if (event.key.length !== 1 || !BARCODE_CHAR.test(event.key)) {
        if (gap > maxDelay) reset();
        return;
      }

      if (gap > maxDelay) {
        bufferRef.current = event.key;
        burstCountRef.current = 1;
      } else {
        bufferRef.current += event.key;
        burstCountRef.current += 1;
      }
      lastKeyTimeRef.current = now;

      // Swallow the rest of a gun burst so qty / search do not eat the code.
      if (burstCountRef.current >= 2 && gap <= maxDelay) {
        event.preventDefault();
        event.stopPropagation();
      }

      scheduleIdleCommit();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      clearIdle();
    };
  }, [enabled, minLength, maxDelay]);
}
