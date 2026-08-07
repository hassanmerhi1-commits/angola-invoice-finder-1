import { test, expect } from '@playwright/test';
import { loginAsAdmin, primeBrowserStorage, dismissBlockingDialogs, ensurePosRegisterOpen } from '../helpers/auth';
import {
  fetchLatestSaleForBranch,
  fetchProductStock,
  fetchStockMovements,
  seedPosSaleProduct,
  ensureOpenCaixaSession,
} from '../helpers/api';

test.describe('POS sale E2E', () => {
  test.beforeEach(async ({ page }) => {
    await primeBrowserStorage(page);
  });

  test('cash sale: add item, checkout, receipt, stock and sale recorded', async ({ page, request }) => {
    const seeded = await seedPosSaleProduct(request, { stock: 20, price: 1000 });
    await ensureOpenCaixaSession(request, seeded.auth);

    // Ensure inventory-grid sees the seeded SKU before POS search (avoids stale cache races).
    await expect
      .poll(async () => fetchProductStock(request, seeded.auth, seeded.productId), { timeout: 20_000 })
      .toBeGreaterThan(0);

    await loginAsAdmin(page);
    await page.goto('/pos');
    await dismissBlockingDialogs(page);
    await ensurePosRegisterOpen(page);

    // Bust client session inventory cache and force POS to refetch.
    await page.evaluate(() => {
      for (const key of Object.keys(sessionStorage)) {
        if (key.includes('inventory-grid')) sessionStorage.removeItem(key);
      }
      window.dispatchEvent(new CustomEvent('kwanzaerp:products-changed'));
    });

    const search = page.getByPlaceholder(/code or product name/i);
    await expect(search).toBeVisible({ timeout: 30_000 });

    // Inventory grid can lag behind API seed — wait until SKU resolves before checkout.
    await expect
      .poll(async () => {
        await search.fill(seeded.sku);
        await search.press('Enter');
        return page.getByRole('button', { name: /^checkout$/i }).isEnabled();
      }, { timeout: 45_000 })
      .toBeTruthy();

    await page.getByRole('button', { name: /^checkout$/i }).click();
    await expect(page.getByRole('heading', { name: /^checkout$/i })).toBeVisible();

    await page.getByRole('button', { name: /confirm payment/i }).click();

    await expect(page.getByRole('heading', { name: /sale completed/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('dialog').getByText(seeded.name)).toBeVisible();

    const latestSale = await fetchLatestSaleForBranch(request, seeded.auth);
    expect(latestSale).toBeTruthy();
    expect(latestSale.status).toBe('completed');
    expect(latestSale.payment_method || latestSale.paymentMethod).toBe('cash');

    const items = latestSale.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    const line = items.find(
      (row: { sku?: string; product_id?: string }) =>
        row.sku === seeded.sku || row.product_id === seeded.productId,
    );
    expect(line).toBeTruthy();
    expect(Number(line.quantity)).toBe(1);

    // Prefer the product id that actually sold (filial clone may differ from seed id).
    const soldProductId = String(line.product_id || line.productId || seeded.productId);
    await expect
      .poll(async () => {
        const stockAfter = await fetchProductStock(request, seeded.auth, soldProductId);
        const stockSeed = await fetchProductStock(request, seeded.auth, seeded.productId);
        if (Math.min(stockAfter, stockSeed) < seeded.initialStock) return true;
        const movements = await fetchStockMovements(request, seeded.auth, {
          productId: soldProductId,
        });
        const out = movements.some((m: { movement_type?: string; movementType?: string; reference_type?: string; referenceType?: string }) => {
          const type = String(m.movement_type ?? m.movementType ?? '').toUpperCase();
          const ref = String(m.reference_type ?? m.referenceType ?? '').toLowerCase();
          return type === 'OUT' || ref.includes('sale');
        });
        return out;
      }, { timeout: 30_000 })
      .toBeTruthy();
  });
});
