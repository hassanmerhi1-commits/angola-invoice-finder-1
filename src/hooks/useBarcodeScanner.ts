import { useEffect, useRef } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  minLength?: number;
  /** Max ms between keystrokes that still count as one gun burst. */
  maxDelay?: number;
  enabled?: boolean;
}

const BARCODE_CHAR = /^[a-zA-Z0-9\-_.\/]$/;

export function looksLikeScannedCode(value: string, minLength = 4): boolean {
  const code = String(value || '').trim();
  if (code.length < minLength) return false;
  return BARCODE_CHAR.test(code.replace(/\s/g, '')) || /^[a-zA-Z0-9\-_.\/\s]+$/.test(code);
}

function charFromEvent(event: KeyboardEvent): string {
  if (event.key.length === 1 && BARCODE_CHAR.test(event.key)) return event.key;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code);
  if (digit) return digit[1];
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1];
  return '';
}

function isPasswordField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === 'password';
}

function shouldIgnoreTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-nexor-ignore-barcode]')) return true;
  return isPasswordField(target);
}

/**
 * HID / keyboard-wedge guns type the code then Enter (sometimes Tab, paste, or nothing).
 * POS almost always has quantity or search focused, so we read those bursts too.
 */
export function useBarcodeScanner({
  onScan,
  minLength = 4,
  maxDelay = 200,
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
      const cleaned = String(code || '').trim();
      reset();
      if (cleaned.length >= minLength) onScanRef.current(cleaned);
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

      const char = charFromEvent(event);
      if (!char) {
        if (gap > maxDelay) reset();
        return;
      }

      if (gap > maxDelay) {
        bufferRef.current = char;
        burstCountRef.current = 1;
      } else {
        bufferRef.current += char;
        burstCountRef.current += 1;
      }
      lastKeyTimeRef.current = now;

      if (burstCountRef.current >= 2 && gap <= maxDelay) {
        event.preventDefault();
        event.stopPropagation();
      }

      scheduleIdleCommit();
    };

    const handlePaste = (event: ClipboardEvent) => {
      if (shouldIgnoreTarget(event.target)) return;
      const text = String(event.clipboardData?.getData('text') || '').trim();
      if (!looksLikeScannedCode(text, Math.max(minLength, 6))) return;
      event.preventDefault();
      commit(text);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('paste', handlePaste, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('paste', handlePaste, true);
      clearIdle();
    };
  }, [enabled, minLength, maxDelay]);
}
