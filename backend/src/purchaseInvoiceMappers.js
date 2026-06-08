/** Map purchase invoice records between API JSON and SQLite rows. */

/** SQLite stores JSON in TEXT; PostgreSQL JSONB columns arrive already parsed. */
function parseJsonColumn(val, fallback = []) {
  if (val == null || val === '') return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return val;
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number || '',
    supplierAccountCode: row.supplier_account_code || '',
    supplierName: row.supplier_name || '',
    supplierId: row.supplier_id || '',
    supplierNif: row.supplier_nif || '',
    supplierPhone: row.supplier_phone || '',
    supplierBalance: Number(row.supplier_balance || 0),
    ref: row.ref || '',
    supplierInvoiceNo: row.supplier_invoice_no || '',
    contact: row.contact || '',
    department: row.department || '',
    ref2: row.ref2 || '',
    date: row.date || '',
    paymentDate: row.payment_date || '',
    project: row.project || '',
    currency: row.currency || 'KZ',
    warehouseId: row.warehouse_id || row.branch_id || '',
    warehouseName: row.warehouse_name || row.branch_name || '',
    priceType: row.price_type || 'last_price',
    address: row.address || '',
    purchaseAccountCode: row.purchase_account_code || '2.1.1',
    ivaAccountCode: row.iva_account_code || '3.3.1',
    transactionType: row.transaction_type || 'ALL',
    currencyRate: Number(row.currency_rate || 1),
    taxRate2: Number(row.tax_rate_2 || 0),
    orderNo: row.order_no || '',
    surchargePercent: Number(row.surcharge_percent || 0),
    changePrice: !!row.change_price,
    isPending: !!row.is_pending,
    extraNote: row.extra_note || '',
    lines: parseJsonColumn(row.lines_json, []),
    journalLines: parseJsonColumn(row.journal_lines_json, []),
    subtotal: Number(row.subtotal || 0),
    ivaTotal: Number(row.iva_total || 0),
    total: Number(row.total || 0),
    status: row.status || 'draft',
    purchaseReturnsStatus: row.purchase_returns_status || 'none',
    purchaseReturnsClosedAt: row.purchase_returns_closed_at || undefined,
    branchId: row.branch_id || '',
    branchName: row.branch_name || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function toRow(invoice) {
  const inv = invoice || {};
  const now = new Date().toISOString();
  return {
    id: inv.id,
    invoice_number: inv.invoiceNumber || inv.invoice_number || '',
    supplier_account_code: inv.supplierAccountCode || inv.supplier_account_code || '',
    supplier_name: inv.supplierName || inv.supplier_name || '',
    supplier_id: inv.supplierId || inv.supplier_id || '',
    supplier_nif: inv.supplierNif || inv.supplier_nif || '',
    supplier_phone: inv.supplierPhone || inv.supplier_phone || '',
    supplier_balance: Number(inv.supplierBalance ?? inv.supplier_balance ?? 0),
    ref: inv.ref || '',
    supplier_invoice_no: inv.supplierInvoiceNo || inv.supplier_invoice_no || '',
    contact: inv.contact || '',
    department: inv.department || '',
    ref2: inv.ref2 || '',
    date: inv.date || now,
    payment_date: inv.paymentDate || inv.payment_date || inv.date || now,
    project: inv.project || '',
    currency: inv.currency || 'KZ',
    warehouse_id: inv.warehouseId || inv.warehouse_id || inv.branchId || inv.branch_id || '',
    warehouse_name: inv.warehouseName || inv.warehouse_name || inv.branchName || inv.branch_name || '',
    price_type: inv.priceType || inv.price_type || 'last_price',
    address: inv.address || '',
    purchase_account_code: inv.purchaseAccountCode || inv.purchase_account_code || '2.1.1',
    iva_account_code: inv.ivaAccountCode || inv.iva_account_code || '3.3.1',
    transaction_type: inv.transactionType || inv.transaction_type || 'ALL',
    currency_rate: Number(inv.currencyRate ?? inv.currency_rate ?? 1),
    tax_rate_2: Number(inv.taxRate2 ?? inv.tax_rate_2 ?? 0),
    order_no: inv.orderNo || inv.order_no || '',
    surcharge_percent: Number(inv.surchargePercent ?? inv.surcharge_percent ?? 0),
    change_price: inv.changePrice || inv.change_price ? 1 : 0,
    is_pending: inv.isPending || inv.is_pending ? 1 : 0,
    extra_note: inv.extraNote || inv.extra_note || '',
    lines_json: JSON.stringify(inv.lines || []),
    journal_lines_json: JSON.stringify(inv.journalLines || inv.journal_lines || []),
    subtotal: Number(inv.subtotal || 0),
    iva_total: Number(inv.ivaTotal ?? inv.iva_total ?? 0),
    total: Number(inv.total || 0),
    status: inv.status || 'confirmed',
    purchase_returns_status: inv.purchaseReturnsStatus || inv.purchase_returns_status || 'none',
    purchase_returns_closed_at: inv.purchaseReturnsClosedAt || inv.purchase_returns_closed_at || null,
    branch_id: inv.branchId || inv.branch_id || inv.warehouseId || inv.warehouse_id || '',
    branch_name: inv.branchName || inv.branch_name || inv.warehouseName || inv.warehouse_name || '',
    created_by: inv.createdBy || inv.created_by || '',
    created_by_name: inv.createdByName || inv.created_by_name || '',
    created_at: inv.createdAt || inv.created_at || now,
    updated_at: inv.updatedAt || inv.updated_at || now,
  };
}

module.exports = { fromRow, toRow };
