import { test, expect } from '@playwright/test';
import { loginAsAdmin, primeBrowserStorage, dismissBlockingDialogs } from '../helpers/auth';
import {
  createPurchaseInvoiceApi,
  fetchOpenItemsForSupplier,
  fetchSupplierBalance,
  seedProduct,
  seedSupplier,
} from '../helpers/api';

test.describe('Payment / supplier balance E2E', () => {
  test.beforeEach(async ({ page }) => {
    await primeBrowserStorage(page);
  });

  test('supplier payment clears payable balance after purchase invoice', async ({ page, request }) => {
    const supplier = await seedSupplier(request);
    const product = await seedProduct(request, { auth: supplier.auth, stock: 0 });
    const invoice = await createPurchaseInvoiceApi(request, { auth: supplier.auth, supplier, product });

    const balanceBefore = await fetchSupplierBalance(request, supplier.auth, supplier.supplierId);
    expect(balanceBefore).toBeGreaterThan(0);

    const openItems = await fetchOpenItemsForSupplier(request, supplier.auth, supplier.supplierId);
    const payable = openItems.find((oi: { status?: string; remaining_amount?: number; remainingAmount?: number }) => {
      const remaining = Number(oi.remaining_amount ?? oi.remainingAmount ?? 0);
      return oi.status !== 'cleared' && remaining > 0;
    });
    expect(payable).toBeTruthy();

    await loginAsAdmin(page);
    await page.goto('/payments');
    await dismissBlockingDialogs(page);

    await page.getByRole('button', { name: /new payment/i }).click();
    const dialog = page.getByRole('dialog', { name: /new payment \(supplier\)/i });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('textbox').first().fill(supplier.supplierName);
    await dialog.getByRole('button', { name: supplier.supplierName }).click();

    const docRow = dialog.getByRole('row').filter({ hasText: invoice.invoiceNumber });
    await expect(docRow).toBeVisible({ timeout: 15_000 });
    await docRow.getByRole('checkbox').check();

    await dialog.locator('input[type="number"]').fill(String(invoice.total));
    await dialog.getByRole('button', { name: /record payment/i }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const balanceAfter = await fetchSupplierBalance(request, supplier.auth, supplier.supplierId);
    expect(balanceAfter).toBeLessThan(balanceBefore);
    expect(Math.abs(balanceAfter)).toBeLessThan(0.01);

    const openAfter = await fetchOpenItemsForSupplier(request, supplier.auth, supplier.supplierId);
    const stillOpen = openAfter.filter((oi: { status?: string; remaining_amount?: number; remainingAmount?: number }) => {
      const remaining = Number(oi.remaining_amount ?? oi.remainingAmount ?? 0);
      return oi.status !== 'cleared' && remaining > 0.01;
    });
    expect(stillOpen.length).toBe(0);
  });
});
