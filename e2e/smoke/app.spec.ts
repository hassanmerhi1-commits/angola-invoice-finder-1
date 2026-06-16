import { test, expect } from '@playwright/test';
import { loginAsAdmin, primeBrowserStorage, visitRoute } from '../helpers/auth';
import { E2E_BACKEND_URL } from '../helpers/config';

test.describe('NEXOR ERP smoke', () => {
  test.beforeEach(async ({ page }) => {
    await primeBrowserStorage(page);
  });

  test('backend health responds', async ({ request }) => {
    const res = await request.get(`${E2E_BACKEND_URL}/api/health?lite=1`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.engine).toBe('sqlite');
  });

  test('login and dashboard load', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText(/chart of accounts/i).first()).toBeVisible();
  });

  test('core pages render without crash', async ({ page }) => {
    await loginAsAdmin(page);

    const routes: Array<{ path: string; marker: RegExp }> = [
      { path: '/chart-of-accounts', marker: /new|account no\./i },
      { path: '/inventory', marker: /inventory|stock|product/i },
      { path: '/invoices', marker: /invoice|document/i },
      { path: '/purchase-invoices', marker: /purchase|supplier|invoice/i },
      { path: '/pos', marker: /pos|sale|product|cart/i },
      { path: '/suppliers', marker: /supplier/i },
      { path: '/clients', marker: /client|customer/i },
      { path: '/stock-transfer', marker: /transfer|stock/i },
      { path: '/settings', marker: /settings|company|language/i },
      { path: '/reports', marker: /report/i },
    ];

    for (const { path, marker } of routes) {
      await visitRoute(page, path);
      await expect(page.locator('body')).toContainText(marker);
    }
  });

  test('chart of accounts shows English UI when language is English', async ({ page }) => {
    await loginAsAdmin(page);
    await visitRoute(page, '/chart-of-accounts');
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
    await expect(page.getByText('Customers', { exact: true })).toBeVisible();
    await expect(page.getByText('Account no.', { exact: true })).toBeVisible();
  });
});
