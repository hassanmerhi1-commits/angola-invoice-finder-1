import type { Page } from '@playwright/test';

/** Open Chart of Accounts → New menu → general "New account" (todos tab). */
export async function openChartNewAccountDialog(page: Page) {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: /^new account$/i }).click();
}
