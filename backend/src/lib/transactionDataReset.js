/**
 * Wipe practice transactions so a server can start fresh, keeping master data
 * (products, customers, suppliers, chart, users, branches, banks, tills).
 */
const { createJournalEntry } = require('../accounting');

const CONFIRM_PHRASE = 'APAGAR MOVIMENTOS';

// Children before parents: Postgres and SQLite both enforce these foreign keys.
const TRANSACTION_TABLES = [
  'clearings',
  'exchange_gain_loss',
  'open_items',
  'approval_actions',
  'approval_requests',
  'journal_entry_lines',
  'journal_entries',
  'credit_note_items',
  'debit_note_items',
  'tax_lines',
  'tax_summaries',
  'fiscal_signatures',
  'invoice_signatures',
  'agt_transmissions',
  'transport_documents',
  'document_links',
  'credit_notes',
  'debit_notes',
  'sale_items',
  'payments',
  'sales',
  'proforma_items',
  'proformas',
  'sales_order_items',
  'sales_orders',
  'purchase_order_items',
  'purchase_orders',
  'purchase_invoices',
  'supplier_returns',
  'import_order_items',
  'import_orders',
  'stock_transfer_items',
  'stock_transfers',
  'stock_movements',
  'expenses',
  'caixa_sessions',
  'bank_transactions',
  'bank_reconciliations',
  'daily_reports',
  'client_ingest_log',
  'hq_ingest_log',
];

const TRANSACTION_SYNC_EVENTS = [
  'sale.created',
  'credit_note.created',
  'debit_note.created',
  'payment.created',
  'journal.posted',
  'purchase_invoice.created',
  'stock_movement',
  'caixa.close',
];

const STOCK_ACCOUNT = '261';
const OPENING_EQUITY_ACCOUNT = '811';

async function tableExists(client, engine, table) {
  if (engine === 'postgres') {
    const r = await client.query('SELECT to_regclass($1) AS t', [`public.${table}`]);
    return Boolean(r.rows[0]?.t);
  }
  const r = await client.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = $1",
    [table],
  );
  return r.rows.length > 0;
}

async function tableColumns(client, engine, table) {
  if (engine === 'postgres') {
    const r = await client.query(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    return new Set(r.rows.map((row) => row.name));
  }
  const r = await client.query('SELECT name FROM pragma_table_info($1)', [table]);
  return new Set(r.rows.map((row) => row.name));
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/** Documents really sent to AGT (sandbox or production) must never be deleted. */
async function countRealAgtTransmissions(client, engine) {
  if (!(await tableExists(client, engine, 'agt_transmissions'))) return 0;
  const r = await client.query(
    'SELECT response_payload, agt_code, agt_status FROM agt_transmissions',
  );
  let real = 0;
  for (const row of r.rows) {
    const response = parseJson(row.response_payload);
    if (response?.simulated) continue;
    if (!response && !row.agt_code) continue;
    const status = String(row.agt_status || '').toLowerCase();
    if (!row.agt_code && (status === 'error' || status === 'failed')) continue;
    real += 1;
  }
  return real;
}

async function zeroColumns(client, engine, table, assignments) {
  if (!(await tableExists(client, engine, table))) return 0;
  const cols = await tableColumns(client, engine, table);
  const parts = [];
  for (const [col, sqlValue] of assignments) {
    if (cols.has(col)) parts.push(`${col} = ${sqlValue}`);
  }
  if (!parts.length) return 0;
  if (cols.has('updated_at')) parts.push('updated_at = CURRENT_TIMESTAMP');
  const r = await client.query(`UPDATE ${table} SET ${parts.join(', ')}`);
  return r.rowCount || 0;
}

async function postOpeningStock(client, engine, { createdBy, createdByName }) {
  const cols = await tableColumns(client, engine, 'products');
  if (!cols.has('stock')) return { posted: [], skipped: 'no_stock_column' };

  const costParts = ['avg_cost', 'cost', 'last_cost']
    .filter((c) => cols.has(c))
    .map((c) => `NULLIF(${c}, 0)`);
  if (!costParts.length) return { posted: [], skipped: 'no_cost_column' };
  const unitCost = `COALESCE(${costParts.join(', ')}, 0)`;
  const branchExpr = cols.has('branch_id') ? "COALESCE(branch_id, '')" : "''";

  const r = await client.query(
    `SELECT ${branchExpr} AS branch_id, SUM(stock * ${unitCost}) AS value
     FROM products
     WHERE stock > 0
     GROUP BY ${branchExpr}`,
  );

  const accounts = await client.query(
    'SELECT code FROM chart_of_accounts WHERE code IN ($1, $2) AND is_active = true',
    [STOCK_ACCOUNT, OPENING_EQUITY_ACCOUNT],
  );
  const found = new Set(accounts.rows.map((a) => String(a.code)));
  if (!found.has(STOCK_ACCOUNT) || !found.has(OPENING_EQUITY_ACCOUNT)) {
    return { posted: [], skipped: 'missing_accounts' };
  }

  const posted = [];
  for (const row of r.rows) {
    const value = Math.round(Number(row.value || 0) * 100) / 100;
    if (!(value > 0)) continue;
    const branchId = String(row.branch_id || '').trim() || null;
    await createJournalEntry(client, {
      description: 'Stock inicial (abertura após limpeza de movimentos)',
      referenceType: 'opening_balance',
      referenceId: null,
      branchId,
      createdBy,
      createdByName,
      entryDate: new Date().toISOString().slice(0, 10),
      lines: [
        { accountCode: STOCK_ACCOUNT, description: 'Stock inicial', debit: value, credit: 0 },
        { accountCode: OPENING_EQUITY_ACCOUNT, description: 'Stock inicial', debit: 0, credit: value },
      ],
    });
    posted.push({ branchId, value });
  }
  return { posted, skipped: null };
}

async function deleteTables(client, tables) {
  const deleted = {};
  for (const table of tables) {
    const r = await client.query(`DELETE FROM ${table}`);
    deleted[table] = r.rowCount || 0;
  }
  return deleted;
}

// Row-by-row DELETE re-checks every foreign key per row and blows the pool's
// 30s statement_timeout on real data; TRUNCATE empties the set in one step.
async function clearPostgresTables(client, tables) {
  await client.query('SET LOCAL statement_timeout = 0');
  await client.query("SET LOCAL lock_timeout = '20s'");
  if (!tables.length) return {};

  const deleted = {};
  for (const table of tables) {
    const r = await client.query(`SELECT COUNT(*)::bigint AS n FROM ${table}`);
    deleted[table] = Number(r.rows[0]?.n || 0);
  }

  const outside = await client.query(
    `SELECT DISTINCT src.relname::text AS referencing
     FROM pg_constraint c
     JOIN pg_class src ON src.oid = c.conrelid
     JOIN pg_class dst ON dst.oid = c.confrelid
     JOIN pg_namespace n ON n.oid = dst.relnamespace
     WHERE c.contype = 'f'
       AND n.nspname = 'public'
       AND dst.relname::text = ANY($1::text[])
       AND NOT (src.relname::text = ANY($1::text[]))`,
    [tables],
  );
  if (outside.rows.length) {
    console.warn(
      '[RESET] Kept tables reference transactions, using DELETE:',
      outside.rows.map((r) => r.referencing).join(', '),
    );
    return deleteTables(client, tables);
  }

  await client.query('SAVEPOINT reset_truncate');
  try {
    await client.query(`TRUNCATE ${tables.join(', ')}`);
    await client.query('RELEASE SAVEPOINT reset_truncate');
  } catch (error) {
    if (error?.code === '55P03') throw error;
    console.warn('[RESET] TRUNCATE refused, using DELETE:', error.message);
    await client.query('ROLLBACK TO SAVEPOINT reset_truncate');
    return deleteTables(client, tables);
  }
  return deleted;
}

/**
 * @param {object} client  query-capable client inside an open transaction
 * @param {{ engine: 'postgres'|'sqlite', postOpeningStock?: boolean, createdBy?: string, createdByName?: string }} opts
 */
async function resetTransactionData(client, opts = {}) {
  const engine = opts.engine === 'postgres' ? 'postgres' : 'sqlite';

  const realAgt = await countRealAgtTransmissions(client, engine);
  if (realAgt > 0) {
    const err = new Error(
      `Já foram enviados ${realAgt} documento(s) à AGT. Documentos enviados à AGT não podem ser apagados.`,
    );
    err.code = 'AGT_DOCUMENTS_SENT';
    throw err;
  }

  const existing = [];
  for (const table of TRANSACTION_TABLES) {
    if (await tableExists(client, engine, table)) existing.push(table);
  }

  let deleted;
  try {
    deleted = engine === 'postgres'
      ? await clearPostgresTables(client, existing)
      : await deleteTables(client, existing);
  } catch (error) {
    if (error?.code === '55P03' || /lock timeout/i.test(String(error?.message || ''))) {
      const busy = new Error(
        'A base de dados está ocupada por outra caixa ou serviço. Feche o NEXOR nas outras caixas e tente de novo.',
      );
      busy.code = 'TABLES_BUSY';
      throw busy;
    }
    throw error;
  }

  if (await tableExists(client, engine, 'sync_events')) {
    const placeholders = TRANSACTION_SYNC_EVENTS.map((_, i) => `$${i + 1}`).join(', ');
    const r = await client.query(
      `DELETE FROM sync_events WHERE event_type IN (${placeholders})`,
      TRANSACTION_SYNC_EVENTS,
    );
    deleted.sync_events = r.rowCount || 0;
  }

  const zeroed = {
    chart_of_accounts: await zeroColumns(client, engine, 'chart_of_accounts', [
      ['current_balance', '0'],
      ['opening_balance', '0'],
    ]),
    caixas: await zeroColumns(client, engine, 'caixas', [
      ['opening_balance', '0'],
      ['current_balance', '0'],
      ['closing_balance', 'NULL'],
      ['status', "'closed'"],
      ['opened_by', "''"],
      ['closed_by', "''"],
      ['opened_at', 'NULL'],
      ['closed_at', 'NULL'],
    ]),
    bank_accounts: await zeroColumns(client, engine, 'bank_accounts', [['balance', '0']]),
    clients: await zeroColumns(client, engine, 'clients', [['current_balance', '0']]),
    suppliers: await zeroColumns(client, engine, 'suppliers', [['balance', '0']]),
    document_sequences: await zeroColumns(client, engine, 'document_sequences', [['current_number', '0']]),
  };

  let openingStock = { posted: [], skipped: 'not_requested' };
  if (opts.postOpeningStock) {
    openingStock = await postOpeningStock(client, engine, {
      createdBy: opts.createdBy,
      createdByName: opts.createdByName,
    });
  }

  return { deleted, zeroed, openingStock };
}

module.exports = {
  CONFIRM_PHRASE,
  TRANSACTION_TABLES,
  resetTransactionData,
  countRealAgtTransmissions,
};
