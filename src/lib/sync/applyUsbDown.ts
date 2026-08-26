import { mapInventoryGridRows } from '@/lib/inventoryGrid';
import { isLanCatalogCacheEnabled, lanCatalogScopeKey, saveLanClients, saveLanProducts } from '@/lib/lanCatalogCache';
import { isOfflineFirstEnabled, syncClientsToLocalCache, syncProductsToLocalCache } from '@/lib/sync/offlineFirst';
import {
  productsWithSnapshotStock,
  type NexorDownPackage,
} from '@/lib/sync/usbPackage';

/**
 * Apply a nexor-down USB package to this PC's catalog cache only.
 * Stock qty is a POS snapshot — never posted as ledger movements.
 */
export async function applyUsbDownCatalog(
  pkg: NexorDownPackage,
  currentBranchId?: string | null,
): Promise<{ products: number; clients: number }> {
  if (pkg.kind !== 'nexor-down') {
    throw new Error('expected nexor-down package');
  }
  if (pkg.stockSnapshotOnly !== true) {
    throw new Error('refusing package that is not a POS stock snapshot');
  }
  const dest = String(pkg.toBranchId || pkg.fromBranchId || '').trim();
  const here = String(currentBranchId || '').trim();
  if (dest && here && dest !== here) {
    throw new Error('package branch does not match this shop');
  }
  const canSqlite = await isOfflineFirstEnabled();
  const canLan = isLanCatalogCacheEnabled();
  if (!canSqlite && !canLan) {
    throw new Error('this PC has no local catalog cache to load into');
  }

  const products = productsWithSnapshotStock(pkg);
  const clients = Array.isArray(pkg.clients) ? pkg.clients : [];
  const scope = lanCatalogScopeKey(here || dest);

  await syncProductsToLocalCache(products);
  await syncClientsToLocalCache(clients);

  if (products.length > 0) {
    const gridRows = mapInventoryGridRows(products);
    saveLanProducts(scope, gridRows);
  }
  if (clients.length > 0) {
    saveLanClients(clients);
  }

  return { products: products.length, clients: clients.length };
}
