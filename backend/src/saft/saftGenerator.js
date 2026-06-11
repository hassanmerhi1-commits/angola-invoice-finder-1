/**
 * Unified SAF-T AO generator — live DB (sales, NC, ND, payments, GL, stock).
 */
const db = require('../db');
const { resolveCompanyForSaft, companyToSaftHeader } = require('../agt/companySettings');
const { activeFlagWhere } = require('../lib/sqlDialect');

function parsePeriod(params = {}) {
  const fiscalYear = Number(params.year) || new Date().getFullYear();
  const start = params.startDate || `${fiscalYear}-01-01`;
  const end = params.endDate || `${fiscalYear}-12-31`;
  return { fiscalYear, start, end, endTs: `${end}T23:59:59` };
}

function toDateOnly(value) {
  if (!value) return new Date().toISOString().split('T')[0];
  const s = String(value);
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
}

function toPeriod(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 1 : d.getMonth() + 1;
}

function taxCodeFromRate(rate) {
  const r = parseFloat(rate) || 0;
  if (r === 0) return 'ISE';
  if (r <= 5) return 'RED';
  return 'NOR';
}

function dedupeProducts(rows) {
  const bySku = new Map();
  for (const p of rows) {
    const key = p.sku || p.id;
    if (!bySku.has(key)) bySku.set(key, p);
  }
  return Array.from(bySku.values()).sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
}

async function loadMasterFiles() {
  const activeProducts = activeFlagWhere(db, 'is_active');
  const [customers, suppliers, products, accounts] = await Promise.all([
    db.query('SELECT * FROM clients ORDER BY name'),
    db.query('SELECT * FROM suppliers ORDER BY name'),
    db.query(`SELECT * FROM products WHERE ${activeProducts} ORDER BY sku, created_at DESC`),
    db.query(`SELECT * FROM chart_of_accounts WHERE ${activeFlagWhere(db, 'is_active')} ORDER BY code`),
  ]);

  const productRows = dedupeProducts(products.rows);

  return {
    Customer: customers.rows.map((c) => ({
      CustomerID: c.id,
      AccountID: '3.1.1',
      CustomerTaxID: c.nif || '999999990',
      CompanyName: c.name,
      BillingAddress: {
        AddressDetail: c.address || 'N/A',
        City: c.city || 'Luanda',
        Country: 'AO',
      },
      Telephone: c.phone || '',
      Email: c.email || '',
      SelfBillingIndicator: '0',
    })),
    Supplier: suppliers.rows.map((s) => ({
      SupplierID: s.id,
      AccountID: '3.2.1',
      SupplierTaxID: s.nif || '999999990',
      CompanyName: s.name,
      BillingAddress: {
        AddressDetail: s.address || 'N/A',
        City: s.city || 'Luanda',
        Country: 'AO',
      },
      Telephone: s.phone || '',
      Email: s.email || '',
      SelfBillingIndicator: '0',
    })),
    Product: productRows.map((p) => ({
      ProductType: 'P',
      ProductCode: p.sku || p.id,
      ProductGroup: p.category || '',
      ProductDescription: p.name,
      ProductNumberCode: p.barcode || p.sku || p.id,
    })),
    GeneralLedgerAccounts: {
      Account: accounts.rows.map((a) => ({
        AccountID: a.code,
        AccountDescription: a.name,
        OpeningDebitBalance: '0.00',
        OpeningCreditBalance: '0.00',
        ClosingDebitBalance: '0.00',
        ClosingCreditBalance: '0.00',
        GroupingCategory: a.account_type || 'GA',
      })),
    },
    TaxTable: {
      TaxTableEntry: [
        { TaxType: 'IVA', TaxCountryRegion: 'AO', TaxCode: 'NOR', Description: 'IVA Normal', TaxPercentage: '14.00' },
        { TaxType: 'IVA', TaxCountryRegion: 'AO', TaxCode: 'RED', Description: 'IVA Reduzida', TaxPercentage: '5.00' },
        { TaxType: 'IVA', TaxCountryRegion: 'AO', TaxCode: 'ISE', Description: 'Isento', TaxPercentage: '0.00' },
      ],
    },
  };
}

function mapSaleLine(item, sale, idx, amountField = 'CreditAmount') {
  const taxRate = parseFloat(item.tax_rate) || 14;
  const line = {
    LineNumber: idx + 1,
    ProductCode: item.sku || item.product_id,
    ProductDescription: item.product_name,
    Quantity: parseFloat(item.quantity),
    UnitOfMeasure: 'UN',
    UnitPrice: parseFloat(item.unit_price),
    TaxPointDate: toDateOnly(sale.created_at),
    Description: item.product_name,
    Tax: {
      TaxType: 'IVA',
      TaxCountryRegion: 'AO',
      TaxCode: taxCodeFromRate(taxRate),
      TaxPercentage: taxRate,
    },
  };
  line[amountField] = parseFloat(item.subtotal);
  return line;
}

function mapSaleToInvoice(sale, items) {
  const isVoided = sale.status !== 'completed';
  return {
    InvoiceNo: sale.invoice_number,
    ATCUD: sale.atcud || '0',
    DocumentStatus: {
      InvoiceStatus: isVoided ? 'A' : 'N',
      InvoiceStatusDate: sale.created_at,
      SourceID: sale.cashier_name || 'System',
      SourceBilling: 'P',
    },
    Hash: sale.saft_hash || '0',
    HashControl: '1',
    Period: toPeriod(sale.created_at),
    InvoiceDate: toDateOnly(sale.created_at),
    InvoiceType: 'FT',
    SpecialRegimes: { SelfBillingIndicator: '0', CashVATSchemeIndicator: '0', ThirdPartiesBillingIndicator: '0' },
    SourceID: sale.cashier_name || 'System',
    SystemEntryDate: sale.created_at,
    CustomerID: sale.customer_nif || '999999990',
    Line: items.map((item, idx) => mapSaleLine(item, sale, idx, 'CreditAmount')),
    DocumentTotals: {
      TaxPayable: parseFloat(sale.tax_amount),
      NetTotal: parseFloat(sale.subtotal),
      GrossTotal: parseFloat(sale.total),
      Currency: { CurrencyCode: sale.currency || 'AOA', CurrencyAmount: parseFloat(sale.total) },
    },
  };
}

function mapCreditNoteToInvoice(note, items) {
  const docDate = note.issued_at || note.created_at;
  return {
    InvoiceNo: note.document_number,
    ATCUD: '0',
    DocumentStatus: {
      InvoiceStatus: note.status === 'cancelled' ? 'A' : 'N',
      InvoiceStatusDate: docDate,
      SourceID: 'System',
      SourceBilling: 'P',
    },
    Hash: note.saft_hash || '0',
    HashControl: '1',
    Period: toPeriod(docDate),
    InvoiceDate: toDateOnly(docDate),
    InvoiceType: 'NC',
    SpecialRegimes: { SelfBillingIndicator: '0', CashVATSchemeIndicator: '0', ThirdPartiesBillingIndicator: '0' },
    SourceID: 'System',
    SystemEntryDate: docDate,
    CustomerID: note.customer_nif || '999999990',
    Reference: note.original_invoice_number || '',
    Line: items.map((item, idx) => mapSaleLine(item, { created_at: docDate }, idx, 'DebitAmount')),
    DocumentTotals: {
      TaxPayable: parseFloat(note.tax_amount),
      NetTotal: parseFloat(note.subtotal),
      GrossTotal: parseFloat(note.total),
    },
  };
}

function mapDebitNoteToInvoice(note, items) {
  const docDate = note.issued_at || note.created_at;
  return {
    InvoiceNo: note.document_number,
    ATCUD: '0',
    DocumentStatus: {
      InvoiceStatus: note.status === 'cancelled' ? 'A' : 'N',
      InvoiceStatusDate: docDate,
      SourceID: 'System',
      SourceBilling: 'P',
    },
    Hash: note.saft_hash || '0',
    HashControl: '1',
    Period: toPeriod(docDate),
    InvoiceDate: toDateOnly(docDate),
    InvoiceType: 'ND',
    SpecialRegimes: { SelfBillingIndicator: '0', CashVATSchemeIndicator: '0', ThirdPartiesBillingIndicator: '0' },
    SourceID: 'System',
    SystemEntryDate: docDate,
    CustomerID: note.customer_nif || '999999990',
    Reference: note.original_invoice_number || '',
    Line: items.map((item, idx) => ({
      LineNumber: idx + 1,
      ProductCode: item.sku || item.description?.slice(0, 20) || 'ND',
      ProductDescription: item.description,
      Quantity: parseFloat(item.quantity),
      UnitOfMeasure: 'UN',
      UnitPrice: parseFloat(item.unit_price),
      TaxPointDate: toDateOnly(docDate),
      Description: item.description,
      CreditAmount: parseFloat(item.subtotal),
      Tax: {
        TaxType: 'IVA',
        TaxCountryRegion: 'AO',
        TaxCode: taxCodeFromRate(item.tax_rate),
        TaxPercentage: parseFloat(item.tax_rate) || 14,
      },
    })),
    DocumentTotals: {
      TaxPayable: parseFloat(note.tax_amount),
      NetTotal: parseFloat(note.subtotal),
      GrossTotal: parseFloat(note.total),
    },
  };
}

async function loadSalesInvoices(period, branchId, includeVoided) {
  const params = [period.start, period.endTs];
  let query = `
    SELECT s.*, b.name AS branch_name FROM sales s
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE s.created_at >= $1 AND s.created_at <= $2
  `;
  if (branchId) {
    params.push(branchId);
    query += ` AND s.branch_id = $${params.length}`;
  }
  if (!includeVoided) {
    query += " AND s.status = 'completed'";
  }
  query += ' ORDER BY s.created_at';

  const salesResult = await db.query(query, params);
  const invoices = [];
  for (const sale of salesResult.rows) {
    const itemsResult = await db.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id', [sale.id]);
    invoices.push(mapSaleToInvoice(sale, itemsResult.rows));
  }
  return invoices;
}

async function loadCreditNoteInvoices(period, branchId) {
  const params = [period.start, period.endTs];
  let query = `
    SELECT * FROM credit_notes
    WHERE COALESCE(issued_at, created_at) >= $1 AND COALESCE(issued_at, created_at) <= $2
      AND status IN ('issued', 'transmitted')
  `;
  if (branchId) {
    params.push(branchId);
    query += ` AND branch_id = $${params.length}`;
  }
  query += ' ORDER BY COALESCE(issued_at, created_at)';

  const result = await db.query(query, params);
  const invoices = [];
  for (const note of result.rows) {
    const itemsResult = await db.query(
      'SELECT * FROM credit_note_items WHERE credit_note_id = $1 ORDER BY id',
      [note.id],
    );
    invoices.push(mapCreditNoteToInvoice(note, itemsResult.rows));
  }
  return invoices;
}

async function loadDebitNoteInvoices(period, branchId) {
  const params = [period.start, period.endTs];
  let query = `
    SELECT * FROM debit_notes
    WHERE COALESCE(issued_at, created_at) >= $1 AND COALESCE(issued_at, created_at) <= $2
      AND status IN ('issued', 'transmitted')
  `;
  if (branchId) {
    params.push(branchId);
    query += ` AND branch_id = $${params.length}`;
  }
  query += ' ORDER BY COALESCE(issued_at, created_at)';

  const result = await db.query(query, params);
  const invoices = [];
  for (const note of result.rows) {
    const itemsResult = await db.query(
      'SELECT * FROM debit_note_items WHERE debit_note_id = $1 ORDER BY id',
      [note.id],
    );
    invoices.push(mapDebitNoteToInvoice(note, itemsResult.rows));
  }
  return invoices;
}

async function loadPayments(period) {
  const paymentsResult = await db.query(
    `SELECT * FROM payments WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at`,
    [period.start, period.endTs],
  );

  return paymentsResult.rows.map((p) => ({
    PaymentRefNo: p.payment_number,
    ATCUD: '0',
    Period: toPeriod(p.created_at),
    TransactionID: p.id,
    TransactionDate: toDateOnly(p.created_at),
    PaymentType: p.payment_type === 'receipt' ? 'RC' : 'RG',
    SystemID: p.id,
    DocumentStatus: {
      PaymentStatus: 'N',
      PaymentStatusDate: p.created_at,
      SourceID: 'System',
      SourcePayment: 'P',
    },
    PaymentMethod: {
      PaymentMechanism: p.payment_method === 'cash' ? 'NU' : p.payment_method === 'card' ? 'CC' : 'TB',
      PaymentAmount: parseFloat(p.amount),
      PaymentDate: toDateOnly(p.created_at),
    },
    SourceID: 'System',
    SystemEntryDate: p.created_at,
    CustomerID: p.entity_type === 'customer' ? p.entity_id : undefined,
    SupplierID: p.entity_type === 'supplier' ? p.entity_id : undefined,
    DocumentTotals: {
      TaxPayable: '0.00',
      NetTotal: parseFloat(p.amount),
      GrossTotal: parseFloat(p.amount),
    },
  }));
}

async function loadJournalEntries(period) {
  const journalResult = await db.query(
    `SELECT je.*,
            coa.code AS account_code,
            coa.name AS account_name,
            jel.debit_amount AS debit,
            jel.credit_amount AS credit,
            jel.description AS line_desc
     FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
     LEFT JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE je.entry_date >= $1 AND je.entry_date <= $2
     ORDER BY je.entry_date, je.entry_number`,
    [period.start, period.end],
  );

  const journalMap = new Map();
  for (const row of journalResult.rows) {
    if (!journalMap.has(row.id)) {
      journalMap.set(row.id, {
        JournalID: 'A',
        Description: 'Diário Geral',
        Transaction: {
          TransactionID: row.entry_number,
          Period: toPeriod(row.entry_date),
          TransactionDate: row.entry_date,
          SourceID: 'System',
          Description: row.description,
          DocArchivalNumber: row.entry_number,
          TransactionType: 'N',
          GLPostingDate: row.entry_date,
          SystemEntryDate: row.created_at,
          Lines: { DebitLine: [], CreditLine: [] },
        },
      });
    }
    const entry = journalMap.get(row.id);
    const lineData = {
      RecordID: row.account_code,
      AccountID: row.account_code,
      SourceDocumentID: row.reference_id || '',
      SystemEntryDate: row.created_at,
      Description: row.line_desc,
    };
    if (parseFloat(row.debit) > 0) {
      entry.Transaction.Lines.DebitLine.push({ ...lineData, DebitAmount: parseFloat(row.debit) });
    }
    if (parseFloat(row.credit) > 0) {
      entry.Transaction.Lines.CreditLine.push({ ...lineData, CreditAmount: parseFloat(row.credit) });
    }
  }

  return {
    entries: Array.from(journalMap.values()),
    totalDebit: journalResult.rows.reduce((s, r) => s + parseFloat(r.debit || 0), 0),
    totalCredit: journalResult.rows.reduce((s, r) => s + parseFloat(r.credit || 0), 0),
  };
}

async function loadStockMovements(period) {
  const stockResult = await db.query(
    `SELECT sm.*, p.name AS product_name, p.sku, b.name AS warehouse_name
     FROM stock_movements sm
     LEFT JOIN products p ON p.id = sm.product_id
     LEFT JOIN branches b ON b.id = sm.warehouse_id
     WHERE sm.created_at >= $1 AND sm.created_at <= $2
     ORDER BY sm.created_at`,
    [period.start, period.endTs],
  );

  return stockResult.rows.map((sm) => ({
    ProductCode: sm.sku || sm.product_id,
    ProductDescription: sm.product_name,
    MovementDate: toDateOnly(sm.created_at),
    MovementType: sm.movement_type === 'IN' ? 'GR' : 'GD',
    DocumentNumber: sm.reference_number,
    Quantity: parseFloat(sm.quantity),
    UnitPrice: parseFloat(sm.unit_cost) || 0,
  }));
}

function computeInvoiceTotals(invoices) {
  let totalCredit = 0;
  let totalDebit = 0;
  for (const inv of invoices) {
    const gross = parseFloat(inv.DocumentTotals?.GrossTotal || 0);
    if (inv.InvoiceType === 'NC') {
      totalDebit += gross;
    } else {
      totalCredit += gross;
    }
  }
  return {
    totalCredit: totalCredit.toFixed(2),
    totalDebit: totalDebit.toFixed(2),
  };
}

async function generateSaft(options = {}) {
  const period = parsePeriod(options);
  const company = await resolveCompanyForSaft(options.companyOverride);
  const branchId = options.branchId || null;
  const includeVoided = Boolean(options.includeVoided);

  const [masterFiles, salesInvoices, creditInvoices, debitInvoices, payments, journals, stockMovements] =
    await Promise.all([
      loadMasterFiles(),
      loadSalesInvoices(period, branchId, includeVoided),
      loadCreditNoteInvoices(period, branchId),
      loadDebitNoteInvoices(period, branchId),
      loadPayments(period),
      loadJournalEntries(period),
      loadStockMovements(period),
    ]);

  const allInvoices = [...salesInvoices, ...creditInvoices, ...debitInvoices].sort((a, b) => {
    const da = `${a.InvoiceDate}T${a.SystemEntryDate || ''}`;
    const db_ = `${b.InvoiceDate}T${b.SystemEntryDate || ''}`;
    return da.localeCompare(db_);
  });

  const invoiceTotals = computeInvoiceTotals(allInvoices);

  const saft = {
    AuditFile: {
      Header: companyToSaftHeader(company, period),
      MasterFiles: masterFiles,
      SourceDocuments: {
        SalesInvoices: {
          NumberOfEntries: allInvoices.length,
          TotalDebit: invoiceTotals.totalDebit,
          TotalCredit: invoiceTotals.totalCredit,
          Invoice: allInvoices,
        },
        Payments: {
          NumberOfEntries: payments.length,
          TotalDebit: '0.00',
          TotalCredit: payments.reduce((s, p) => s + parseFloat(p.DocumentTotals.GrossTotal), 0).toFixed(2),
          Payment: payments,
        },
        MovementOfGoods: {
          NumberOfEntries: stockMovements.length,
          TotalQuantityIssued: stockMovements.filter((s) => s.MovementType === 'GD').reduce((s, m) => s + m.Quantity, 0),
          TotalQuantityReceived: stockMovements.filter((s) => s.MovementType === 'GR').reduce((s, m) => s + m.Quantity, 0),
          StockMovement: stockMovements,
        },
      },
      GeneralLedgerEntries: {
        NumberOfEntries: journals.entries.length,
        TotalDebit: journals.totalDebit.toFixed(2),
        TotalCredit: journals.totalCredit.toFixed(2),
        Journal: journals.entries,
      },
    },
  };

  return { saft, company, period };
}

async function generateSaftPreview(options = {}) {
  const period = parsePeriod(options);
  const branchId = options.branchId || null;
  const includeVoided = Boolean(options.includeVoided);
  const branchFilter = branchId ? ' AND branch_id = $3' : '';
  const branchParams = branchId ? [branchId] : [];

  const countQuery = async (table, dateCol, extra = '') => {
    const params = [period.start, period.endTs, ...branchParams];
    const res = await db.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
       FROM ${table}
       WHERE ${dateCol} >= $1 AND ${dateCol} <= $2${branchFilter}${extra}`,
      params,
    );
    return {
      count: parseInt(res.rows[0]?.count || 0, 10),
      total: parseFloat(res.rows[0]?.total || 0),
    };
  };

  const [sales, creditNotes, debitNotes, payments, journals, movements, company] = await Promise.all([
    (async () => {
      const params = [period.start, period.endTs];
      let q = `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM sales
               WHERE created_at >= $1 AND created_at <= $2`;
      if (branchId) {
        params.push(branchId);
        q += ` AND branch_id = $${params.length}`;
      }
      if (!includeVoided) q += " AND status = 'completed'";
      const res = await db.query(q, params);
      return {
        count: parseInt(res.rows[0]?.count || 0, 10),
        total: parseFloat(res.rows[0]?.total || 0),
      };
    })(),
    countQuery('credit_notes', 'COALESCE(issued_at, created_at)', " AND status IN ('issued', 'transmitted')"),
    countQuery('debit_notes', 'COALESCE(issued_at, created_at)', " AND status IN ('issued', 'transmitted')"),
    db.query(
      'SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM payments WHERE created_at >= $1 AND created_at <= $2',
      [period.start, period.endTs],
    ).then((r) => ({
      count: parseInt(r.rows[0]?.count || 0, 10),
      total: parseFloat(r.rows[0]?.total || 0),
    })),
    db.query(
      'SELECT COUNT(*) AS count FROM journal_entries WHERE entry_date >= $1 AND entry_date <= $2',
      [period.start, period.end],
    ).then((r) => parseInt(r.rows[0]?.count || 0, 10)),
    db.query(
      'SELECT COUNT(*) AS count FROM stock_movements WHERE created_at >= $1 AND created_at <= $2',
      [period.start, period.endTs],
    ).then((r) => parseInt(r.rows[0]?.count || 0, 10)),
    resolveCompanyForSaft(options.companyOverride),
  ]);

  return {
    period: { start: period.start, end: period.end, fiscalYear: period.fiscalYear },
    company: { name: company.name, nif: company.nif },
    sales,
    creditNotes,
    debitNotes,
    totalDocuments: sales.count + creditNotes.count + debitNotes.count,
    payments,
    journalEntries: journals,
    stockMovements: movements,
  };
}

module.exports = { generateSaft, generateSaftPreview, parsePeriod };
