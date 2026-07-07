import { test, expect } from '@playwright/test';
import { loginAsAdmin, primeBrowserStorage, dismissBlockingDialogs, ensurePosRegisterOpen } from '../helpers/auth';
import {
  fetchLatestSaleForBranch,
  fetchProductStock,
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

    await loginAsAdmin(page);
    await page.goto('/pos');
    await dismissBlockingDialogs(page);
    await ensurePosRegisterOpen(page);

    const search = page.getByPlaceholder(/code or product name/i);
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill(seeded.sku);
    await search.press('Enter');

    await expect(page.getByRole('button', { name: /^checkout$/i })).toBeEnabled({ timeout: 15_000 });

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

    const stockAfter = await fetchProductStock(request, seeded.auth, seeded.productId);
    expect(stockAfter).toBeLessThan(seeded.initialStock);
  });
});
