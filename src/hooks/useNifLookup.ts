import { useCallback, useRef, useState } from 'react';
import { api, type NifLookupResult } from '@/lib/api/client';

export function normalizeLookupNif(value: string): string {
  return String(value || '').replace(/[\s.-]/g, '').toUpperCase();
}

/** Company NIFs are 10 digits. A person's NIF can be longer, up to 14, and may include letters. */
export function normalizeCustomerNifInput(value: string): string {
  return normalizeLookupNif(value).replace(/[^0-9A-Z]/g, '').slice(0, 14);
}

export function isCompleteNif(value: string): boolean {
  const nif = normalizeLookupNif(value);
  if (nif === '999999999' || nif === '999999990') return false;
  return /^[0-9A-Z]{9,14}$/.test(nif);
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
