import { Sale } from '@/types/erp';
import { api } from '@/lib/api/client';
import { isOfflineSaleStub } from '@/lib/saleOfflineGuard';

const HASH_WAIT_MS = 12_000;
const POLL_MS = 200;
export const FISCAL_HASH_MISSING = 'FISCAL_HASH_MISSING';

function pickHash(row: { saftHash?: string; saft_hash?: string; agt_hash?: string } | null | undefined): string {
  return String(row?.saftHash || row?.saft_hash || row?.agt_hash || '').trim();
}

function pickAtcud(row: { atcud?: string } | null | undefined): string | undefined {
  const value = row?.atcud;
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

export function isRealFiscalHash(hash: string): boolean {
  return hash.length >= 4 && hash !== '0' && hash !== '----';
}

export function isFiscalHashMissingError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error && error.name === FISCAL_HASH_MISSING) return true;
  return /FISCAL_HASH_MISSING|fiscal hash/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * Ensure the sale used for print/QR has the server fiscal hash.
 * Offline stubs print as provisional (official number + hash come after sync).
 * Official sales must not print until the hash is on the row.
 */
export async function withFiscalHash(sale: Sale): Promise<Sale> {
  if (isOfflineSaleStub(sale as unknown as Record<string, unknown>)) return sale;
  if (isRealFiscalHash(pickHash(sale))) return sale;
  if (!sale.id) {
    const err = new Error(FISCAL_HASH_MISSING);
    err.name = FISCAL_HASH_MISSING;
    throw err;
  }

  const deadline = Date.now() + HASH_WAIT_MS;
  let latest: Sale = sale;
  while (Date.now() < deadline) {
    try {
      const res = await api.sales.get(sale.id);
      if (res.data) {
        const hash = pickHash(res.data);
        const atcud = pickAtcud(res.data);
        latest = {
          ...sale,
          ...latest,
          saftHash: hash || latest.saftHash,
          atcud: atcud ?? latest.atcud,
        };
        if (isRealFiscalHash(hash)) return latest;
      }
    } catch {
      /* keep waiting — signing may still be in flight */
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const err = new Error(FISCAL_HASH_MISSING);
  err.name = FISCAL_HASH_MISSING;
  throw err;
}
