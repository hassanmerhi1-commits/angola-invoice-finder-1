import { test, expect } from '@playwright/test';
import { loginAsAdmin, primeBrowserStorage, dismissBlockingDialogs } from '../helpers/auth';
import {
  fetchProductStock,
  fetchStockMovements,
  seedStockTransferScenario,
} from '../helpers/api';

test.describe('Stock transfer E2E', () => {
  test.beforeEach(async ({ page }) => {
    await primeBrowserStorage(page);
  });

  test('create, approve, and receive transfer updates stock at both branches', async ({ page, request }) => {
    const scenario = await seedStockTransferScenario(request, { stock: 30, transferQty: 5 });
    const sourceBefore = await fetchProductStock(
      request,
      scenario.auth,
      scenario.productId,
      scenario.sourceBranchId,
    );
    expect(sourceBefore).toBeGreaterThanOrEqual(scenario.transferQty);

    await loginAsAdmin(page);
    await page.goto('/stock-transfer');
    await dismissBlockingDialogs(page);

    await page.getByRole('button', { name: /new transfer/i }).click();
    const createDialog = page.getByRole('dialog', { name: /new transfer/i });
    await expect(createDialog).toBeVisible();

    await createDialog.locator('label', { hasText: /to \(destination|para \(destino\)/i }).locator('..').getByRole('combobox').click();
    await page.getByRole('option', { name: new RegExp(scenario.destBranchName, 'i') }).click();

    await createDialog.getByPlaceholder(/search|code|product/i).fill(scenario.sku);
    await createDialog.getByRole('button', { name: new RegExp(scenario.sku) }).click();

    const qtyInput = createDialog.locator('tbody input').first();
    await qtyInput.fill(String(scenario.transferQty));
    await qtyInput.blur();

    await createDialog.getByRole('button', { name: /create transfer|criar transfer/i }).click();
    await expect(createDialog).toBeHidden({ timeout: 30_000 });

    const pendingRow = page.getByRole('row').filter({ hasText: scenario.destBranchName });
    await expect(pendingRow).toBeVisible({ timeout: 15_000 });
    await pendingRow.getByRole('button', { name: /^(approve|aprovar)$/i }).click();

    await page.getByRole('tab', { name: /in transit|em trânsito/i }).click();

    await page.locator('header').getByRole('combobox').click();
    await page.getByRole('option', { name: new RegExp(scenario.destBranchName, 'i') }).click();

    const transitRow = page.getByRole('row').filter({ hasText: scenario.destBranchName });
    await expect(transitRow).toBeVisible({ timeout: 15_000 });
    await transitRow.getByRole('button', { name: /confirm receipt|confirmar recep/i }).click();

    const receiveDialog = page.getByRole('dialog', { name: /receive|recepção/i });
    await expect(receiveDialog).toBeVisible();
    await receiveDialog.getByRole('button', { name: /confirm receiv|confirmar recep/i }).click();
    await expect(receiveDialog).toBeHidden({ timeout: 30_000 });

    const sourceAfter = await fetchProductStock(
      request,
      scenario.auth,
      scenario.productId,
      scenario.sourceBranchId,
    );

    expect(sourceAfter).toBe(sourceBefore - scenario.transferQty);

    const sourceMovements = await fetchStockMovements(request, scenario.auth, {
      referenceType: 'transfer',
      warehouseId: scenario.sourceBranchId,
    });
    const outbound = sourceMovements.find((m: { movement_type?: string; movementType?: string; quantity?: number }) => {
      const type = String(m.movement_type ?? m.movementType ?? '').toUpperCase();
      return type === 'OUT' && Number(m.quantity) === scenario.transferQty;
    });
    expect(outbound).toBeTruthy();

    const destMovements = await fetchStockMovements(request, scenario.auth, {
      referenceType: 'transfer',
      warehouseId: scenario.destBranchId,
    });
    const inbound = destMovements.find((m: { movement_type?: string; movementType?: string; quantity?: number }) => {
      const type = String(m.movement_type ?? m.movementType ?? '').toUpperCase();
      return type === 'IN' && Number(m.quantity) === scenario.transferQty;
    });
    expect(inbound).toBeTruthy();
  });
});
