/* eslint-disable no-console */
/**
 * Import chart_of_accounts + journal_* from SQLite into existing PostgreSQL DB.
 * Run after migrate-sqlite-to-postgres.js (reuses branch/user id maps from PG by code/email).
 *
 *   $env:SQLITE_PATH="C:\NEXOR ERP\data\belas.db"
 *   $env:DATABASE_URL="postgres://postgres:password@127.0.0.1:5432/kwanza_erp"
 *   node scripts/migrate-sqlite-chart-journals.cjs
 */
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const SQLITE_PATH = process.env.SQLITE_PATH || 'C:\\NEXOR ERP\\data\\belas.db';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[CHART] Missing DATABASE_URL');
  process.exit(1);
}

const uuid = () => crypto.randomUUID();

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

function buildIdMap(sqlite, table) {
  const rows = sqlite.prepare(`SELECT id FROM ${table}`).all();
  const map = new Map();
  for (const r of rows) map.set(String(r.id), uuid());
  return map;
}

async function main() {
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pg = new Pool({ connectionString: DATABASE_URL });

  try {
    const branchMap = new Map();
    for (const r of sqlite.prepare('SELECT id, code FROM branches').all()) {
      const pgRow = await pg.query('SELECT id FROM branches WHERE code = $1 LIMIT 1', [r.code]);
      if (pgRow.rows[0]) branchMap.set(String(r.id), pgRow.rows[0].id);
    }

    const userMap = new Map();
    for (const r of sqlite.prepare('SELECT id, email FROM users').all()) {
      const pgRow = await pg.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [r.email]);
      if (pgRow.rows[0]) userMap.set(String(r.id), pgRow.rows[0].id);
    }

    const coaMap = buildIdMap(sqlite, 'chart_of_accounts');
    const jeMap = buildIdMap(sqlite, 'journal_entries');
    const jelMap = buildIdMap(sqlite, 'journal_entry_lines');

    await pg.query('BEGIN');
    await pg.query('TRUNCATE journal_entry_lines, journal_entries, chart_of_accounts RESTART IDENTITY CASCADE');

    const coaRows = sqlite.prepare('SELECT * FROM chart_of_accounts ORDER BY level ASC, code ASC').all();
    for (const r of coaRows) {
      const newId = coaMap.get(String(r.id));
      const parentId = r.parent_id ? coaMap.get(String(r.parent_id)) || null : null;
      const branchId = r.branch_id ? branchMap.get(String(r.branch_id)) || null : null;
      await pg.query(
        `INSERT INTO chart_of_accounts (
          id, code, name, description, account_type, account_nature, parent_id, level,
          is_header, is_active, opening_balance, current_balance, branch_id, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          newId,
          r.code,
          r.name,
          r.description || null,
          r.account_type,
          r.account_nature,
          parentId,
          safeNumber(r.level) || 1,
          safeBool(r.is_header),
          safeBool(r.is_active),
          safeNumber(r.opening_balance),
          safeNumber(r.current_balance),
          branchId,
          r.created_at ? new Date(r.created_at) : new Date(),
          r.updated_at ? new Date(r.updated_at) : new Date(),
        ],
      );
    }
    console.log('[CHART] chart_of_accounts:', coaRows.length);

    const lineTotals = new Map();
    for (const r of sqlite.prepare('SELECT journal_entry_id, debit_amount, credit_amount FROM journal_entry_lines').all()) {
      const key = String(r.journal_entry_id);
      const cur = lineTotals.get(key) || { debit: 0, credit: 0 };
      cur.debit += safeNumber(r.debit_amount);
      cur.credit += safeNumber(r.credit_amount);
      lineTotals.set(key, cur);
    }

    const round2 = (n) => Math.round(safeNumber(n) * 100) / 100;

    const insertedJournalIds = new Set();

    const jeRows = sqlite.prepare('SELECT * FROM journal_entries ORDER BY entry_date, entry_number').all();
    for (const r of jeRows) {
      const newId = jeMap.get(String(r.id));
      const raw = lineTotals.get(String(r.id)) || { debit: r.total_debit, credit: r.total_credit };
      let td = round2(raw.debit);
      let tc = round2(raw.credit);
      if (Math.abs(td - tc) >= 0.01) {
        td = round2(r.total_debit);
        tc = round2(r.total_credit);
      }
      if (Math.abs(td - tc) >= 0.01) {
        const m = Math.max(td, tc);
        td = m;
        tc = m;
      }
      await pg.query(
        `INSERT INTO journal_entries (
          id, entry_number, entry_date, description, reference_type, reference_id,
          total_debit, total_credit, is_posted, posted_at, posted_by, branch_id, created_by, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          newId,
          r.entry_number,
          r.entry_date ? new Date(r.entry_date) : new Date(),
          r.description || '',
          r.reference_type || null,
          r.reference_id ? String(r.reference_id) : null,
          td,
          tc,
          safeBool(r.is_posted),
          r.posted_at ? new Date(r.posted_at) : null,
          r.posted_by ? userMap.get(String(r.posted_by)) || null : null,
          r.branch_id ? branchMap.get(String(r.branch_id)) || null : null,
          r.created_by ? userMap.get(String(r.created_by)) || null : null,
          r.created_at ? new Date(r.created_at) : new Date(),
        ],
      );
      insertedJournalIds.add(newId);
    }
    console.log('[CHART] journal_entries:', insertedJournalIds.size);

    const jelRows = sqlite.prepare('SELECT * FROM journal_entry_lines').all();
    let jelOk = 0;
    for (const r of jelRows) {
      const entryId = jeMap.get(String(r.journal_entry_id));
      const accountId = coaMap.get(String(r.account_id));
      if (!entryId || !accountId || !insertedJournalIds.has(entryId)) continue;
      await pg.query(
        `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, description, debit_amount, credit_amount, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          jelMap.get(String(r.id)),
          entryId,
          accountId,
          r.description || null,
          safeNumber(r.debit_amount),
          safeNumber(r.credit_amount),
          r.created_at ? new Date(r.created_at) : new Date(),
        ],
      );
      jelOk += 1;
    }
    console.log('[CHART] journal_entry_lines:', jelOk, '(skipped', jelRows.length - jelOk, ')');

    await pg.query('COMMIT');
    console.log('[CHART] Done.');
  } catch (e) {
    try { await pg.query('ROLLBACK'); } catch (_) {}
    console.error('[CHART] Failed:', e.message, e.detail || '', e.constraint || '');
    process.exitCode = 1;
  } finally {
    sqlite.close();
    await pg.end();
  }
}

main();
