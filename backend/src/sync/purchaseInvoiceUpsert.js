/**
 * Shared purchase invoice upsert for API + client ingest.
 */
const { toRow } = require('../purchaseInvoiceMappers');

const UPSERT_SQL = `
  INSERT INTO purchase_invoices (
    id, invoice_number, supplier_account_code, supplier_name, supplier_id,
    supplier_nif, supplier_phone, supplier_balance, ref, supplier_invoice_no,
    contact, department, ref2, date, payment_date, project, currency,
    warehouse_id, warehouse_name, price_type, address,
    purchase_account_code, iva_account_code, transaction_type, currency_rate,
    tax_rate_2, order_no, surcharge_percent, change_price, is_pending, extra_note,
    lines_json, journal_lines_json, subtotal, iva_total, total, status,
    purchase_returns_status, purchase_returns_closed_at,
    branch_id, branch_name, created_by, created_by_name, created_at, updated_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
    $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
    $40,$41,$42,$43,$44,$45
  )
  ON CONFLICT(id) DO UPDATE SET
    invoice_number = excluded.invoice_number,
    supplier_account_code = excluded.supplier_account_code,
    supplier_name = excluded.supplier_name,
    supplier_id = excluded.supplier_id,
    supplier_nif = excluded.supplier_nif,
    supplier_phone = excluded.supplier_phone,
    supplier_balance = excluded.supplier_balance,
    ref = excluded.ref,
    supplier_invoice_no = excluded.supplier_invoice_no,
    contact = excluded.contact,
    department = excluded.department,
    ref2 = excluded.ref2,
    date = excluded.date,
    payment_date = excluded.payment_date,
    project = excluded.project,
    currency = excluded.currency,
    warehouse_id = excluded.warehouse_id,
    warehouse_name = excluded.warehouse_name,
    price_type = excluded.price_type,
    address = excluded.address,
    purchase_account_code = excluded.purchase_account_code,
    iva_account_code = excluded.iva_account_code,
    transaction_type = excluded.transaction_type,
    currency_rate = excluded.currency_rate,
    tax_rate_2 = excluded.tax_rate_2,
    order_no = excluded.order_no,
    surcharge_percent = excluded.surcharge_percent,
    change_price = excluded.change_price,
    is_pending = excluded.is_pending,
    extra_note = excluded.extra_note,
    lines_json = excluded.lines_json,
    journal_lines_json = excluded.journal_lines_json,
    subtotal = excluded.subtotal,
    iva_total = excluded.iva_total,
    total = excluded.total,
    status = excluded.status,
    purchase_returns_status = excluded.purchase_returns_status,
    purchase_returns_closed_at = excluded.purchase_returns_closed_at,
    branch_id = excluded.branch_id,
    branch_name = excluded.branch_name,
    created_by = excluded.created_by,
    created_by_name = excluded.created_by_name,
    updated_at = excluded.updated_at
`;

function rowParams(r) {
  return [
    r.id, r.invoice_number, r.supplier_account_code, r.supplier_name, r.supplier_id,
    r.supplier_nif, r.supplier_phone, r.supplier_balance, r.ref, r.supplier_invoice_no,
    r.contact, r.department, r.ref2, r.date, r.payment_date, r.project, r.currency,
    r.warehouse_id, r.warehouse_name, r.price_type, r.address,
    r.purchase_account_code, r.iva_account_code, r.transaction_type, r.currency_rate,
    r.tax_rate_2, r.order_no, r.surcharge_percent, r.change_price, r.is_pending, r.extra_note,
    r.lines_json, r.journal_lines_json, r.subtotal, r.iva_total, r.total, r.status,
    r.purchase_returns_status, r.purchase_returns_closed_at,
    r.branch_id, r.branch_name, r.created_by, r.created_by_name, r.created_at, r.updated_at,
  ];
}

async function upsertPurchaseInvoice(client, invoiceData) {
  const q = client?.query ? client.query.bind(client) : client;
  const row = toRow(invoiceData);
  if (!row.id) throw new Error('invoice.id obrigatório');
  await q(UPSERT_SQL, rowParams(row));
  return row.id;
}

module.exports = { upsertPurchaseInvoice, UPSERT_SQL, rowParams };
