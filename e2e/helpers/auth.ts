import { expect, type Page } from '@playwright/test';
import { E2E_BACKEND_URL } from './config';

export const E2E_ADMIN = {
  username: 'admin',
  password: 'changeme',
};

const todayKey = () => new Date().toISOString().slice(0, 10);

/** Seed browser storage so setup wizard and daily popup do not block smoke tests. */
export async function primeBrowserStorage(page: Page) {
  await page.addInitScript(({ today, apiBase }) => {
    localStorage.setItem('kwanza_setup_complete', 'true');
    localStorage.setItem('kwanza_language', 'en');
    localStorage.setItem('kwanza_api_url', apiBase);
    localStorage.setItem(
      'nexor:daily-todos:v1',
      JSON.stringify({
        enabled: false,
        templateItems: [],
        lastShownDate: today,
        days: {},
      }),
    );
    // Skip POS printer-setup dialog in browser e2e (no Electron silent print).
    localStorage.setItem(
      'kwanza_printer_config',
      JSON.stringify({
        type: 'windows',
        deviceName: 'E2E Test Printer',
        paperWidth: 80,
        posAutoPrint: true,
      }),
    );
  }, { today: todayKey(), apiBase: E2E_BACKEND_URL });
}

export async function dismissBlockingDialogs(page: Page) {
  const dialog = page.getByRole('dialog').first();
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  }
}

export async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  await page.locator('#username').fill(E2E_ADMIN.username);
  await page.locator('#password').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: /^login$/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await dismissBlockingDialogs(page);
}

export async function visitRoute(page: Page, path: string) {
  await page.goto(path);
  await dismissBlockingDialogs(page);
  await expect(page.locator('body')).not.toContainText(/something went wrong|application error/i);
  await expect(page.getByText('404', { exact: true })).toHaveCount(0);
}
