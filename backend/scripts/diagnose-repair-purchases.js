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
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: 'C:\\NEXOR ERP\\database.env' });

const db = require('../src/db');
const { resolveBranchRow, normalizeBranchIdKey } = require('../src/lib/branchIdMatch');
const {
  postPurchaseInvoiceAccountingPhased,
  queryPostingStatus,
} = require('../src/lib/purchaseInvoicePosting');
const { fromRow } = require('../src/purchaseInvoiceMappers');

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
async function resolveInvoiceBranch(inv) {
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
  return null;
}

async function main() {
  await db.query('SELECT 1');

  console.log('==================================================================');
  console.log('NEXOR — Diagnóstico de Faturas de Compra (Soyo 05 / todas as filiais)');
  console.log('==================================================================');
  console.log('DB engine        :', db.engine);
  if (db.engine === 'sqlite') {
    console.log('!! AVISO: ligado a SQLite local, NÃO ao PostgreSQL do servidor.');
    console.log('!! Corra este script no PC SERVIDOR com C:\\NEXOR ERP\\database.env');
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
      const problems = [];
      if (!branch) problems.push('FILIAL INVÁLIDA');
      if (active && !stockOk) problems.push('SEM STOCK');
      if (active && !payableOk) problems.push('SEM CONTA A PAGAR');

      console.log(
        `  ${row.invoice_number}  ${String(row.created_at).slice(0, 16)}  filial=${branch ? branch.name : `?? (${row.branch_id || row.warehouse_id || 'vazio'})`}  estado=${status}` +
        `  stock=${stockOk ? 'ok' : 'FALTA'}  pagar=${payableOk ? 'ok' : 'FALTA'}  diário=${posting.journalEntryId ? 'ok' : '-'}` +
        (problems.length ? `   <<< ${problems.join(' + ')}` : ''),
      );

      if (!branch && active) badBranch.push(row);
      if (active && (!stockOk || !payableOk)) missingPosting.push(row);
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
    const resolved = await resolveInvoiceBranch(row);
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
      const stockOk = result.stockMovementIds.length > 0;
      const payableOk = !!result.openItemId;
      if (stockOk && payableOk) {
        console.log(`  ${inv.invoiceNumber}: REPARADA — stock=${result.stockMovementIds.length} movimento(s), conta a pagar=ok${result.journalEntryId ? ', diário=ok' : ''}`);
        posted += 1;
      } else {
        console.log(`  ${inv.invoiceNumber}: PARCIAL — stock=${stockOk ? 'ok' : 'FALTA'}, pagar=${payableOk ? 'ok' : 'FALTA'}`);
        for (const err of result.errors || []) console.log(`      erro: ${err}`);
        for (const warn of result.warnings || []) console.log(`      aviso: ${warn}`);
        failed += 1;
      }
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
      console.log(`  ${inv.invoiceNumber}: FALHOU — ${e.message}`);
      failed += 1;
    } finally {
      c.release();
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
