#!/usr/bin/env node
/**
 * Diagnose + repair purchase invoices that saved but never showed anywhere
 * (wrong/legacy branch ids, missing stock movements, missing supplier payables).
 *
 * Run ON THE SERVER PC (the one with database.env / PostgreSQL):
 *   node scripts/diagnose-repair-purchases.js            → diagnose only
 *   node scripts/diagnose-repair-purchases.js --repair   → diagnose + fix
 *   node scripts/diagnose-repair-purchases.js --repair FC-SOYO05-2026-00003   → fix one invoice
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: 'C:\\NEXOR ERP\\database.env' });

// Assigned by loadModules() after the database location is decided —
// requiring db.js earlier would lock in the wrong engine.
let db;
let resolveBranchRow;
let normalizeBranchIdKey;
let postPurchaseInvoiceAccountingPhased;
let queryPostingStatus;
let fromRow;

/** `--db postgres://...` CLI override. */
function cliDatabaseUrl() {
  const i = process.argv.indexOf('--db');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
}

async function tryPostgresUrl(url, label) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const r = await client.query('SELECT COUNT(*) AS n FROM products');
    console.log(`[diagnose] PostgreSQL encontrado (${label}) — produtos=${r.rows[0].n}`);
    return true;
  } catch (e) {
    console.log(`[diagnose] PostgreSQL ${label}: ${e.message}`);
    return false;
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

/**
 * Decide where the live database is, in this order:
 *  1. DATABASE_URL (database.env / environment / --db)
 *  2. Docker PostgreSQL on this PC (default port + password from docker-compose)
 *  3. Biggest local SQLite file (IP file path, install dir, AppData)
 */
async function detectDatabase() {
  const cliUrl = cliDatabaseUrl();
  if (cliUrl) {
    process.env.DATABASE_URL = cliUrl;
    process.env.DB_ENGINE = 'postgres';
  }
  if (process.env.DATABASE_URL || (process.env.DB_ENGINE || '').toLowerCase() === 'postgres') {
    return;
  }

  // Docker PostgreSQL publishes 5432 on the host (docker-compose.yml defaults).
  const dockerDefaults = [
    `postgres://postgres:${process.env.POSTGRES_PASSWORD || 'yel3an7azi'}@127.0.0.1:5432/kwanza_erp`,
  ];
  for (const url of dockerDefaults) {
    if (await tryPostgresUrl(url, 'Docker local 127.0.0.1:5432')) {
      process.env.DATABASE_URL = url;
      process.env.DB_ENGINE = 'postgres';
      return;
    }
  }

  const installDir = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
  let ipDbPath = null;
  try {
    const ip = fs.readFileSync(path.join(installDir, 'IP'), 'utf8').trim().replace(/^\uFEFF/, '');
    if (/^[A-Za-z]:\\.+\.db$/i.test(ip)) ipDbPath = ip;
  } catch { /* no IP file */ }

  const candidates = [
    process.env.SQLITE_PATH,
    ipDbPath,
    path.join(installDir, 'data', 'erp.db'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'NEXOR ERP', 'erp.db') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'NEXOR ERP', 'erp.db') : null,
    'C:\\nexor\\erp.db',
  ].filter(Boolean);

  let best = null;
  for (const p of candidates) {
    try {
      const st = fs.statSync(p);
      if (st.isFile() && (!best || st.size > best.size)) best = { path: p, size: st.size };
    } catch { /* candidate missing */ }
  }
  if (best) {
    process.env.SQLITE_PATH = best.path;
    process.env.DB_ENGINE = 'sqlite';
    console.log(`[diagnose] Sem PostgreSQL — a usar SQLite: ${best.path} (${Math.round(best.size / 1024 / 1024 * 10) / 10} MB)`);
  } else {
    console.error('[diagnose] Nem PostgreSQL (database.env / Docker) nem ficheiro SQLite encontrado neste PC.');
    console.error('[diagnose] Este PC parece não ser o servidor da base de dados.');
    process.exit(1);
  }
}

function loadModules() {
  try {
    db = require('../src/db');
  } catch (e) {
    if (/NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|better_sqlite3/i.test(String(e.message || e))) {
      console.error('');
      console.error('[ERRO] A base de dados é SQLite e o Node instalado não consegue abri-la.');
      console.error('Use o fix-purchases.cmd (usa o executável do NEXOR automaticamente), ou corra:');
      console.error('  set ELECTRON_RUN_AS_NODE=1');
      console.error('  "C:\\Users\\<user>\\AppData\\Local\\Programs\\NEXOR ERP\\NEXOR ERP.exe" scripts\\diagnose-repair-purchases.js');
      process.exit(1);
    }
    throw e;
  }
  ({ resolveBranchRow, normalizeBranchIdKey } = require('../src/lib/branchIdMatch'));
  ({
    postPurchaseInvoiceAccountingPhased,
    queryPostingStatus,
  } = require('../src/lib/purchaseInvoicePosting'));
  ({ fromRow } = require('../src/purchaseInvoiceMappers'));
  ({ normalizeSqlDate } = require('../src/lib/dateSql'));
}

const REPAIR = process.argv.includes('--repair');
const ONLY_INVOICE = process.argv.find((a) => /^FC-/i.test(a)) || null;

function parseJson(val, fallback = []) {
  if (val == null || val === '') return fallback;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val;
}

async function readMeta(key) {
  try {
    const r = await db.query('SELECT value, updated_at FROM app_meta WHERE key = $1 LIMIT 1', [key]);
    return r.rows[0] || null;
  } catch {
    return null;
  }
}

async function loadBranches() {
  const idCol = db.engine === 'postgres' ? 'id::text AS id' : 'CAST(id AS TEXT) AS id';
  try {
    const r = await db.query(`SELECT ${idCol}, code, name, is_main, is_active FROM branches ORDER BY name`);
    return r.rows || [];
  } catch {
    const r = await db.query(`SELECT ${idCol}, code, name, is_main FROM branches ORDER BY name`);
    return r.rows || [];
  }
}

/** '1.1.9' < '1.1.10' must compare numerically, not as strings. */
function versionBefore(version, target) {
  const parse = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(version);
  const b = parse(target);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

function branchMatches(branches, rawId) {
  const key = normalizeBranchIdKey(rawId);
  if (!key) return null;
  return branches.find((b) => normalizeBranchIdKey(b.id) === key) || null;
}

/** Try every identifier on the invoice until one resolves to a real branch row. */
async function resolveInvoiceBranch(inv, branches) {
  const candidates = [
    inv.branch_id,
    inv.warehouse_id,
    inv.branch_name,
    inv.warehouse_name,
  ].map((s) => String(s || '').trim()).filter(Boolean);
  for (const cand of candidates) {
    const row = await resolveBranchRow(db, cand);
    if (row?.id) return row;
  }
  // Legacy SQLite ids ("branch-main", "main") → the main branch row on PostgreSQL.
  const legacyMainKeys = new Set(['branchmain', 'main', 'mainbranch', 'sede', 'principal']);
  const hasLegacyMain = candidates.some((c) => legacyMainKeys.has(normalizeBranchIdKey(c)));
  if (hasLegacyMain) {
    const main = (branches || []).find((b) => b.is_main === true || b.is_main === 1 || b.is_main === '1');
    if (main) return main;
  }
  return null;
}

async function main() {
  await detectDatabase();
  loadModules();
  await db.query('SELECT 1');

  console.log('==================================================================');
  console.log('NEXOR — Diagnóstico de Faturas de Compra (Soyo 05 / todas as filiais)');
  console.log('==================================================================');
  console.log('DB engine        :', db.engine);
  if (db.engine === 'sqlite') {
    console.log('Ficheiro         :', db.dbPath);
    if (fs.existsSync('C:\\NEXOR ERP\\database.env')) {
      console.log('!! AVISO: existe database.env (PostgreSQL) mas este diagnóstico está em SQLite.');
      console.log('!! Pode haver DUAS bases de dados neste PC — confirme qual é a que a app usa.');
    }
  }

  // Row counts identify whether this is the live database with real data.
  const counts = {};
  for (const table of ['products', 'sales', 'suppliers', 'purchase_invoices']) {
    try {
      const r = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
      counts[table] = Number(r.rows[0]?.n || 0);
    } catch {
      counts[table] = null;
    }
  }
  console.log(`Dados            : produtos=${counts.products} vendas=${counts.sales} fornecedores=${counts.suppliers} faturas de compra=${counts.purchase_invoices}`);
  if ((counts.products || 0) === 0 && (counts.sales || 0) === 0) {
    console.log('!! Esta base de dados está VAZIA — provavelmente não é a base de dados real.');
  }

  const appVer = await readMeta('app_version');
  const lastStart = await readMeta('last_started_at');
  const schemaVer = await readMeta('schema_version');
  console.log('Backend em uso   :', appVer ? `v${appVer.value}` : '(desconhecida — app_meta vazio)');
  console.log('Último arranque  :', lastStart?.value || '(desconhecido)');
  console.log('Schema           :', schemaVer?.value || '(desconhecido)');
  if (appVer && versionBefore(appVer.value, '1.1.10')) {
    console.log('');
    console.log('!! O SERVIDOR AINDA CORRE UMA VERSÃO ANTIGA (< 1.1.10).');
    console.log('!! As correções das compras Soyo 05 NÃO estão ativas.');
    console.log('!! Atualize o NEXOR no PC servidor e reinicie a aplicação.');
  }

  const branches = await loadBranches();
  console.log('');
  console.log('Filiais registadas:');
  for (const b of branches) {
    console.log(`  ${b.name}  id=${b.id}  code=${b.code || '-'}  main=${b.is_main ? 'sim' : 'não'}  ativa=${b.is_active === false || b.is_active === 0 ? 'NÃO' : 'sim'}`);
  }

  let sql = 'SELECT * FROM purchase_invoices';
  const params = [];
  if (ONLY_INVOICE) {
    sql += ' WHERE invoice_number = $1';
    params.push(ONLY_INVOICE);
  }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const invoices = (await db.query(sql, params)).rows || [];

  console.log('');
  console.log(`Últimas ${invoices.length} faturas de compra:`);
  console.log('------------------------------------------------------------------');

  const badBranch = [];
  const missingPosting = [];

  const client = await db.pool.connect();
  try {
    for (const row of invoices) {
      const branch = branchMatches(branches, row.branch_id) || branchMatches(branches, row.warehouse_id);
      const posting = await queryPostingStatus(client, row.id);
      const status = String(row.status || 'confirmed').toLowerCase();
      const active = !['cancelled', 'voided', 'draft'].includes(status);

      const stockOk = posting.stockMovementIds.length > 0;
      const payableOk = !!posting.openItemId;
      const journalOk = !!posting.journalEntryId;
      const supplierLinked = String(row.supplier_id || '').trim() !== '';
      const problems = [];
      if (!branch) problems.push('FILIAL INVÁLIDA');
      if (active && !stockOk) problems.push('SEM STOCK');
      if (active && !payableOk) problems.push('SEM CONTA A PAGAR');
      if (active && !journalOk && Number(row.total || 0) > 0) problems.push('SEM DIÁRIO');
      if (active && !supplierLinked) problems.push('SEM FORNECEDOR LIGADO');

      console.log(
        `  ${row.invoice_number}  ${String(row.created_at).slice(0, 16)}  filial=${branch ? branch.name : `?? (${row.branch_id || row.warehouse_id || 'vazio'})`}  estado=${status}` +
        `  stock=${stockOk ? 'ok' : 'FALTA'}  pagar=${payableOk ? 'ok' : 'FALTA'}  diário=${journalOk ? 'ok' : 'FALTA'}` +
        (problems.length ? `   <<< ${problems.join(' + ')}` : ''),
      );

      if (!branch && active) badBranch.push(row);
      if (active && (!stockOk || !payableOk || (!journalOk && Number(row.total || 0) > 0))) missingPosting.push(row);
    }
  } finally {
    client.release();
  }

  console.log('------------------------------------------------------------------');
  console.log(`Faturas com filial inválida : ${badBranch.length}`);
  console.log(`Faturas sem stock/pagar     : ${missingPosting.length}`);

  if (!REPAIR) {
    if (badBranch.length || missingPosting.length) {
      console.log('');
      console.log('Para reparar, corra: node scripts/diagnose-repair-purchases.js --repair');
    } else {
      console.log('');
      console.log('Nenhum problema encontrado nas faturas listadas.');
      console.log('Se as compras da Soyo 05 continuam a não aparecer, o problema está');
      console.log('no PC cliente (a gravar noutra base de dados) ou na versão do servidor acima.');
    }
    process.exit(0);
  }

  // ---------------- REPAIR ----------------
  console.log('');
  console.log('=============================== REPARAÇÃO ===============================');

  let branchFixed = 0;
  for (const row of badBranch) {
    const resolved = await resolveInvoiceBranch(row, branches);
    if (!resolved) {
      console.log(`  ${row.invoice_number}: não foi possível identificar a filial (branch_id=${row.branch_id}, nome=${row.branch_name || row.warehouse_name || '-'}) — corrija manualmente.`);
      continue;
    }
    const lines = parseJson(row.lines_json, []).map((l) => ({
      ...l,
      warehouseId: String(resolved.id),
      warehouse_id: String(resolved.id),
      warehouseName: l.warehouseName || l.warehouse_name || resolved.name || '',
      warehouse_name: l.warehouseName || l.warehouse_name || resolved.name || '',
    }));
    await db.query(
      `UPDATE purchase_invoices
       SET branch_id = $1, warehouse_id = $1,
           branch_name = CASE WHEN COALESCE(branch_name, '') = '' THEN $2 ELSE branch_name END,
           warehouse_name = CASE WHEN COALESCE(warehouse_name, '') = '' THEN $2 ELSE warehouse_name END,
           lines_json = $3
       WHERE id = $4`,
      [String(resolved.id), resolved.name || '', JSON.stringify(lines), row.id],
    );
    console.log(`  ${row.invoice_number}: filial corrigida → ${resolved.name} (${resolved.id})`);
    branchFixed += 1;
  }

  // Re-read every invoice that needs posting (branch fixes above may have unblocked them)
  const toPost = new Map();
  for (const row of [...missingPosting, ...badBranch]) toPost.set(row.id, row);

  // Pre-posting normalization: link supplier + rebuild journal lines when missing.
  for (const row of toPost.values()) {
    const docDate = normalizeSqlDate(row.date, { allowNull: false });
    const payDate = normalizeSqlDate(row.payment_date);
    await db.query(
      'UPDATE purchase_invoices SET date = $1, payment_date = $2 WHERE id = $3',
      [docDate, payDate, row.id],
    );

    const supplierId = String(row.supplier_id || '').trim();
    if (!supplierId) {
      const name = String(row.supplier_name || '').trim();
      const nif = String(row.supplier_nif || '').trim();
      const idSel = db.engine === 'postgres' ? 'id::text AS id' : 'CAST(id AS TEXT) AS id';
      const bySupplier = await db.query(
        `SELECT ${idSel}, name FROM suppliers
         WHERE ($1 <> '' AND lower(trim(name)) = lower($2))
            OR ($3 <> '' AND lower(trim(coalesce(nif, ''))) = lower($4))
         LIMIT 1`,
        [name, name, nif, nif],
      );
      if (bySupplier.rows[0]?.id) {
        await db.query('UPDATE purchase_invoices SET supplier_id = $1 WHERE id = $2', [bySupplier.rows[0].id, row.id]);
        console.log(`  ${row.invoice_number}: fornecedor ligado → ${bySupplier.rows[0].name} (${bySupplier.rows[0].id})`);
      } else {
        console.log(`  ${row.invoice_number}: SEM FORNECEDOR — "${name}" não existe na tabela de fornecedores; conta a pagar não pode ser criada.`);
      }
    }

    const journalLines = parseJson(row.journal_lines_json, []);
    const subtotal = Number(row.subtotal || 0);
    const ivaTotal = Number(row.iva_total || 0);
    if ((!Array.isArray(journalLines) || journalLines.length === 0) && subtotal > 0) {
      const supplierAccount = String(row.supplier_account_code || '').trim() || '321';
      const rebuilt = [];
      rebuilt.push({
        accountCode: String(row.purchase_account_code || '212').trim() || '212',
        accountName: 'Compra de Mercadorias',
        note: `FC ${row.invoice_number} - ${row.supplier_name || ''}`.trim(),
        debit: subtotal,
        credit: 0,
      });
      if (ivaTotal > 0) {
        rebuilt.push({
          accountCode: String(row.iva_account_code || '3451').trim() || '3451',
          accountName: 'IVA Dedutível',
          note: `IVA - FC ${row.invoice_number}`,
          debit: ivaTotal,
          credit: 0,
        });
      }
      rebuilt.push({
        accountCode: supplierAccount,
        accountName: row.supplier_name || 'Fornecedor',
        note: `FC ${row.invoice_number}`,
        debit: 0,
        credit: subtotal + ivaTotal,
      });
      await db.query('UPDATE purchase_invoices SET journal_lines_json = $1 WHERE id = $2', [JSON.stringify(rebuilt), row.id]);
      console.log(`  ${row.invoice_number}: linhas de diário reconstruídas (${rebuilt.length} linhas)`);
    }
  }

  let posted = 0;
  let failed = 0;
  for (const oldRow of toPost.values()) {
    const fresh = (await db.query('SELECT * FROM purchase_invoices WHERE id = $1', [oldRow.id])).rows[0];
    if (!fresh) continue;
    const inv = fromRow(fresh);
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      const result = await postPurchaseInvoiceAccountingPhased(c, inv);
      await c.query('COMMIT');
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
      console.log(`  ${inv.invoiceNumber}: FALHOU — ${e.message}`);
      failed += 1;
      continue;
    } finally {
      c.release();
    }

    // Fresh connection after COMMIT so we never read a half-aborted session.
    const verified = await queryPostingStatus(db, inv.id);
    const stockOk = verified.stockMovementIds.length > 0;
    const payableOk = !!verified.openItemId;
    const journalOk = !!verified.journalEntryId;
    if (stockOk && payableOk) {
      console.log(
        `  ${inv.invoiceNumber}: REPARADA — stock=${verified.stockMovementIds.length} movimento(s), conta a pagar=ok${journalOk ? ', diário=ok' : ', diário=FALTA'}`,
      );
      posted += 1;
    } else {
      console.log(`  ${inv.invoiceNumber}: PARCIAL — stock=${stockOk ? 'ok' : 'FALTA'}, pagar=${payableOk ? 'ok' : 'FALTA'}, diário=${journalOk ? 'ok' : 'FALTA'}`);
      failed += 1;
    }
  }

  console.log('');
  console.log('========================== RESUMO DA REPARAÇÃO ==========================');
  console.log(`Filiais corrigidas          : ${branchFixed}`);
  console.log(`Faturas reparadas (completo): ${posted}`);
  console.log(`Faturas com falhas          : ${failed}`);
  console.log('');
  console.log('A seguir: reinicie o NEXOR no servidor (ou apenas atualize as páginas).');
  console.log('As compras devem aparecer na lista, no inventário e nas contas a pagar.');
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error('[diagnose-repair-purchases]', e.message || e);
  process.exit(1);
});
