/* eslint-disable no-console */
/**
 * One-time migration: SQLite (better-sqlite3) -> PostgreSQL (pg).
 *
 * Why this exists:
 * - SQLite DB in this project stores TEXT ids (often non-UUID, e.g. hex/random).
 * - PostgreSQL schema uses UUID primary keys.
 * - We must generate deterministic mappings so all foreign keys remain consistent.
 *
 * Prerequisite: empty-ish Postgres DB with schema applied:
 *   cd backend && npm run migrate   (with DATABASE_URL set)
 *
 * Usage (PowerShell):
 *   $env:SQLITE_PATH="C:\NEXOR ERP\data\erp.db"
 *   $env:DATABASE_URL="postgres://postgres:password@localhost:5432/kwanza_erp"
 *   node scripts/migrate-sqlite-to-postgres.js
 *
 * Optional:
 *   $env:MIGRATE_DRY_RUN="true"  # no writes
 */
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SQLITE_PATH = process.env.SQLITE_PATH || 'C:\\nexor\\erp.db';
const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = String(process.env.MIGRATE_DRY_RUN || '').toLowerCase() === 'true';

if (!DATABASE_URL) {
  console.error('[MIGRATE] Missing DATABASE_URL (PostgreSQL connection string).');
  process.exit(1);
}

function uuid() {
  return crypto.randomUUID();
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'y'].includes(v.toLowerCase());
  return false;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

function mapRef(map, id) {
  if (id == null || id === '') return null;
  return map.get(String(id)) || null;
}

function mapDocumentId(id, maps) {
  const s = String(id);
  return (
    mapRef(maps.purchase_invoices, s)
    || mapRef(maps.sales, s)
    || mapRef(maps.payments, s)
    || null
  );
}

function mapEntityId(entityType, entityId, maps) {
  const s = String(entityId);
  if (entityType === 'supplier') return mapRef(maps.suppliers, s);
  if (entityType === 'customer') return mapRef(maps.clients, s);
  return null;
}

function parseDateOnly(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Build id mapping for a table that has a single primary key column `id`.
 * Returns Map<oldId:string, newId:uuid-string>
 */
function buildIdMap(sqlite, table) {
  const rows = sqlite.prepare(`SELECT id FROM ${table}`).all();
  const map = new Map();
  for (const r of rows) {
    const oldId = String(r.id);
    map.set(oldId, uuid());
  }
  return map;
}

async function ensureCanConnect(pg) {
  await pg.query('SELECT 1');
}

async function truncateTarget(pg) {
  // Keep it limited to the core tables that exist in both schemas and are safe to re-import.
  const tables = [
    'clearings',
    'open_items',
    'stock_movements',
    'payments',
    'purchase_invoices',
    'sale_items',
    'sales',
    'purchase_order_items',
    'purchase_orders',
    'stock_transfer_items',
    'stock_transfers',
    'daily_reports',
    'products',
    'suppliers',
    'clients',
    'users',
    'branches',
    'categories',
  ];

  if (DRY_RUN) {
    console.log('[MIGRATE] DRY RUN: would truncate tables:', tables.join(', '));
    return;
  }

  // TRUNCATE in dependency-safe order with CASCADE.
  await pg.query(`TRUNCATE TABLE ${tables.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

async function insertBatch(pg, table, columns, rows) {
  if (!rows.length) return 0;
  if (DRY_RUN) return rows.length;

  const values = [];
  const tuples = rows.map((row, idx) => {
    const base = idx * columns.length;
    for (let i = 0; i < columns.length; i++) values.push(row[columns[i]]);
    const placeholders = columns.map((_, i) => `$${base + i + 1}`).join(', ');
    return `(${placeholders})`;
  });

  const sql = `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES ${tuples.join(', ')}`;
  await pg.query(sql, values);
  return rows.length;
}

async function main() {
  console.log('[MIGRATE] SQLite -> PostgreSQL migration starting');
  console.log('[MIGRATE] SQLITE_PATH:', SQLITE_PATH);
  console.log('[MIGRATE] DRY_RUN:', DRY_RUN);

  const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  const pg = new Pool({ connectionString: DATABASE_URL });

  try {
    await ensureCanConnect(pg);

    // Basic presence checks (helps users understand missing tables).
    const sqliteTables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(r => r.name);
    console.log('[MIGRATE] SQLite tables found:', sqliteTables.length);

    // Build ID maps
    const maps = {
      branches: sqliteTables.includes('branches') ? buildIdMap(sqlite, 'branches') : new Map(),
      users: sqliteTables.includes('users') ? buildIdMap(sqlite, 'users') : new Map(),
      categories: sqliteTables.includes('categories') ? buildIdMap(sqlite, 'categories') : new Map(),
      suppliers: sqliteTables.includes('suppliers') ? buildIdMap(sqlite, 'suppliers') : new Map(),
      clients: sqliteTables.includes('clients') ? buildIdMap(sqlite, 'clients') : new Map(),
      products: sqliteTables.includes('products') ? buildIdMap(sqlite, 'products') : new Map(),
      sales: sqliteTables.includes('sales') ? buildIdMap(sqlite, 'sales') : new Map(),
      sale_items: sqliteTables.includes('sale_items') ? buildIdMap(sqlite, 'sale_items') : new Map(),
      purchase_orders: sqliteTables.includes('purchase_orders') ? buildIdMap(sqlite, 'purchase_orders') : new Map(),
      purchase_order_items: sqliteTables.includes('purchase_order_items') ? buildIdMap(sqlite, 'purchase_order_items') : new Map(),
      stock_transfers: sqliteTables.includes('stock_transfers') ? buildIdMap(sqlite, 'stock_transfers') : new Map(),
      stock_transfer_items: sqliteTables.includes('stock_transfer_items') ? buildIdMap(sqlite, 'stock_transfer_items') : new Map(),
      daily_reports: sqliteTables.includes('daily_reports') ? buildIdMap(sqlite, 'daily_reports') : new Map(),
      purchase_invoices: sqliteTables.includes('purchase_invoices') ? buildIdMap(sqlite, 'purchase_invoices') : new Map(),
      payments: sqliteTables.includes('payments') ? buildIdMap(sqlite, 'payments') : new Map(),
      open_items: sqliteTables.includes('open_items') ? buildIdMap(sqlite, 'open_items') : new Map(),
      clearings: sqliteTables.includes('clearings') ? buildIdMap(sqlite, 'clearings') : new Map(),
      stock_movements: sqliteTables.includes('stock_movements') ? buildIdMap(sqlite, 'stock_movements') : new Map(),
    };

    await pg.query('BEGIN');
    await truncateTarget(pg);

    // ========== branches ==========
    if (sqliteTables.includes('branches')) {
      const src = sqlite.prepare('SELECT * FROM branches').all();
      const rows = src.map(r => ({
        id: maps.branches.get(String(r.id)),
        name: r.name,
        code: r.code || null,
        address: r.address || null,
        phone: r.phone || null,
        is_main: safeBool(r.is_main),
        created_at: r.created_at ? new Date(r.created_at) : new Date(),
      }));
      await insertBatch(pg, 'branches', ['id', 'name', 'code', 'address', 'phone', 'is_main', 'created_at'], rows);
      console.log('[MIGRATE] branches:', rows.length);
    }

    // ========== users ==========
    if (sqliteTables.includes('users')) {
      const src = sqlite.prepare('SELECT * FROM users').all();
      const rows = src.map(r => ({
        id: maps.users.get(String(r.id)),
        email: r.email,
        password_hash: r.password_hash || 'admin', // legacy SQLite sometimes stores plain 'admin'
        name: r.name,
        role: r.role || 'admin',
        branch_id: r.branch_id ? (maps.branches.get(String(r.branch_id)) || null) : null,
        is_active: safeBool(r.is_active),
        created_at: r.created_at ? new Date(r.created_at) : new Date(),
      }));
      await insertBatch(
        pg,
        'users',
        ['id', 'email', 'password_hash', 'name', 'role', 'branch_id', 'is_active', 'created_at'],
        rows
      );
      console.log('[MIGRATE] users:', rows.length);
    }

    // ========== categories ==========
    if (sqliteTables.includes('categories')) {
      const src = sqlite.prepare('SELECT * FROM categories').all();
      const rows = src.map(r => ({
        id: maps.categories.get(String(r.id)),
        name: r.name,
        description: r.description || null,
        color: r.color || null,
        is_active: safeBool(r.is_active),
        created_at: r.created_at ? new Date(r.created_at) : new Date(),
        updated_at: r.updated_at ? new Date(r.updated_at) : new Date(),
      }));
      await insertBatch(pg, 'categories', ['id', 'name', 'description', 'color', 'is_active', 'created_at', 'updated_at'], rows);
      console.log('[MIGRATE] categories:', rows.length);
    }

    // ========== suppliers ==========
    if (sqliteTables.includes('suppliers')) {
      const src = sqlite.prepare('SELECT * FROM suppliers').all();
      const rows = src.map(r => ({
        id: maps.suppliers.get(String(r.id)),
        name: r.name,
        nif: r.nif || null,
        email: r.email || null,
        phone: r.phone || null,
        address: r.address || null,
        city: r.city || null,
        country: r.country || 'Angola',
        contact_person: r.contact_person || r.contactPerson || null,
        payment_terms: r.payment_terms || r.paymentTerms || '30_days',
        is_active: safeBool(r.is_active),
        notes: r.notes || null,
        created_at: r.created_at ? new Date(r.created_at) : new Date(),
        updated_at: r.updated_at ? new Date(r.updated_at) : new Date(),
      }));
      await insertBatch(
        pg,
        'suppliers',
        ['id', 'name', 'nif', 'email', 'phone', 'address', 'city', 'country', 'contact_person', 'payment_terms', 'is_active', 'notes', 'created_at', 'updated_at'],
        rows
      );
      console.log('[MIGRATE] suppliers:', rows.length);
    }

    // ========== clients ==========
    if (sqliteTables.includes('clients')) {
      const src = sqlite.prepare('SELECT * FROM clients').all();
      const rows = src.map(r => ({
        id: maps.clients.get(String(r.id)),
        name: r.name,
        nif: r.nif || null,
        email: r.email || null,
        phone: r.phone || null,
        address: r.address || null,
        city: r.city || null,
        country: r.country || 'Angola',
        credit_limit: safeNumber(r.credit_limit),
        current_balance: safeNumber(r.current_balance),
        is_active: safeBool(r.is_active),
        created_at: r.created_at ? new Date(r.created_at) : new Date(),
        updated_at: r.updated_at ? new Date(r.updated_at) : new Date(),
      }));
      await insertBatch(
        pg,
        'clients',
        ['id', 'name', 'nif', 'email', 'phone', 'address', 'city', 'country', 'credit_limit', 'current_balance', 'is_active', 'created_at', 'updated_at'],
        rows
      );
      console.log('[MIGRATE] clients:', rows.length);
    }

    // ========== products ==========
    if (sqliteTables.includes('products')) {
      const src = sqlite.prepare('SELECT * FROM products').all();
      const rows = src.map(r => ({
        id: maps.products.get(String(r.id)),
        name: r.name,
        sku: r.sku || '',
        barcode: r.barcode || null,
        category: r.category || null,
        price: safeNumber(r.price),
        cost: safeNumber(r.cost),
        stock: Math.max(0, Math.trunc(safeNumber(r.stock))),
        unit: r.unit || 'un',
        tax_rate: safeNumber(r.tax_rate),
        branch_id: r.branch_id ? (maps.branches.get(String(r.branch_id)) || null) : null,
        is_active: safeBool(r.is_active),
        created_at: r.created_at ? new Date(r.created_at) : new Date(),
      }));
      await insertBatch(
        pg,
        'products',
        ['id', 'name', 'sku', 'barcode', 'category', 'price', 'cost', 'stock', 'unit', 'tax_rate', 'branch_id', 'is_active', 'created_at'],
        rows
      );
      console.log('[MIGRATE] products:', rows.length);
    }

    // ========== sales ==========
    if (sqliteTables.includes('sales')) {
      const src = sqlite.prepare('SELECT * FROM sales').all();
      const rows = src.map(r => ({
        id: maps.sales.get(String(r.id)),
        invoice_number: r.invoice_number || r.invoiceNumber || null,
        branch_id: r.branch_id ? (maps.branches.get(String(r.branch_id)) || null) : null,
        cashier_id: r.cashier_id ? (maps.users.get(String(r.cashier_id)) || null) : null,
        cashier_name: r.cashier_name || null,
        subtotal: safeNumber(r.subtotal),
        tax_amount: safeNumber(r.tax_amount),
        discount: safeNumber(r.discount),
        total: safeNumber(r.total),
        payment_method: r.payment_method || null,
        amount_paid: safeNumber(r.amount_paid),
        change: safeNumber(r.change),
        customer_nif: r.customer_nif || null,
        customer_name: r.customer_name || null,
        status: r.status || 'completed',
        created_at: r.created_at ? new Date(r.created_at) : new Date(),
      }));

      // Skip rows without invoice_number (Postgres schema requires unique + not null).
      const filtered = rows.filter(r => !!r.invoice_number);
      await insertBatch(
        pg,
        'sales',
        [
          'id', 'invoice_number', 'branch_id', 'cashier_id', 'cashier_name',
          'subtotal', 'tax_amount', 'discount', 'total', 'payment_method',
          'amount_paid', 'change', 'customer_nif', 'customer_name', 'status', 'created_at'
        ],
        filtered
      );
      console.log('[MIGRATE] sales:', filtered.length, '(skipped', rows.length - filtered.length, 'missing invoice_number)');
    }

    // ========== sale_items ==========
    if (sqliteTables.includes('sale_items')) {
      const src = sqlite.prepare('SELECT * FROM sale_items').all();
      const rows = src
        .map(r => {
          const saleId = r.sale_id ? maps.sales.get(String(r.sale_id)) : null;
          if (!saleId) return null;
          return {
            id: maps.sale_items.get(String(r.id)),
            sale_id: saleId,
            product_id: r.product_id ? (maps.products.get(String(r.product_id)) || null) : null,
            product_name: r.product_name || '',
            sku: r.sku || null,
            quantity: Math.trunc(safeNumber(r.quantity)),
            unit_price: safeNumber(r.unit_price),
            discount: safeNumber(r.discount),
            tax_rate: safeNumber(r.tax_rate),
            tax_amount: safeNumber(r.tax_amount),
            subtotal: safeNumber(r.subtotal),
          };
        })
        .filter(Boolean);

      await insertBatch(
        pg,
        'sale_items',
        ['id', 'sale_id', 'product_id', 'product_name', 'sku', 'quantity', 'unit_price', 'discount', 'tax_rate', 'tax_amount', 'subtotal'],
        rows
      );
      console.log('[MIGRATE] sale_items:', rows.length);
    }

    // ========== purchase_invoices ==========
    if (sqliteTables.includes('purchase_invoices')) {
      const src = sqlite.prepare('SELECT * FROM purchase_invoices').all();
      const rows = src.map(r => ({
        id: maps.purchase_invoices.get(String(r.id)),
        invoice_number: r.invoice_number,
        supplier_account_code: r.supplier_account_code || '',
        supplier_name: r.supplier_name || '',
        supplier_id: r.supplier_id ? String(r.supplier_id) : '',
        supplier_nif: r.supplier_nif || '',
        supplier_phone: r.supplier_phone || '',
        supplier_balance: safeNumber(r.supplier_balance),
        ref: r.ref || '',
        supplier_invoice_no: r.supplier_invoice_no || '',
        contact: r.contact || '',
        department: r.department || '',
        ref2: r.ref2 || '',
        date: parseDateOnly(r.date) || new Date(),
        payment_date: parseDateOnly(r.payment_date),
        project: r.project || '',
        currency: r.currency || 'KZ',
        warehouse_id: r.warehouse_id || '',
        warehouse_name: r.warehouse_name || '',
        price_type: r.price_type || 'last_price',
        address: r.address || '',
        purchase_account_code: r.purchase_account_code || '2.1.1',
        iva_account_code: r.iva_account_code || '3.3.1',
        transaction_type: r.transaction_type || 'ALL',
        currency_rate: safeNumber(r.currency_rate),
        tax_rate_2: safeNumber(r.tax_rate_2),
        order_no: r.order_no || '',
        surcharge_percent: safeNumber(r.surcharge_percent),
        change_price: safeBool(r.change_price),
        is_pending: safeBool(r.is_pending),
        extra_note: r.extra_note || '',
        lines_json: r.lines_json || '[]',
        journal_lines_json: r.journal_lines_json || '[]',
        subtotal: safeNumber(r.subtotal),
        iva_total: safeNumber(r.iva_total),
        total: safeNumber(r.total),
        status: r.status || 'confirmed',
        purchase_returns_status: r.purchase_returns_status || 'none',
        purchase_returns_closed_at: r.purchase_returns_closed_at ? new Date(r.purchase_returns_closed_at) : null,
        branch_id: r.branch_id ? String(r.branch_id) : '',
        branch_name: r.branch_name || '',
        created_by: r.created_by || '',
        created_by_name: r.created_by_name || '',
        created_at: r.created_at ? new Date(r.created_at) : new Date(),
        updated_at: r.updated_at ? new Date(r.updated_at) : new Date(),
      }));
      const filtered = rows.filter(r => !!r.invoice_number);
      await insertBatch(
        pg,
        'purchase_invoices',
        [
          'id', 'invoice_number', 'supplier_account_code', 'supplier_name', 'supplier_id', 'supplier_nif',
          'supplier_phone', 'supplier_balance', 'ref', 'supplier_invoice_no', 'contact', 'department', 'ref2',
          'date', 'payment_date', 'project', 'currency', 'warehouse_id', 'warehouse_name', 'price_type', 'address',
          'purchase_account_code', 'iva_account_code', 'transaction_type', 'currency_rate', 'tax_rate_2', 'order_no',
          'surcharge_percent', 'change_price', 'is_pending', 'extra_note', 'lines_json', 'journal_lines_json',
          'subtotal', 'iva_total', 'total', 'status', 'purchase_returns_status', 'purchase_returns_closed_at',
          'branch_id', 'branch_name', 'created_by', 'created_by_name', 'created_at', 'updated_at',
        ],
        filtered
      );
      console.log('[MIGRATE] purchase_invoices:', filtered.length);
    }

    // ========== payments ==========
    if (sqliteTables.includes('payments')) {
      const src = sqlite.prepare('SELECT * FROM payments').all();
      const rows = src
        .map(r => {
          const entityId = mapEntityId(r.entity_type, r.entity_id, maps);
          if (!entityId) return null;
          return {
            id: maps.payments.get(String(r.id)),
            payment_number: r.payment_number,
            payment_type: r.payment_type,
            entity_type: r.entity_type,
            entity_id: entityId,
            entity_name: r.entity_name || null,
            payment_method: r.payment_method || 'cash',
            amount: safeNumber(r.amount),
            currency: r.currency || 'AOA',
            bank_account: r.bank_account || null,
            reference: r.reference || null,
            notes: r.notes || null,
            branch_id: r.branch_id ? mapRef(maps.branches, r.branch_id) : null,
            created_by: r.created_by ? mapRef(maps.users, r.created_by) : null,
            created_at: r.created_at ? new Date(r.created_at) : new Date(),
            posted_at: r.posted_at ? new Date(r.posted_at) : null,
          };
        })
        .filter(Boolean);
      await insertBatch(
        pg,
        'payments',
        [
          'id', 'payment_number', 'payment_type', 'entity_type', 'entity_id', 'entity_name',
          'payment_method', 'amount', 'currency', 'bank_account', 'reference', 'notes',
          'branch_id', 'created_by', 'created_at', 'posted_at',
        ],
        rows
      );
      console.log('[MIGRATE] payments:', rows.length);
    }

    /** Open-item UUIDs actually inserted (skip clearings that point at dropped rows). */
    const insertedOpenItemIds = new Set();

    // ========== open_items (AR/AP checklist + reports) ==========
    if (sqliteTables.includes('open_items')) {
      const src = sqlite.prepare('SELECT * FROM open_items').all();
      const rows = src
        .map(r => {
          const entityId = mapEntityId(r.entity_type, r.entity_id, maps);
          const documentId = mapDocumentId(r.document_id, maps);
          if (!entityId || !documentId) return null;
          return {
            id: maps.open_items.get(String(r.id)),
            entity_type: r.entity_type,
            entity_id: entityId,
            document_type: r.document_type,
            document_id: documentId,
            document_number: r.document_number,
            document_date: parseDateOnly(r.document_date) || new Date(),
            due_date: parseDateOnly(r.due_date),
            currency: r.currency || 'AOA',
            original_amount: safeNumber(r.original_amount),
            remaining_amount: safeNumber(r.remaining_amount),
            is_debit: safeBool(r.is_debit),
            status: r.status || 'open',
            branch_id: r.branch_id ? mapRef(maps.branches, r.branch_id) : null,
            created_at: r.created_at ? new Date(r.created_at) : new Date(),
            cleared_at: r.cleared_at ? new Date(r.cleared_at) : null,
          };
        })
        .filter(Boolean);
      for (const row of rows) insertedOpenItemIds.add(row.id);
      await insertBatch(
        pg,
        'open_items',
        [
          'id', 'entity_type', 'entity_id', 'document_type', 'document_id', 'document_number',
          'document_date', 'due_date', 'currency', 'original_amount', 'remaining_amount',
          'is_debit', 'status', 'branch_id', 'created_at', 'cleared_at',
        ],
        rows
      );
      console.log('[MIGRATE] open_items:', rows.length, '(skipped', src.length - rows.length, 'unmapped refs)');
    }

    // ========== clearings ==========
    if (sqliteTables.includes('clearings')) {
      const src = sqlite.prepare('SELECT * FROM clearings').all();
      const rows = src
        .map(r => {
          const debit = mapRef(maps.open_items, r.debit_item_id);
          const credit = mapRef(maps.open_items, r.credit_item_id);
          if (!debit || !credit || !insertedOpenItemIds.has(debit) || !insertedOpenItemIds.has(credit)) return null;
          return {
            id: maps.clearings.get(String(r.id)),
            debit_item_id: debit,
            credit_item_id: credit,
            amount: safeNumber(r.amount),
            clearing_date: parseDateOnly(r.clearing_date) || new Date(),
            created_by: r.created_by ? mapRef(maps.users, r.created_by) : null,
            created_at: r.created_at ? new Date(r.created_at) : new Date(),
          };
        })
        .filter(Boolean);
      try {
        await insertBatch(
          pg,
          'clearings',
          ['id', 'debit_item_id', 'credit_item_id', 'amount', 'clearing_date', 'created_by', 'created_at'],
          rows
        );
        console.log('[MIGRATE] clearings:', rows.length);
      } catch (e) {
        console.warn('[MIGRATE] clearings skipped (non-fatal):', e.message);
      }
    }

    // ========== stock_movements ==========
    if (sqliteTables.includes('stock_movements')) {
      const src = sqlite.prepare('SELECT * FROM stock_movements').all();
      const rows = src
        .map(r => {
          const productId = mapRef(maps.products, r.product_id);
          if (!productId) return null;
          const refId = r.reference_id ? mapDocumentId(r.reference_id, maps) : null;
          return {
            id: maps.stock_movements.get(String(r.id)),
            product_id: productId,
            warehouse_id: r.warehouse_id ? mapRef(maps.branches, r.warehouse_id) : null,
            movement_type: r.movement_type,
            quantity: safeNumber(r.quantity),
            unit_cost: safeNumber(r.unit_cost),
            reference_type: r.reference_type,
            reference_id: refId,
            reference_number: r.reference_number || null,
            notes: r.notes || null,
            created_by: r.created_by ? mapRef(maps.users, r.created_by) : null,
            created_at: r.created_at ? new Date(r.created_at) : new Date(),
          };
        })
        .filter(Boolean);
      await insertBatch(
        pg,
        'stock_movements',
        [
          'id', 'product_id', 'warehouse_id', 'movement_type', 'quantity', 'unit_cost',
          'reference_type', 'reference_id', 'reference_number', 'notes', 'created_by', 'created_at',
        ],
        rows
      );
      console.log('[MIGRATE] stock_movements:', rows.length);
    }

    if (!DRY_RUN) await pg.query('COMMIT');
    else await pg.query('ROLLBACK');

    // Summary counts
    const countTables = [
      'branches', 'users', 'categories', 'suppliers', 'clients', 'products', 'sales', 'sale_items',
      'purchase_invoices', 'payments', 'open_items', 'clearings', 'stock_movements',
    ];
    for (const t of countTables) {
      try {
        const r = await pg.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
        console.log(`[MIGRATE] PG ${t}:`, r.rows[0]?.n ?? 0);
      } catch (e) {
        console.log(`[MIGRATE] PG ${t}: (skipped count)`, e.message);
      }
    }

    console.log('[MIGRATE] Done.');
  } catch (e) {
    try { await pg.query('ROLLBACK'); } catch (_) {}
    console.error('[MIGRATE] Failed:', e?.message || e);
    process.exitCode = 1;
  } finally {
    try { sqlite.close(); } catch (_) {}
    try { await pg.end(); } catch (_) {}
  }
}

main();

