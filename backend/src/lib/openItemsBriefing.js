/**
 * Open items for daily checklist — same scope as Pagamentos → Itens em aberto
 * (all non-cleared supplier/customer lines with balance), not only debit invoices.
 */
const db = require('../db');

function idAsText(column) {
  return db.engine === 'postgres' ? `${column}::text` : `CAST(${column} AS TEXT)`;
}

async function listOpenItemsForChecklist(entityType, branchId) {
  const type = String(entityType || '').trim();
  if (type !== 'customer' && type !== 'supplier') {
    return [];
  }

  const branch = String(branchId || '').trim();
  const nameCol = type === 'customer' ? 'client_name' : 'supplier_name';
  const joinTable = type === 'customer' ? 'clients' : 'suppliers';
  const joinAlias = type === 'customer' ? 'c' : 's';
  const fallbackLabel = type === 'customer' ? 'Cliente' : 'Fornecedor';
  const docJoin = type === 'customer'
    ? 'LEFT JOIN sales doc ON doc.id = oi.document_id'
    : 'LEFT JOIN purchase_invoices doc ON doc.id = oi.document_id';

  const params = [type];
  let branchSql = '';
  if (branch) {
    params.push(branch);
    const p = `$${params.length}`;
    const docBranch = type === 'customer'
      ? `${idAsText('doc.branch_id')} = ${p}`
      : `(${idAsText('doc.branch_id')} = ${p} OR ${idAsText('doc.warehouse_id')} = ${p})`;
    branchSql = ` AND (${idAsText('oi.branch_id')} = ${p} OR ${docBranch})`;
  }

  const result = await db.query(
    `SELECT oi.id, oi.entity_id, oi.document_id, oi.document_number, oi.document_date, oi.due_date,
            oi.remaining_amount, oi.original_amount, oi.document_type, oi.is_debit,
            COALESCE(NULLIF(TRIM(${joinAlias}.name), ''), '${fallbackLabel}') AS ${nameCol},
            ${type === 'supplier' ? `COALESCE(${joinAlias}.payment_terms, '30_days')` : 'NULL'} AS payment_terms
     FROM open_items oi
     LEFT JOIN ${joinTable} ${joinAlias} ON ${joinAlias}.id = oi.entity_id
     ${docJoin}
     WHERE oi.entity_type = $1
       AND oi.status != 'cleared'
       AND ABS(COALESCE(oi.remaining_amount, 0)) > 0.01
       ${branchSql}
     ORDER BY oi.due_date ASC NULLS LAST, ${nameCol}, oi.document_date ASC
     LIMIT 500`,
    params,
  );

  return result.rows || [];
}

async function listChecklistDues(options = {}) {
  const branchId = options.branchId ? String(options.branchId).trim() : '';
  const [receivables, payables] = await Promise.all([
    listOpenItemsForChecklist('customer', branchId),
    listOpenItemsForChecklist('supplier', branchId),
  ]);
  return { receivables, payables };
}

module.exports = {
  listOpenItemsForChecklist,
  listChecklistDues,
};
