/* eslint-disable no-console */
/**
 * Import caixas + bank_accounts from Electron SQLite (nexor_records) into PostgreSQL.
 *
 * This fixes empty bank pickers / only "Caixa Principal" in expenses when real tills
 * still live in local erp.db after switching to Docker Postgres.
 *
 * Usage on SERVER PC (PowerShell):
 *   cd C:\Users\user\Documents\GitHub\angola-invoice-finder
 *   $env:SQLITE_PATH="C:\nexor\erp.db"   # or largest erp.db under C:\NEXOR ERP\data
 *   docker compose exec -e SQLITE_PATH=/host-sqlite.db backend node scripts/import-treasury-from-sqlite.js
 *
 * Simpler (host Node + Docker Postgres URL):
 *   $env:SQLITE_PATH="C:\nexor\erp.db"
 *   $env:DATABASE_URL="postgres://postgres:PASSWORD@127.0.0.1:5432/kwanza_erp"
 *   node backend/scripts/import-treasury-from-sqlite.js
 *
 * Or use the helper:
 *   .\scripts\import-treasury-to-docker.ps1
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const SQLITE_PATH = process.env.SQLITE_PATH || 'C:\\nexor\\erp.db';
const DATABASE_URL = process.env.DATABASE_URL;

function parseJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function pickSqlitePath() {
  if (fs.existsSync(SQLITE_PATH)) return SQLITE_PATH;
  const candidates = [
    'C:\\nexor\\erp.db',
    'C:\\NEXOR ERP\\data\\erp.db',
    path.join(process.env.APPDATA || '', 'nexor-erp', 'erp.db'),
    path.join(process.env.LOCALAPPDATA || '', 'nexor-erp', 'erp.db'),
  ];
  let best = null;
  let bestSize = -1;
  for (const p of candidates) {
    try {
      if (!p || !fs.existsSync(p)) continue;
      const size = fs.statSync(p).size;
      if (size > bestSize) {
        best = p;
        bestSize = size;
      }
    } catch { /* skip */ }
  }
  return best;
}

async function ensureBankTable(pg) {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id VARCHAR(64) PRIMARY KEY,
      branch_id VARCHAR(64) NOT NULL DEFAULT '',
      branch_name VARCHAR(255) NOT NULL DEFAULT '',
      bank_name VARCHAR(255) NOT NULL DEFAULT '',
      name VARCHAR(255) NOT NULL DEFAULT '',
      account_number VARCHAR(100) NOT NULL DEFAULT '',
      iban VARCHAR(64) DEFAULT '',
      swift VARCHAR(32) DEFAULT '',
      currency VARCHAR(8) NOT NULL DEFAULT 'AOA',
      balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function resolveBranch(pg, branchId, branchName) {
  const id = str(branchId);
  const name = str(branchName);
  if (id) {
    const byId = await pg.query(
      'SELECT id, name FROM branches WHERE id::text = $1 LIMIT 1',
      [id],
    );
    if (byId.rows[0]) return { id: String(byId.rows[0].id), name: byId.rows[0].name || name };
  }
  if (name) {
    const byName = await pg.query(
      'SELECT id, name FROM branches WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1',
      [name],
    );
    if (byName.rows[0]) return { id: String(byName.rows[0].id), name: byName.rows[0].name };
  }
  return { id: id || '', name };
}

async function upsertCaixa(pg, row) {
  const id = str(row.id);
  if (!id) return false;
  const branch = await resolveBranch(pg, row.branch_id || row.branchId, row.branch_name || row.branchName);
  const name = str(row.name) || `Caixa - ${branch.name || branch.id || id}`;
  const opening = num(row.opening_balance ?? row.openingBalance);
  const balance = num(row.current_balance ?? row.currentBalance ?? opening);
  const now = new Date().toISOString();
  await pg.query(
    `INSERT INTO caixas (
      id, branch_id, branch_name, name, opening_balance, current_balance,
      status, petty_limit, daily_limit, requires_approval, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE(NULLIF($7,''),'closed'),$8,$9,$10,$11,$11)
    ON CONFLICT (id) DO UPDATE SET
      branch_id = EXCLUDED.branch_id,
      branch_name = EXCLUDED.branch_name,
      name = EXCLUDED.name,
      opening_balance = EXCLUDED.opening_balance,
      current_balance = EXCLUDED.current_balance,
      petty_limit = EXCLUDED.petty_limit,
      daily_limit = EXCLUDED.daily_limit,
      requires_approval = EXCLUDED.requires_approval,
      updated_at = EXCLUDED.updated_at`,
    [
      id,
      branch.id,
      branch.name,
      name,
      opening,
      balance,
      str(row.status) || 'closed',
      row.petty_limit != null || row.pettyLimit != null ? num(row.petty_limit ?? row.pettyLimit) : null,
      row.daily_limit != null || row.dailyLimit != null ? num(row.daily_limit ?? row.dailyLimit) : null,
      !!(row.requires_approval ?? row.requiresApproval),
      now,
    ],
  );
  return true;
}

async function upsertBank(pg, row) {
  const id = str(row.id);
  if (!id) return false;
  const branch = await resolveBranch(pg, row.branch_id || row.branchId, row.branch_name || row.branchName);
  const bankName = str(row.bank_name || row.bankName);
  const accountNumber = str(row.account_number || row.accountNumber);
  if (!bankName && !accountNumber) return false;
  const now = new Date().toISOString();
  await pg.query(
    `INSERT INTO bank_accounts (
      id, branch_id, branch_name, bank_name, name, account_number,
      iban, swift, currency, balance, is_active, is_primary, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
    ON CONFLICT (id) DO UPDATE SET
      branch_id = EXCLUDED.branch_id,
      branch_name = EXCLUDED.branch_name,
      bank_name = EXCLUDED.bank_name,
      name = EXCLUDED.name,
      account_number = EXCLUDED.account_number,
      iban = EXCLUDED.iban,
      swift = EXCLUDED.swift,
      currency = EXCLUDED.currency,
      balance = EXCLUDED.balance,
      is_active = EXCLUDED.is_active,
      is_primary = EXCLUDED.is_primary,
      updated_at = EXCLUDED.updated_at`,
    [
      id,
      branch.id,
      branch.name,
      bankName || 'Bank',
      str(row.name || row.accountName) || bankName || 'Account',
      accountNumber || id.slice(0, 12),
      str(row.iban),
      str(row.swift),
      str(row.currency) || 'AOA',
      num(row.balance ?? row.currentBalance ?? row.current_balance),
      row.is_active === undefined && row.isActive === undefined
        ? true
        : !!(row.is_active ?? row.isActive),
      !!(row.is_primary ?? row.isPrimary),
      now,
    ],
  );
  return true;
}

async function main() {
  if (!DATABASE_URL) {
    console.error('[TREASURY] Missing DATABASE_URL');
    process.exit(1);
  }
  const sqlitePath = pickSqlitePath();
  if (!sqlitePath) {
    console.error('[TREASURY] No SQLite erp.db found. Set SQLITE_PATH.');
    process.exit(1);
  }
  console.log(`[TREASURY] SQLite: ${sqlitePath}`);
  console.log(`[TREASURY] Postgres: ${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);

  const sqlite = new Database(sqlitePath, { readonly: true });
  const pg = new Pool({ connectionString: DATABASE_URL });

  try {
    await ensureBankTable(pg);

    const hasNexor = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nexor_records'")
      .get();
    if (!hasNexor) {
      console.error('[TREASURY] nexor_records table not found in SQLite.');
      process.exit(1);
    }

    const caixaRows = sqlite
      .prepare("SELECT id, data FROM nexor_records WHERE table_name = 'caixas'")
      .all();
    const bankRows = sqlite
      .prepare("SELECT id, data FROM nexor_records WHERE table_name = 'bank_accounts'")
      .all();

    console.log(`[TREASURY] Local caixas: ${caixaRows.length}, local banks: ${bankRows.length}`);

    let caixaOk = 0;
    for (const r of caixaRows) {
      const data = parseJson(r.data) || { id: r.id };
      if (!data.id) data.id = r.id;
      if (await upsertCaixa(pg, data)) caixaOk += 1;
    }

    let bankOk = 0;
    for (const r of bankRows) {
      const data = parseJson(r.data) || { id: r.id };
      if (!data.id) data.id = r.id;
      if (await upsertBank(pg, data)) bankOk += 1;
    }

    // Drop orphan seed caixa tied to missing 22222222… branch when a real SEDE/SOYO exists.
    const orphan = await pg.query(
      `DELETE FROM caixas
       WHERE branch_id::text = '22222222-2222-2222-2222-222222222222'
         AND NOT EXISTS (
           SELECT 1 FROM branches b WHERE b.id::text = '22222222-2222-2222-2222-222222222222'
         )
       RETURNING id, name`,
    );
    if (orphan.rows.length) {
      console.log(`[TREASURY] Removed ${orphan.rows.length} orphan seed caixa(s)`);
    }

    const pgCaixas = await pg.query('SELECT COUNT(*)::int AS n FROM caixas');
    const pgBanks = await pg.query('SELECT COUNT(*)::int AS n FROM bank_accounts');
    console.log(`[TREASURY] Upserted caixas=${caixaOk}, banks=${bankOk}`);
    console.log(`[TREASURY] Postgres now has caixas=${pgCaixas.rows[0].n}, bank_accounts=${pgBanks.rows[0].n}`);
    console.log('[TREASURY] OK — restart NEXOR expense dialog (or F5).');
  } finally {
    sqlite.close();
    await pg.end();
  }
}

main().catch((err) => {
  console.error('[TREASURY] FAILED:', err.message || err);
  process.exit(1);
});
