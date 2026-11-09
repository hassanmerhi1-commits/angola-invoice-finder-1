import { useCallback, useRef, useState } from 'react';
import { api, type NifLookupResult } from '@/lib/api/client';

export function normalizeLookupNif(value: string): string {
  return String(value || '').replace(/[\s.-]/g, '').toUpperCase();
}

/** Angolan NIFs are 10 digits for most taxpayers; BI-based ones run up to 14 characters. */
export function isCompleteNif(value: string): boolean {
  const nif = normalizeLookupNif(value);
  return /^\d{10}$/.test(nif) || /^\d{9}[A-Z]{2}\d{3}$/.test(nif);
}

export function useNifLookup() {
  const [result, setResult] = useState<NifLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef('');

  const reset = useCallback(() => {
    latest.current = '';
    setResult(null);
    setLoading(false);
  }, []);

  const lookup = useCallback(async (value: string): Promise<NifLookupResult | null> => {
    const nif = normalizeLookupNif(value);
    if (!isCompleteNif(nif)) {
      reset();
      return null;
    }
    if (latest.current === nif) return null;
    latest.current = nif;
    setLoading(true);
    setResult(null);
    try {
      const res = await api.agt.lookupNif(nif);
      if (latest.current !== nif) return null;
      const next: NifLookupResult = res.data ?? { nif, status: 'unavailable', message: res.error };
      setResult(next);
      return next;
    } catch {
      if (latest.current !== nif) return null;
      const next: NifLookupResult = { nif, status: 'unavailable' };
      setResult(next);
      return next;
    } finally {
      if (latest.current === nif) setLoading(false);
    }
  }, [reset]);

  return { result, loading, lookup, reset };
}
