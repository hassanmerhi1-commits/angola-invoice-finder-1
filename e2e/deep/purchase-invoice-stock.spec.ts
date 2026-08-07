import { test, expect } from '@playwright/test';
import { loginAsAdmin, primeBrowserStorage, dismissBlockingDialogs } from '../helpers/auth';
import {
  fetchProductStock,
  fetchStockMovements,
  seedProduct,
  seedSupplier,
} from '../helpers/api';

test.describe('Purchase invoice → stock E2E', () => {
  test.beforeEach(async ({ page }) => {
    await primeBrowserStorage(page);
  });

  test('confirmed purchase invoice increases stock and records purchase movement', async ({ page, request }) => {
    const supplier = await seedSupplier(request);
    const product = await seedProduct(request, { auth: supplier.auth, stock: 0 });
    const stockBefore = await fetchProductStock(request, supplier.auth, product.productId);
    expect(stockBefore).toBe(0);

    await loginAsAdmin(page);
    await page.goto('/purchase-invoices/new');
    await dismissBlockingDialogs(page);

    await page.getByText('Select supplier...').click();
    const supplierDialog = page.getByRole('dialog', { name: /accounts list — suppliers/i });
    await expect(supplierDialog).toBeVisible();
    await supplierDialog.getByPlaceholder(/search/i).fill(supplier.supplierName);
    await supplierDialog.getByRole('row').filter({ hasText: supplier.supplierName }).click();
    await expect(page.getByText(supplier.supplierName).first()).toBeVisible();

    await page.getByRole('button', { name: /^insert$/i }).click();
    const productDialog = page.getByRole('dialog', { name: /product list/i });
    await expect(productDialog).toBeVisible();
    await productDialog.getByPlaceholder(/search/i).fill(product.sku);
    await productDialog.getByRole('row').filter({ hasText: product.sku }).click();
    await expect(page.getByText(product.sku).first()).toBeVisible();

    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page).toHaveURL(/\/purchase-invoices(?!\/new)/, { timeout: 45_000 });

    await expect
      .poll(async () => fetchProductStock(request, supplier.auth, product.productId), { timeout: 30_000 })
      .toBeGreaterThan(stockBefore);

    const movements = await fetchStockMovements(request, supplier.auth, {
      productId: product.productId,
      referenceType: 'purchase_invoice',
    });
    expect(movements.length).toBeGreaterThan(0);
    const inbound = movements.find((m: { movement_type?: string; movementType?: string }) => {
      const type = String(m.movement_type ?? m.movementType ?? '').toUpperCase();
      return type === 'IN';
    });
    expect(inbound).toBeTruthy();
  });
});
