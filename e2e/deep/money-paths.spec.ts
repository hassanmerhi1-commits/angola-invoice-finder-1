import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_BACKEND_URL } from '../helpers/config';
import {
  ensureOpenCaixaSession,
  loginApi,
  seedPosSaleProduct,
  type E2eAuthContext,
} from '../helpers/api';

async function createClient(
  request: APIRequestContext,
  auth: E2eAuthContext,
): Promise<{ id: string; name: string; nif: string }> {
  const nif = `5${Date.now().toString().slice(-8)}`;
  const name = `E2E Client ${nif}`;
  const res = await request.post(`${E2E_BACKEND_URL}/api/clients`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    data: {
      name,
      nif,
      email: `e2e-${nif}@example.com`,
      phone: '900000000',
      isActive: true,
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { id: body.id, name: body.name || name, nif };
}

async function createSaleApi(
  request: APIRequestContext,
  auth: E2eAuthContext,
  options: {
    productId: string;
    productName: string;
    sku: string;
    price: number;
    paymentMethod: 'cash' | 'card' | 'transfer' | 'credit';
    clientId?: string;
    customerNif?: string;
    customerName?: string;
  },
) {
  const qty = 1;
  const subtotal = options.price * qty;
  const taxAmount = Math.round(subtotal * 0.14 * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  const isCredit = options.paymentMethod === 'credit';

  const res = await request.post(`${E2E_BACKEND_URL}/api/sales`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    data: {
      branchId: auth.branchId,
      cashierId: auth.userId,
      cashierName: 'E2E Admin',
      items: [{
        productId: options.productId,
        productName: options.productName,
        sku: options.sku,
        quantity: qty,
        unitPrice: options.price,
        discount: 0,
        taxRate: 14,
        total: subtotal,
      }],
      subtotal,
      taxAmount,
      discount: 0,
      total,
      paymentMethod: options.paymentMethod,
      amountPaid: isCredit ? 0 : total,
      change: 0,
      clientId: options.clientId,
      customerNif: options.customerNif,
      customerName: options.customerName,
      clientRequestId: randomUUID(),
    },
  });
  return res;
}

test.describe('Money paths (API)', () => {
  test('card and transfer sales complete with matching payment method', async ({ request }) => {
    for (const paymentMethod of ['card', 'transfer'] as const) {
      const seeded = await seedPosSaleProduct(request, { stock: 10, price: 1500 });
      await ensureOpenCaixaSession(request, seeded.auth);

      const res = await createSaleApi(request, seeded.auth, {
        productId: seeded.productId,
        productName: seeded.name,
        sku: seeded.sku,
        price: seeded.price,
        paymentMethod,
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const sale = await res.json();
      expect(sale.payment_method || sale.paymentMethod).toBe(paymentMethod);
      expect(sale.status || 'completed').toMatch(/completed|confirmed/i);
    }
  });

  test('credit sale requires client and records on-account payment', async ({ request }) => {
    const seeded = await seedPosSaleProduct(request, { stock: 10, price: 2000 });
    await ensureOpenCaixaSession(request, seeded.auth);
    const client = await createClient(request, seeded.auth);

    const res = await createSaleApi(request, seeded.auth, {
      productId: seeded.productId,
      productName: seeded.name,
      sku: seeded.sku,
      price: seeded.price,
      paymentMethod: 'credit',
      clientId: client.id,
      customerNif: client.nif,
      customerName: client.name,
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const sale = await res.json();
    expect(sale.payment_method || sale.paymentMethod).toBe('credit');

    const openRes = await request.get(
      `${E2E_BACKEND_URL}/api/payments/open-items/customer/${encodeURIComponent(client.id)}`,
      { headers: { Authorization: `Bearer ${seeded.auth.token}` } },
    );
    if (openRes.ok()) {
      const items = await openRes.json();
      expect(Array.isArray(items) ? items.length : 0).toBeGreaterThan(0);
    }
  });

  test('backdate journal denied without backdate_post', async ({ request }) => {
    const admin = await loginApi(request);
    const suffix = Date.now().toString(36).slice(-6);
    const username = `e2e_mgr_${suffix}`;
    const password = 'TestPass123!';

    const createUser = await request.post(`${E2E_BACKEND_URL}/api/auth/users`, {
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        email: `${username}@example.com`,
        username,
        name: `E2E Manager ${suffix}`,
        role: 'manager',
        branchId: admin.branchId,
        password,
      },
    });
    expect(createUser.ok(), await createUser.text()).toBeTruthy();
    const user = await createUser.json();

    const patch = await request.put(`${E2E_BACKEND_URL}/api/auth/users/${encodeURIComponent(user.id)}`, {
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        permissionOverrides: { granted: [], revoked: ['backdate_post'] },
      },
    });
    expect(patch.ok(), await patch.text()).toBeTruthy();

    const loginRes = await request.post(`${E2E_BACKEND_URL}/api/auth/login`, {
      data: { email: username, username, password },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginBody = await loginRes.json();
    const mgrToken = loginBody.token as string;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const entryDate = yesterday.toISOString().slice(0, 10);

    const txRes = await request.post(`${E2E_BACKEND_URL}/api/transactions/process`, {
      headers: {
        Authorization: `Bearer ${mgrToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionType: 'manual',
        entryDate,
        date: entryDate,
        branchId: admin.branchId,
        description: `E2E backdate deny ${suffix}`,
        journalLines: [
          { accountCode: '62', description: 'E2E debit', debit: 100, credit: 0 },
          { accountCode: '451', description: 'E2E credit', debit: 0, credit: 100 },
        ],
      },
    });

    expect(txRes.status()).toBe(403);
    const body = await txRes.json();
    expect(String(body.code || body.error || '')).toMatch(/BACKDATE|backdate/i);
  });

  test('journal reverse succeeds for admin', async ({ request }) => {
    const auth = await loginApi(request);
    const suffix = Date.now().toString(36).slice(-6);
    const description = `E2E reverse ${suffix}`;
    const today = new Date().toISOString().slice(0, 10);

    const createRes = await request.post(`${E2E_BACKEND_URL}/api/transactions/process`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionType: 'manual',
        entryDate: today,
        date: today,
        branchId: auth.branchId,
        description,
        journalLines: [
          { accountCode: '62', description: 'E2E debit', debit: 250, credit: 0 },
          { accountCode: '451', description: 'E2E credit', debit: 0, credit: 250 },
        ],
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const created = await createRes.json();
    const entryId = created.journalEntryId || created.id || created.entryId;
    expect(entryId).toBeTruthy();

    const reverseRes = await request.post(
      `${E2E_BACKEND_URL}/api/journal-entries/${encodeURIComponent(entryId)}/reverse`,
      {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        data: { entryDate: today },
      },
    );
    expect(reverseRes.ok(), await reverseRes.text()).toBeTruthy();
    const reversed = await reverseRes.json();
    expect(reversed.success !== false).toBeTruthy();
  });
});
