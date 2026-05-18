import { useEffect, useCallback, useRef } from 'react';

interface UseBarcodeSccannerOptions {
  onScan: (barcode: string) => void;
  minLength?: number;
  maxDelay?: number;
}

export function useBarcodeScanner({
  onScan,
  minLength = 4,
  maxDelay = 50, // Max ms between keystrokes for barcode scanner
}: UseBarcodeSccannerOptions) {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTimeRef.current;

      // If too much time passed, reset buffer
      if (timeDiff > maxDelay) {
        bufferRef.current = '';
      }

      lastKeyTimeRef.current = currentTime;

      // Enter key submits the barcode
      if (event.key === 'Enter') {
        if (bufferRef.current.length >= minLength) {
          onScan(bufferRef.current);
        }
        bufferRef.current = '';
        return;
      }

      // Only accept alphanumeric characters
      if (event.key.length === 1 && /^[a-zA-Z0-9]$/.test(event.key)) {
        bufferRef.current += event.key;
      }
    },
    [onScan, minLength, maxDelay]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const clearBuffer = useCallback(() => {
    bufferRef.current = '';
  }, []);

  return { clearBuffer };
}
