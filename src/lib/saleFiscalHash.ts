import { Sale } from '@/types/erp';
import { api } from '@/lib/api/client';

const HASH_WAIT_MS = 2800;
const POLL_MS = 200;

function pickHash(row: { saftHash?: string; saft_hash?: string; agt_hash?: string } | null | undefined): string {
  return String(row?.saftHash || row?.saft_hash || row?.agt_hash || '').trim();
}

function pickAtcud(row: { atcud?: string } | null | undefined): string | undefined {
  const value = row?.atcud;
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function isRealHash(hash: string): boolean {
  return hash.length >= 4 && hash !== '0' && hash !== '----';
}

/**
 * Ensure the sale used for print/QR has the server fiscal hash.
 * Create already waits ~2.5s for signing; this polls GET if the hash is still missing.
 */
export async function withFiscalHash(sale: Sale): Promise<Sale> {
  if (isRealHash(pickHash(sale))) return sale;
  if (!sale.id) return sale;

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
        if (isRealHash(hash)) return latest;
      }
    } catch {
      /* keep waiting — signing may still be in flight */
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return latest;
}
