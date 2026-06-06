/**
 * Open items for daily checklist — same scope as Pagamentos → Itens em aberto
 * (all non-cleared supplier/customer lines with balance), not only debit invoices.
 */
const db = require('../db');

async function listOpenItemsForChecklist(entityType) {
  const type = String(entityType || '').trim();
  if (type !== 'customer' && type !== 'supplier') {
    return [];
  }

  const nameCol = type === 'customer' ? 'client_name' : 'supplier_name';
  const joinTable = type === 'customer' ? 'clients' : 'suppliers';
  const joinAlias = type === 'customer' ? 'c' : 's';
  const fallbackLabel = type === 'customer' ? 'Cliente' : 'Fornecedor';

  const result = await db.query(
    `SELECT oi.id, oi.entity_id, oi.document_id, oi.document_number, oi.document_date, oi.due_date,
            oi.remaining_amount, oi.original_amount, oi.document_type, oi.is_debit,
            COALESCE(NULLIF(TRIM(${joinAlias}.name), ''), '${fallbackLabel}') AS ${nameCol},
            ${type === 'supplier' ? `COALESCE(${joinAlias}.payment_terms, '30_days')` : 'NULL'} AS payment_terms
     FROM open_items oi
     LEFT JOIN ${joinTable} ${joinAlias} ON ${joinAlias}.id = oi.entity_id
     WHERE oi.entity_type = $1
       AND oi.status != 'cleared'
       AND ABS(COALESCE(oi.remaining_amount, 0)) > 0.01
     ORDER BY oi.due_date ASC NULLS LAST, ${nameCol}, oi.document_date ASC
     LIMIT 500`,
    [type],
  );

  return result.rows || [];
}

async function listChecklistDues() {
  const [receivables, payables] = await Promise.all([
    listOpenItemsForChecklist('customer'),
    listOpenItemsForChecklist('supplier'),
  ]);
  return { receivables, payables };
}

module.exports = {
  listOpenItemsForChecklist,
  listChecklistDues,
};
