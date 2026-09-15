/**
 * Global search across the main ERP records.
 * Each query is isolated so a missing table/column cannot fail the whole search.
 *
 * scope=quick  — clients, products, suppliers, sales, purchase invoices (fast first paint)
 * scope=more   — remaining record types
 * scope=all    — everything (one round-trip; slower)
 */
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const QUICK_KEYS = ['clients', 'products', 'suppliers', 'sales', 'purchaseInvoices'];
const MORE_KEYS = [
  'purchaseOrders',
  'salesOrders',
  'proformas',
  'creditNotes',
  'debitNotes',
  'transportDocuments',
  'expenses',
  'payments',
  'journals',
  'accounts',
  'bankAccounts',
  'stockTransfers',
  'importOrders',
  'users',
  'branches',
  'categories',
  'caixas',
  'openItems',
];

function likeContains(q) {
  return `%${String(q).replace(/[%_]/g, '').slice(0, 80)}%`;
}

function likePrefix(q) {
  return `${String(q).replace(/[%_]/g, '').slice(0, 80)}%`;
}

function emptyResult() {
  return { rows: [] };
}

async function runSearch(sqlList, params) {
  for (const sql of sqlList) {
    const needed = (String(sql).match(/\$\d+/g) || [])
      .reduce((max, token) => Math.max(max, parseInt(token.slice(1), 10) || 0), 0);
    const sliced = Array.isArray(params) ? params.slice(0, needed) : params;
    try {
      return await db.query(sql, sliced);
    } catch {
      /* next dialect / older schema */
    }
  }
  return emptyResult();
}

function href(path, query) {
  const qs = new URLSearchParams();
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v != null && String(v).trim() !== '') qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

function emptyPayload(q) {
  return {
    q,
    clients: [],
    products: [],
    suppliers: [],
    sales: [],
    purchaseInvoices: [],
    purchaseOrders: [],
    salesOrders: [],
    proformas: [],
    creditNotes: [],
    debitNotes: [],
    transportDocuments: [],
    expenses: [],
    payments: [],
    journals: [],
    accounts: [],
    bankAccounts: [],
    stockTransfers: [],
    importOrders: [],
    users: [],
    branches: [],
    categories: [],
    caixas: [],
    openItems: [],
  };
}

function queries(p) {
  // p = [contains %q%, limit, prefix q%]
  return {
    clients: () => runSearch([
      `SELECT id, name, nif, phone FROM clients
       WHERE COALESCE(is_active, true) = true
         AND (name ILIKE $3 OR name ILIKE $1 OR nif ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1)
       ORDER BY name ASC LIMIT $2`,
      `SELECT id, name, nif, phone FROM clients
       WHERE COALESCE(is_active, 1) = 1
         AND (LOWER(name) LIKE LOWER($1) OR LOWER(IFNULL(nif,'')) LIKE LOWER($1)
              OR LOWER(IFNULL(phone,'')) LIKE LOWER($1) OR LOWER(IFNULL(email,'')) LIKE LOWER($1))
       ORDER BY name ASC LIMIT $2`,
    ], p),
    products: () => runSearch([
      `SELECT id, name, sku, barcode, stock FROM products
       WHERE COALESCE(is_active, true) = true
         AND (sku ILIKE $3 OR name ILIKE $3 OR name ILIKE $1 OR sku ILIKE $1 OR barcode ILIKE $1 OR category ILIKE $1)
       ORDER BY name ASC LIMIT $2`,
      `SELECT id, name, sku, barcode, stock FROM products
       WHERE COALESCE(is_active, 1) = 1
         AND (LOWER(name) LIKE LOWER($1) OR LOWER(IFNULL(sku,'')) LIKE LOWER($1)
              OR LOWER(IFNULL(barcode,'')) LIKE LOWER($1) OR LOWER(IFNULL(category,'')) LIKE LOWER($1))
       ORDER BY name ASC LIMIT $2`,
    ], p),
    suppliers: () => runSearch([
      `SELECT id, name, nif, phone FROM suppliers
       WHERE COALESCE(is_active, true) = true
         AND (name ILIKE $3 OR name ILIKE $1 OR nif ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1 OR contact_person ILIKE $1)
       ORDER BY name ASC LIMIT $2`,
      `SELECT id, name, nif, phone FROM suppliers
       WHERE COALESCE(is_active, 1) = 1
         AND (LOWER(name) LIKE LOWER($1) OR LOWER(IFNULL(nif,'')) LIKE LOWER($1)
              OR LOWER(IFNULL(phone,'')) LIKE LOWER($1) OR LOWER(IFNULL(email,'')) LIKE LOWER($1)
              OR LOWER(IFNULL(contact_person,'')) LIKE LOWER($1))
       ORDER BY name ASC LIMIT $2`,
    ], p),
    sales: () => runSearch([
      `SELECT id, invoice_number, customer_name, total, status FROM sales
       WHERE invoice_number ILIKE $3 OR invoice_number ILIKE $1 OR customer_name ILIKE $1 OR customer_nif ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, invoice_number, customer_name, total, status FROM sales
       WHERE LOWER(IFNULL(invoice_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(customer_name,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(customer_nif,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    purchaseInvoices: () => runSearch([
      `SELECT id, invoice_number, supplier_name, total, status FROM purchase_invoices
       WHERE invoice_number ILIKE $3 OR invoice_number ILIKE $1 OR supplier_name ILIKE $1
          OR supplier_invoice_no ILIKE $1 OR supplier_nif ILIKE $1
       ORDER BY date DESC NULLS LAST LIMIT $2`,
      `SELECT id, invoice_number, supplier_name, total, status FROM purchase_invoices
       WHERE LOWER(IFNULL(invoice_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(supplier_name,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(supplier_invoice_no,'')) LIKE LOWER($1)
       ORDER BY date DESC LIMIT $2`,
    ], p),
    purchaseOrders: () => runSearch([
      `SELECT id, order_number, supplier_name, total, status FROM purchase_orders
       WHERE order_number ILIKE $3 OR order_number ILIKE $1 OR supplier_name ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, order_number, supplier_name, total, status FROM purchase_orders
       WHERE LOWER(IFNULL(order_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(supplier_name,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    salesOrders: () => runSearch([
      `SELECT id, order_number, client_name, client_nif, total, status FROM sales_orders
       WHERE order_number ILIKE $3 OR order_number ILIKE $1 OR client_name ILIKE $1 OR client_nif ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, order_number, client_name, client_nif, total, status FROM sales_orders
       WHERE LOWER(IFNULL(order_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(client_name,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(client_nif,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    proformas: () => runSearch([
      `SELECT id, proforma_number, client_name, client_nif, total, status FROM proformas
       WHERE proforma_number ILIKE $3 OR proforma_number ILIKE $1 OR client_name ILIKE $1 OR client_nif ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, proforma_number, client_name, client_nif, total, status FROM proformas
       WHERE LOWER(IFNULL(proforma_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(client_name,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(client_nif,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    creditNotes: () => runSearch([
      `SELECT id, document_number, customer_name, customer_nif, total, status FROM credit_notes
       WHERE document_number ILIKE $3 OR document_number ILIKE $1 OR customer_name ILIKE $1 OR customer_nif ILIKE $1
          OR original_invoice_number ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, document_number, customer_name, customer_nif, total, status FROM credit_notes
       WHERE LOWER(IFNULL(document_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(customer_name,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(original_invoice_number,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    debitNotes: () => runSearch([
      `SELECT id, document_number, customer_name, customer_nif, total, status FROM debit_notes
       WHERE document_number ILIKE $3 OR document_number ILIKE $1 OR customer_name ILIKE $1 OR customer_nif ILIKE $1
          OR original_invoice_number ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, document_number, customer_name, customer_nif, total, status FROM debit_notes
       WHERE LOWER(IFNULL(document_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(customer_name,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(original_invoice_number,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    transportDocuments: () => runSearch([
      `SELECT id, document_number, destination_name, vehicle_plate, related_invoice_number, status
       FROM transport_documents
       WHERE document_number ILIKE $3 OR document_number ILIKE $1 OR destination_name ILIKE $1 OR vehicle_plate ILIKE $1
          OR related_invoice_number ILIKE $1 OR transporter_name ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, document_number, destination_name, vehicle_plate, related_invoice_number, status
       FROM transport_documents
       WHERE LOWER(IFNULL(document_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(destination_name,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(vehicle_plate,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    expenses: () => runSearch([
      `SELECT id, expense_number, description, payee_name, invoice_number, status FROM expenses
       WHERE expense_number ILIKE $3 OR expense_number ILIKE $1 OR description ILIKE $1 OR payee_name ILIKE $1
          OR invoice_number ILIKE $1 OR payee_nif ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, expense_number, description, payee_name, invoice_number, status FROM expenses
       WHERE LOWER(IFNULL(expense_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(description,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(payee_name,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(invoice_number,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    payments: () => runSearch([
      `SELECT id, payment_number, payment_type, entity_name, reference, amount FROM payments
       WHERE payment_number ILIKE $3 OR payment_number ILIKE $1 OR entity_name ILIKE $1 OR reference ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, payment_number, payment_type, entity_name, reference, amount FROM payments
       WHERE LOWER(IFNULL(payment_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(entity_name,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(reference,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    journals: () => runSearch([
      `SELECT id, entry_number, description, reference_type FROM journal_entries
       WHERE entry_number ILIKE $3 OR entry_number ILIKE $1 OR description ILIKE $1
       ORDER BY entry_date DESC, created_at DESC LIMIT $2`,
      `SELECT id, entry_number, description, reference_type FROM journal_entries
       WHERE LOWER(IFNULL(entry_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(description,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    accounts: () => runSearch([
      `SELECT id, code, name FROM chart_of_accounts
       WHERE COALESCE(is_active, true) = true
         AND (code ILIKE $3 OR code ILIKE $1 OR name ILIKE $1 OR description ILIKE $1)
       ORDER BY code ASC LIMIT $2`,
      `SELECT id, code, name FROM chart_of_accounts
       WHERE COALESCE(is_active, 1) = 1
         AND (LOWER(code) LIKE LOWER($1) OR LOWER(name) LIKE LOWER($1)
              OR LOWER(IFNULL(description,'')) LIKE LOWER($1))
       ORDER BY code ASC LIMIT $2`,
    ], p),
    bankAccounts: () => runSearch([
      `SELECT id, name, bank_name, account_number, iban FROM bank_accounts
       WHERE COALESCE(is_active, true) = true
         AND (name ILIKE $1 OR bank_name ILIKE $1 OR account_number ILIKE $1 OR iban ILIKE $1)
       ORDER BY name ASC LIMIT $2`,
      `SELECT id, name, bank_name, account_number, iban FROM bank_accounts
       WHERE COALESCE(is_active, 1) = 1
         AND (LOWER(IFNULL(name,'')) LIKE LOWER($1) OR LOWER(IFNULL(bank_name,'')) LIKE LOWER($1)
              OR LOWER(IFNULL(account_number,'')) LIKE LOWER($1))
       ORDER BY name ASC LIMIT $2`,
    ], p),
    stockTransfers: () => runSearch([
      `SELECT id, transfer_number, from_branch_name, to_branch_name, status FROM stock_transfers
       WHERE transfer_number ILIKE $3 OR transfer_number ILIKE $1 OR from_branch_name ILIKE $1 OR to_branch_name ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, transfer_number, from_branch_name, to_branch_name, status FROM stock_transfers
       WHERE LOWER(IFNULL(transfer_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(from_branch_name,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(to_branch_name,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    importOrders: () => runSearch([
      `SELECT id, order_number, supplier_name, customs_declaration_number, status FROM import_orders
       WHERE order_number ILIKE $3 OR order_number ILIKE $1 OR supplier_name ILIKE $1 OR customs_declaration_number ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, order_number, supplier_name, customs_declaration_number, status FROM import_orders
       WHERE LOWER(IFNULL(order_number,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(supplier_name,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
    users: () => runSearch([
      `SELECT id, name, email, username FROM users
       WHERE COALESCE(is_active, true) = true
         AND (name ILIKE $3 OR name ILIKE $1 OR email ILIKE $1 OR username ILIKE $1)
       ORDER BY name ASC LIMIT $2`,
      `SELECT id, name, email FROM users
       WHERE COALESCE(is_active, 1) = 1
         AND (LOWER(name) LIKE LOWER($1) OR LOWER(IFNULL(email,'')) LIKE LOWER($1))
       ORDER BY name ASC LIMIT $2`,
    ], p),
    branches: () => runSearch([
      `SELECT id, name, code, phone FROM branches
       WHERE name ILIKE $3 OR name ILIKE $1 OR code ILIKE $1 OR phone ILIKE $1 OR address ILIKE $1
       ORDER BY name ASC LIMIT $2`,
      `SELECT id, name, code, phone FROM branches
       WHERE LOWER(name) LIKE LOWER($1) OR LOWER(IFNULL(code,'')) LIKE LOWER($1)
          OR LOWER(IFNULL(phone,'')) LIKE LOWER($1)
       ORDER BY name ASC LIMIT $2`,
    ], p),
    categories: () => runSearch([
      `SELECT id, name, description FROM categories
       WHERE COALESCE(is_active, true) = true
         AND (name ILIKE $3 OR name ILIKE $1 OR description ILIKE $1)
       ORDER BY name ASC LIMIT $2`,
      `SELECT id, name, description FROM categories
       WHERE COALESCE(is_active, 1) = 1
         AND (LOWER(name) LIKE LOWER($1) OR LOWER(IFNULL(description,'')) LIKE LOWER($1))
       ORDER BY name ASC LIMIT $2`,
    ], p),
    caixas: () => runSearch([
      `SELECT id, name, branch_name, status FROM caixas
       WHERE name ILIKE $3 OR name ILIKE $1 OR branch_name ILIKE $1
       ORDER BY name ASC LIMIT $2`,
      `SELECT id, name, branch_name, status FROM caixas
       WHERE LOWER(name) LIKE LOWER($1) OR LOWER(IFNULL(branch_name,'')) LIKE LOWER($1)
       ORDER BY name ASC LIMIT $2`,
    ], p),
    // Cheap document-number match only — joined client/supplier scans blocked the whole search.
    openItems: () => runSearch([
      `SELECT id, document_number, entity_type, entity_id, status FROM open_items
       WHERE document_number ILIKE $3 OR document_number ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      `SELECT id, document_number, entity_type, entity_id, status FROM open_items
       WHERE LOWER(IFNULL(document_number,'')) LIKE LOWER($1)
       ORDER BY created_at DESC LIMIT $2`,
    ], p),
  };
}

function serialize(key, rows) {
  const list = rows || [];
  switch (key) {
    case 'clients':
      return list.map((r) => ({
        id: r.id, name: r.name, nif: r.nif, phone: r.phone,
        href: href('/clients', { clientId: r.id }),
      }));
    case 'products':
      return list.map((r) => ({
        id: r.id, name: r.name, sku: r.sku, barcode: r.barcode, stock: r.stock,
        href: href('/inventory', { productId: r.id, sku: r.sku, name: r.name }),
      }));
    case 'suppliers':
      return list.map((r) => ({
        id: r.id, name: r.name, nif: r.nif, phone: r.phone,
        href: href('/suppliers', { supplierId: r.id }),
      }));
    case 'sales':
      return list.map((r) => ({
        id: r.id, invoiceNumber: r.invoice_number, customerName: r.customer_name,
        total: r.total, status: r.status,
        href: href('/invoices', { invoiceId: r.id, q: r.invoice_number }),
      }));
    case 'purchaseInvoices':
      return list.map((r) => ({
        id: r.id, invoiceNumber: r.invoice_number, supplierName: r.supplier_name,
        total: r.total, status: r.status,
        href: href('/purchase-invoices', { invoiceId: r.id, q: r.invoice_number }),
      }));
    case 'purchaseOrders':
      return list.map((r) => ({
        id: r.id, orderNumber: r.order_number, supplierName: r.supplier_name,
        href: href('/purchase-orders', { orderId: r.id, q: r.order_number }),
      }));
    case 'salesOrders':
      return list.map((r) => ({
        id: r.id, orderNumber: r.order_number, clientName: r.client_name,
        href: href('/sales-orders', { orderId: r.id }),
      }));
    case 'proformas':
      return list.map((r) => ({
        id: r.id, proformaNumber: r.proforma_number, clientName: r.client_name,
        href: href('/proforma', { proformaId: r.id }),
      }));
    case 'creditNotes':
      return list.map((r) => ({
        id: r.id, documentNumber: r.document_number, customerName: r.customer_name,
        href: href('/fiscal-documents', { creditNoteId: r.id }),
      }));
    case 'debitNotes':
      return list.map((r) => ({
        id: r.id, documentNumber: r.document_number, customerName: r.customer_name,
        href: href('/fiscal-documents', { debitNoteId: r.id }),
      }));
    case 'transportDocuments':
      return list.map((r) => ({
        id: r.id, documentNumber: r.document_number, destinationName: r.destination_name,
        href: href('/fiscal-documents', { transportId: r.id }),
      }));
    case 'expenses':
      return list.map((r) => ({
        id: r.id, expenseNumber: r.expense_number, description: r.description, payeeName: r.payee_name,
        href: href('/expenses', { expenseId: r.id }),
      }));
    case 'payments':
      return list.map((r) => ({
        id: r.id, paymentNumber: r.payment_number, paymentType: r.payment_type, entityName: r.entity_name,
        href: href('/payments', { paymentId: r.id, q: r.payment_number, type: r.payment_type }),
      }));
    case 'journals':
      return list.map((r) => ({
        id: r.id, entryNumber: r.entry_number, description: r.description,
        href: href('/journals', { journalId: r.id, q: r.entry_number }),
      }));
    case 'accounts':
      return list.map((r) => ({
        id: r.id, code: r.code, name: r.name,
        href: href('/chart-of-accounts', { accountId: r.id, code: r.code }),
      }));
    case 'bankAccounts':
      return list.map((r) => ({
        id: r.id, name: r.name, bankName: r.bank_name, accountNumber: r.account_number,
        href: href('/bank-accounts', { bankAccountId: r.id }),
      }));
    case 'stockTransfers':
      return list.map((r) => ({
        id: r.id, transferNumber: r.transfer_number, fromBranchName: r.from_branch_name, toBranchName: r.to_branch_name,
        href: href('/stock-transfer', { transferId: r.id }),
      }));
    case 'importOrders':
      return list.map((r) => ({
        id: r.id, orderNumber: r.order_number, supplierName: r.supplier_name,
        href: href('/import', { importOrderId: r.id }),
      }));
    case 'users':
      return list.map((r) => ({
        id: r.id, name: r.name, email: r.email, username: r.username,
        href: href('/users', { userId: r.id }),
      }));
    case 'branches':
      return list.map((r) => ({
        id: r.id, name: r.name, code: r.code,
        href: href('/branches', { branchId: r.id }),
      }));
    case 'categories':
      return list.map((r) => ({
        id: r.id, name: r.name,
        href: href('/categories', { categoryId: r.id }),
      }));
    case 'caixas':
      return list.map((r) => ({
        id: r.id, name: r.name, branchName: r.branch_name,
        href: href('/caixa', { caixaId: r.id }),
      }));
    case 'openItems':
      return list.map((r) => {
        const path = r.entity_type === 'supplier' ? '/payables' : '/receivables';
        return {
          id: r.id,
          documentNumber: r.document_number,
          entityType: r.entity_type,
          entityName: r.entity_name,
          href: href(path, { openItemId: r.id, q: r.document_number || r.entity_name }),
        };
      });
    default:
      return [];
  }
}

async function runKeys(keys, p) {
  const runners = queries(p);
  const raw = {};
  await Promise.all(keys.map(async (key) => {
    const fn = runners[key];
    raw[key] = fn ? await fn() : emptyResult();
  }));
  return raw;
}

module.exports = function searchRouter() {
  const router = express.Router();

  router.get('/', requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const payload = emptyPayload(q);
      if (q.length < 2) {
        return res.json(payload);
      }
      const scopeRaw = String(req.query.scope || 'all').toLowerCase();
      const scope = scopeRaw === 'quick' || scopeRaw === 'more' ? scopeRaw : 'all';
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 6));
      const p = [likeContains(q), limit, likePrefix(q)];
      const keys = scope === 'quick' ? QUICK_KEYS : scope === 'more' ? MORE_KEYS : QUICK_KEYS.concat(MORE_KEYS);
      const raw = await runKeys(keys, p);
      keys.forEach((key) => {
        payload[key] = serialize(key, raw[key]?.rows);
      });
      payload.scope = scope;
      res.json(payload);
    } catch (e) {
      console.error('[SEARCH]', e);
      res.status(500).json({ error: e.message || 'Search failed' });
    }
  });

  return router;
};
