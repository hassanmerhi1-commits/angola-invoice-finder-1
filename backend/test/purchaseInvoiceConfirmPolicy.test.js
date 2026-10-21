const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPurchaseInvoiceDraftStatus,
  canConfirmPurchaseInvoice,
  resolvePurchaseInvoiceWrite,
} = require('../src/lib/purchaseInvoiceConfirmPolicy');

test('draft statuses include empty and pending', () => {
  assert.equal(isPurchaseInvoiceDraftStatus('draft'), true);
  assert.equal(isPurchaseInvoiceDraftStatus('pending'), true);
  assert.equal(isPurchaseInvoiceDraftStatus(''), true);
  assert.equal(isPurchaseInvoiceDraftStatus('confirmed'), false);
});

test('admin can confirm; manager cannot until granted', () => {
  assert.equal(canConfirmPurchaseInvoice({ role: 'admin', id: 'a1' }), true);
  assert.equal(canConfirmPurchaseInvoice({ role: 'manager', id: 'm1' }), false);
  assert.equal(canConfirmPurchaseInvoice({
    role: 'manager',
    id: 'm1',
    permissionOverrides: { granted: ['purchase_invoice_confirm'], revoked: [] },
  }), true);
});

test('non-admin confirm request is forced to draft', () => {
  const result = resolvePurchaseInvoiceWrite({
    user: { role: 'manager', id: 'm1' },
    existing: null,
    requestedStatus: 'confirmed',
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'draft');
  assert.equal(result.skipAccounting, true);
});

test('admin confirm posts the invoice', () => {
  const result = resolvePurchaseInvoiceWrite({
    user: { role: 'admin', id: 'a1' },
    existing: { status: 'draft', created_by: 'm1' },
    requestedStatus: 'confirmed',
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.skipAccounting, false);
});

test('other users cannot edit someone else draft', () => {
  const result = resolvePurchaseInvoiceWrite({
    user: { role: 'manager', id: 'm2' },
    existing: { status: 'draft', created_by: 'm1' },
    requestedStatus: 'draft',
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
});

test('author can keep editing own draft', () => {
  const result = resolvePurchaseInvoiceWrite({
    user: { role: 'manager', id: 'm1' },
    existing: { status: 'draft', created_by: 'm1' },
    requestedStatus: 'draft',
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'draft');
});
