import { test, expect } from '@playwright/test';
import { loginAsAdmin, primeBrowserStorage, dismissBlockingDialogs } from '../helpers/auth';
import { openChartNewAccountDialog } from '../helpers/chartOfAccounts';
import {
  fetchChartOfAccounts,
  fetchJournalEntries,
  loginApi,
  syncChartOfAccountsToPage,
} from '../helpers/api';

test.describe('Chart of accounts + journal E2E', () => {
  test.beforeEach(async ({ page }) => {
    await primeBrowserStorage(page);
  });

  test('create account and post balanced manual journal entry', async ({ page, request }) => {
    const auth = await loginApi(request);
    const accountCode = `79${Date.now().toString().slice(-5)}`;
    const accountName = `E2E Expense ${accountCode}`;
    const journalDescription = `E2E journal ${Date.now().toString(36).slice(-6)}`;
    const amount = 2500;

    await loginAsAdmin(page);
    await syncChartOfAccountsToPage(page, request, auth);

    await page.goto('/chart-of-accounts');
    await dismissBlockingDialogs(page);

    await openChartNewAccountDialog(page);
    const coaDialog = page.getByRole('dialog', { name: /new account/i });
    await expect(coaDialog).toBeVisible();
    await coaDialog.getByPlaceholder('e.g., 451').fill(accountCode);
    await coaDialog.getByPlaceholder('e.g., Caixa').fill(accountName);
    await coaDialog.getByRole('combobox').filter({ hasText: /^asset$/i }).click();
    await page.getByRole('option', { name: /^expense$/i }).click();
    await coaDialog.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText(/account created/i)).toBeVisible({ timeout: 15_000 });

    const accounts = await fetchChartOfAccounts(request, auth);
    expect(accounts.some((a: { code?: string }) => a.code === accountCode)).toBeTruthy();

    await syncChartOfAccountsToPage(page, request, auth);
    await page.goto('/journals');
    await dismissBlockingDialogs(page);

    await page.getByRole('button', { name: /new entry/i }).click();
    const journalDialog = page.getByRole('dialog', { name: /new manual entry/i });
    await expect(journalDialog).toBeVisible();

    await journalDialog
      .getByPlaceholder(/entry (title|description)/i)
      .fill(journalDescription);

    const accountInputs = journalDialog.getByPlaceholder('e.g., 451');
    await accountInputs.nth(0).fill(accountCode);
    await journalDialog.getByRole('button', { name: new RegExp(`^${accountCode}\\s`) }).click();

    const debitInputs = journalDialog.locator('input[type="number"]');
    await debitInputs.nth(0).fill(String(amount));

    await accountInputs.nth(1).fill('451');
    // Anchor to the code so we don't also match 3451 (IVA dedutível).
    await journalDialog.getByRole('button', { name: /^451\s/ }).click();

    await journalDialog.getByRole('button', { name: /auto balance/i }).click();
    await journalDialog.getByRole('button', { name: /^post$/i }).click();
    await expect(journalDialog).toBeHidden({ timeout: 30_000 });

    const entries = await fetchJournalEntries(request, auth, { description: journalDescription });
    expect(entries.length).toBeGreaterThan(0);

    const entry = entries[0];
    expect(Number(entry.total_debit ?? entry.totalDebit)).toBe(amount);
    expect(Number(entry.total_credit ?? entry.totalCredit)).toBe(amount);

    const lines = entry.lines ?? [];
    const debitLine = lines.find((l: { account_code?: string; accountCode?: string }) =>
      (l.account_code ?? l.accountCode) === accountCode,
    );
    const creditLine = lines.find((l: { account_code?: string; accountCode?: string }) =>
      (l.account_code ?? l.accountCode) === '451',
    );
    expect(debitLine).toBeTruthy();
    expect(creditLine).toBeTruthy();
  });
});
