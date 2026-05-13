/* eslint-disable no-console */
/**
 * One-time migration: SQLite (better-sqlite3) -> PostgreSQL (pg).
 *
 * Why this exists:
 * - SQLite DB in this project stores TEXT ids (often non-UUID, e.g. hex/random).
 * - PostgreSQL schema uses UUID primary keys.
 * - We must generate deterministic mappings so all foreign keys remain consistent.
 *
 * Usage (PowerShell):
 *   $env:SQLITE_PATH="C:\nexor\erp.db"
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
        stock: Math.trunc(safeNumber(r.stock)),
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

    // Purchase orders + stock transfers can be added next; start with the high-value POS core first.

    if (!DRY_RUN) await pg.query('COMMIT');
    else await pg.query('ROLLBACK');

    // Summary counts
    const countTables = ['branches', 'users', 'categories', 'suppliers', 'clients', 'products', 'sales', 'sale_items'];
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

