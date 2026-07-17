# Repair expense treasury ON DOCKER POSTGRES (no local erp.db import).
# Your live data is already in Docker - this script only fixes caixas/banks/HQ flags there.
#
# Usage (SERVER PC):
#   cd C:\Users\user\Documents\GitHub\angola-invoice-finder
#   git pull origin main
#   .\scripts\repair-docker-treasury.ps1

$ErrorActionPreference = 'Continue'

$running = docker ps --filter 'name=nexor-backend' --format '{{.Names}}' 2>$null
if ($running -notmatch 'nexor-backend') {
  Write-Host '[ERROR] nexor-backend not running. Start: docker compose up -d backend' -ForegroundColor Red
  exit 1
}

$js = @'
const db = require('./src/db');

async function main() {
  console.log('[REPAIR] engine=', db.engine);

  // 1) Promote SEDE as head office
  const sede = await db.query(`
    SELECT id, name, code, is_main FROM branches
    WHERE name ILIKE '%sede%' OR code ILIKE 'SEDE%' OR UPPER(code) = 'MAIN'
    ORDER BY CASE WHEN name ILIKE '%sede%' THEN 0 ELSE 1 END
    LIMIT 1
  `);
  if (sede.rows[0]) {
    await db.query('UPDATE branches SET is_main = FALSE WHERE id::text IS DISTINCT FROM $1', [String(sede.rows[0].id)]);
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

  // 2) Sync operational caixas from COA 45x leaves (what you see in Chart of Accounts)
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
    const name = String(row.name || '').trim() || ('Caixa ' + row.code);
    const balance = Number(row.current_balance) || 0;
    const id = 'caixa_coa_' + String(row.id);

    const exists = await db.query(
      `SELECT id FROM caixas
       WHERE branch_id::text = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2))
       LIMIT 1`,
      [branchId, name],
    );
    if (exists.rows[0]) continue;

    await db.query(
      `INSERT INTO caixas (
        id, branch_id, branch_name, name, opening_balance, current_balance,
        status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$5,'closed',$6,$6)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        branch_name = EXCLUDED.branch_name,
        current_balance = EXCLUDED.current_balance,
        updated_at = EXCLUDED.updated_at`,
      [id, branchId, branchName, name, balance, now],
    );
    created += 1;
  }
  console.log('[REPAIR] caixas created/updated from COA:', created);

  // 3) Remove orphan seed caixa
  const orphan = await db.query(`
    DELETE FROM caixas
    WHERE branch_id::text = '22222222-2222-2222-2222-222222222222'
      AND NOT EXISTS (
        SELECT 1 FROM branches b WHERE b.id::text = '22222222-2222-2222-2222-222222222222'
      )
    RETURNING id
  `);
  if (orphan.rows.length) console.log('[REPAIR] removed orphan seed caixas:', orphan.rows.length);

  // 4) Ensure bank_accounts table exists
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
  const banks = await db.query('SELECT bank_name, name, account_number, branch_name, balance FROM bank_accounts ORDER BY branch_name, bank_name LIMIT 20');
  const caixas = await db.query('SELECT name, branch_name, current_balance FROM caixas ORDER BY branch_name, name LIMIT 30');

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

  // 5) Health
  try {
    const http = require('http');
    await new Promise((resolve) => {
      http.get('http://127.0.0.1:3000/api/health?lite=1', (res) => {
        let raw = '';
        res.on('data', (d) => raw += d);
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
  } catch (e) {
    console.log('[REPAIR] health skip:', e.message);
  }

  console.log('[REPAIR] DONE. F5 in NEXOR, open New expense.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[REPAIR] FAILED:', e.message || e);
  process.exit(1);
});
'@

$tmp = Join-Path $env:TEMP ('repair-docker-treasury-' + [guid]::NewGuid().ToString('n') + '.js')
Set-Content -Path $tmp -Value $js -Encoding ASCII

Write-Host 'Copying repair script into nexor-backend...' -ForegroundColor Cyan
docker cp $tmp 'nexor-backend:/tmp/repair-docker-treasury.js'
Remove-Item -Force $tmp -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) {
  Write-Host '[ERROR] docker cp failed' -ForegroundColor Red
  exit 1
}

Write-Host 'Running repair against Docker Postgres...' -ForegroundColor Cyan
docker exec nexor-backend node /tmp/repair-docker-treasury.js
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host '[ERROR] repair failed' -ForegroundColor Red
  exit $code
}

Write-Host ''
Write-Host 'If banks=0: open NEXOR -> Contas Bancarias -> create each bank (saves into Docker).' -ForegroundColor Yellow
Write-Host 'Then F5 and open New expense.' -ForegroundColor Yellow
