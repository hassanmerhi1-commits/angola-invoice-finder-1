import { api } from '@/lib/api/client';

export function firstProductBarcode(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    const code = String(value || '').trim();
    if (code) return code;
  }
  return '';
}

/** Writes the barcode immediately so closing the form cannot drop it. */
export async function persistProductBarcode(
  productId: string | undefined | null,
  barcode: string | undefined | null,
): Promise<string> {
  const id = String(productId || '').trim();
  const code = String(barcode || '').trim();
  if (!id || !code) return '';
  const res = await api.products.setBarcode(id, code);
  if (res.error) {
    console.warn('[barcode] persist failed:', res.error);
    return '';
  }
  return code;
}
