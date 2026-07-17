/* eslint-disable no-console */
/**
 * Repair expense treasury directly in Docker Postgres.
 * Run inside nexor-backend (cwd /app):
 *   node scripts/repair-docker-treasury.js
 *
 * Or from host:
 *   .\scripts\repair-docker-treasury.ps1
 */
// Absolute path so this never breaks if cwd is wrong.
const db = require('/app/src/db');
const http = require('http');

async function main() {
  console.log('[REPAIR] engine=', db.engine);

  const sede = await db.query(`
    SELECT id, name, code, is_main FROM branches
    WHERE name ILIKE '%sede%' OR code ILIKE 'SEDE%' OR UPPER(code) = 'MAIN'
    ORDER BY CASE WHEN name ILIKE '%sede%' THEN 0 ELSE 1 END
    LIMIT 1
  `);
  if (sede.rows[0]) {
    await db.query('UPDATE branches SET is_main = FALSE WHERE id::text IS DISTINCT FROM $1', [
      String(sede.rows[0].id),
    ]);
    await db.query('UPDATE branches SET is_main = TRUE WHERE id = $1', [sede.rows[0].id]);
    console.log('[REPAIR] HQ branch:', sede.rows[0].name, sede.rows[0].id);
  } else {
    console.log('[REPAIR] WARN: no SEDE branch found');
  }

  const branches = await db.query('SELECT name, code, is_main FROM branches ORDER BY name');
  console.log('[REPAIR] branches:');
  for (const b of branches.rows) {
    console.log('  -', b.name, '|', b.code, '| is_main=', b.is_main);
  }

  const coa = await db.query(`
    SELECT coa.id, coa.code, coa.name, coa.current_balance, coa.branch_id, b.name AS branch_name
    FROM chart_of_accounts coa
    LEFT JOIN branches b ON b.id::text = coa.branch_id::text
    WHERE coa.is_active = true
      AND coa.is_header = false
      AND coa.code LIKE '45%'
      AND coa.code NOT IN ('45','451')
      AND coa.branch_id IS NOT NULL
      AND LENGTH(TRIM(coa.code)) >= 3
  `);
  console.log('[REPAIR] COA 45x leaves with branch:', coa.rows.length);

  let created = 0;
  const now = new Date().toISOString();
  for (const row of coa.rows) {
    const branchId = String(row.branch_id || '').trim();
    if (!branchId || branchId === '22222222-2222-2222-2222-222222222222') continue;
    const branchName = String(row.branch_name || '').trim() || branchId;
    const name = String(row.name || '').trim() || `Caixa ${row.code}`;
    const balance = Number(row.current_balance) || 0;
    // caixas.id is UUID in Postgres — reuse the COA account id (1:1).
    const id = String(row.id);

    const exists = await db.query(
      `SELECT id FROM caixas
       WHERE id::text = $1
          OR (branch_id::text = $2 AND LOWER(TRIM(name)) = LOWER(TRIM($3)))
       LIMIT 1`,
      [id, branchId, name],
    );
    if (exists.rows[0]) {
      await db.query(
        `UPDATE caixas
         SET branch_name = $2,
             name = $3,
             current_balance = $4,
             updated_at = $5
         WHERE id = $1`,
        [exists.rows[0].id, branchName, name, balance, now],
      );
      continue;
    }

    await db.query(
      `INSERT INTO caixas (
        id, branch_id, branch_name, name, opening_balance, current_balance,
        status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$5,'closed',$6,$6)`,
      [id, branchId, branchName, name, balance, now],
    );
    created += 1;
  }
  console.log('[REPAIR] caixas created/updated from COA:', created);

  const orphan = await db.query(`
    DELETE FROM caixas
    WHERE branch_id::text = '22222222-2222-2222-2222-222222222222'
      AND NOT EXISTS (
        SELECT 1 FROM branches b WHERE b.id::text = '22222222-2222-2222-2222-222222222222'
      )
    RETURNING id
  `);
  if (orphan.rows.length) console.log('[REPAIR] removed orphan seed caixas:', orphan.rows.length);

  await db.query(`
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

  const c = await db.query('SELECT COUNT(*)::int AS n FROM caixas');
  const b = await db.query('SELECT COUNT(*)::int AS n FROM bank_accounts');
  const banks = await db.query(
    'SELECT bank_name, name, account_number, branch_name, balance FROM bank_accounts ORDER BY branch_name, bank_name LIMIT 20',
  );
  const caixas = await db.query(
    'SELECT name, branch_name, current_balance FROM caixas ORDER BY branch_name, name LIMIT 40',
  );

  console.log('[REPAIR] TOTAL caixas=', c.rows[0].n, 'bank_accounts=', b.rows[0].n);
  console.log('[REPAIR] sample caixas:');
  for (const row of caixas.rows) {
    console.log('  -', row.branch_name, '|', row.name, '|', row.current_balance);
  }
  console.log('[REPAIR] sample banks:');
  if (!banks.rows.length) {
    console.log('  (none) -> create them in NEXOR: Contas Bancarias');
  } else {
    for (const row of banks.rows) {
      console.log('  -', row.branch_name, '|', row.bank_name, row.account_number, '|', row.balance);
    }
  }

  await new Promise((resolve) => {
    http.get('http://127.0.0.1:3000/api/health?lite=1', (res) => {
      let raw = '';
      res.on('data', (d) => { raw += d; });
      res.on('end', () => {
        try {
          const h = JSON.parse(raw);
          console.log('[REPAIR] health appVersion=', h.appVersion, 'schema=', h.schemaVersion, 'ok=', h.ok);
        } catch {
          console.log('[REPAIR] health raw=', raw.slice(0, 200));
        }
        resolve();
      });
    }).on('error', (e) => {
      console.log('[REPAIR] health failed:', e.message);
      resolve();
    });
  });

  console.log('[REPAIR] DONE. F5 in NEXOR, open New expense.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[REPAIR] FAILED:', e.message || e);
  process.exit(1);
});
