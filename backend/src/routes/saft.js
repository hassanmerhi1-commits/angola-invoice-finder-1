// SAF-T AO Backend Export Route
// Pulls from all transaction engine tables into AGT-compliant format
const express = require('express');
const db = require('../db');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // Generate SAF-T AO export
  router.get('/generate', async (req, res) => {
    try {
      const { year, startDate, endDate } = req.query;
      const fiscalYear = year || new Date().getFullYear();
      const start = startDate || `${fiscalYear}-01-01`;
      const end = endDate || `${fiscalYear}-12-31`;

      // 1. Header
      const header = {
        AuditFileVersion: '1.01_01',
        CompanyID: 'KWANZA_ERP',
        TaxRegistrationNumber: '',
        TaxAccountingBasis: 'I',
        CompanyName: 'Empresa',
        FiscalYear: fiscalYear.toString(),
        StartDate: start,
        EndDate: end,
        CurrencyCode: 'AOA',
        DateCreated: new Date().toISOString().split('T')[0],
        TaxEntity: 'Global',
        ProductCompanyTaxID: '000000000',
        SoftwareCertificateNumber: '0000',
        ProductID: 'NEXOR ERP',
        ProductVersion: '2.0',
      };

      // 2. Master Files
      const [customers, suppliers, products, accounts] = await Promise.all([
        db.query('SELECT * FROM clients ORDER BY name'),
        db.query('SELECT * FROM suppliers ORDER BY name'),
        db.query(`
          SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY sku ORDER BY datetime(created_at) DESC) AS rn
            FROM products WHERE is_active = 1
          ) x WHERE rn = 1 ORDER BY sku
        `),
        db.query('SELECT * FROM chart_of_accounts WHERE is_active = true ORDER BY code'),
      ]);

      const masterFiles = {
        Customer: customers.rows.map(c => ({
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
        Supplier: suppliers.rows.map(s => ({
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
        Product: products.rows.map(p => ({
          ProductType: 'P',
          ProductCode: p.sku,
          ProductGroup: p.category || '',
          ProductDescription: p.name,
          ProductNumberCode: p.barcode || p.sku,
        })),
        GeneralLedgerAccounts: {
          Account: accounts.rows.map(a => ({
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

      // 3. Source Documents — Sales Invoices
      const salesResult = await db.query(
        `SELECT s.*, b.name as branch_name FROM sales s 
         LEFT JOIN branches b ON b.id = s.branch_id
         WHERE s.created_at >= $1 AND s.created_at <= $2
         ORDER BY s.created_at`,
        [start, end + 'T23:59:59']
      );

      const salesInvoices = [];
      for (const sale of salesResult.rows) {
        const itemsResult = await db.query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
        salesInvoices.push({
          InvoiceNo: sale.invoice_number,
          ATCUD: sale.atcud || '0',
          DocumentStatus: {
            InvoiceStatus: sale.status === 'completed' ? 'N' : 'A',
            InvoiceStatusDate: sale.created_at,
            SourceID: sale.cashier_name || 'System',
            SourceBilling: 'P',
          },
          Hash: sale.saft_hash || '0',
          HashControl: '1',
          Period: new Date(sale.created_at).getMonth() + 1,
          InvoiceDate: new Date(sale.created_at).toISOString().split('T')[0],
          InvoiceType: 'FT',
          SpecialRegimes: { SelfBillingIndicator: '0', CashVATSchemeIndicator: '0', ThirdPartiesBillingIndicator: '0' },
          SourceID: sale.cashier_name || 'System',
          SystemEntryDate: sale.created_at,
          CustomerID: sale.customer_nif || '999999990',
          Line: itemsResult.rows.map((item, idx) => ({
            LineNumber: idx + 1,
            ProductCode: item.sku || item.product_id,
            ProductDescription: item.product_name,
            Quantity: item.quantity,
            UnitOfMeasure: 'UN',
            UnitPrice: parseFloat(item.unit_price),
            TaxPointDate: new Date(sale.created_at).toISOString().split('T')[0],
            Description: item.product_name,
            CreditAmount: parseFloat(item.subtotal),
            Tax: { TaxType: 'IVA', TaxCountryRegion: 'AO', TaxCode: 'NOR', TaxPercentage: parseFloat(item.tax_rate) || 14 },
          })),
          DocumentTotals: {
            TaxPayable: parseFloat(sale.tax_amount),
            NetTotal: parseFloat(sale.subtotal),
            GrossTotal: parseFloat(sale.total),
            Currency: { CurrencyCode: sale.currency || 'AOA', CurrencyAmount: parseFloat(sale.total) },
          },
        });
      }

      // 4. Source Documents — Payments
      const paymentsResult = await db.query(
        `SELECT * FROM payments WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at`,
        [start, end + 'T23:59:59']
      );

      const paymentsData = paymentsResult.rows.map(p => ({
        PaymentRefNo: p.payment_number,
        ATCUD: '0',
        Period: new Date(p.created_at).getMonth() + 1,
        TransactionID: p.id,
        TransactionDate: new Date(p.created_at).toISOString().split('T')[0],
        PaymentType: p.payment_type === 'receipt' ? 'RC' : 'RG',
        SystemID: p.id,
        DocumentStatus: { PaymentStatus: 'N', PaymentStatusDate: p.created_at, SourceID: 'System', SourcePayment: 'P' },
        PaymentMethod: {
          PaymentMechanism: p.payment_method === 'cash' ? 'NU' : p.payment_method === 'card' ? 'CC' : 'TB',
          PaymentAmount: parseFloat(p.amount),
          PaymentDate: new Date(p.created_at).toISOString().split('T')[0],
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

      // 5. General Ledger Entries
      const journalResult = await db.query(
        `SELECT je.*, jel.account_code, jel.account_name, jel.debit, jel.credit, jel.description as line_desc
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.entry_id = je.id
         WHERE je.entry_date >= $1 AND je.entry_date <= $2
         ORDER BY je.entry_date, je.entry_number`,
        [start, end]
      );

      // Group by journal
      const journalMap = new Map();
      for (const row of journalResult.rows) {
        if (!journalMap.has(row.id)) {
          journalMap.set(row.id, {
            JournalID: 'A',
            Description: 'Diário Geral',
            Transaction: {
              TransactionID: row.entry_number,
              Period: new Date(row.entry_date).getMonth() + 1,
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

      // 6. Stock movements
      const stockResult = await db.query(
        `SELECT sm.*, p.name as product_name, p.sku, b.name as warehouse_name
         FROM stock_movements sm
         LEFT JOIN products p ON p.id = sm.product_id
         LEFT JOIN branches b ON b.id = sm.warehouse_id
         WHERE sm.created_at >= $1 AND sm.created_at <= $2
         ORDER BY sm.created_at`,
        [start, end + 'T23:59:59']
      );

      const stockMovements = stockResult.rows.map(sm => ({
        ProductCode: sm.sku || sm.product_id,
        ProductDescription: sm.product_name,
        MovementDate: new Date(sm.created_at).toISOString().split('T')[0],
        MovementType: sm.movement_type === 'IN' ? 'GR' : 'GD',
        DocumentNumber: sm.reference_number,
        Quantity: parseFloat(sm.quantity),
        UnitPrice: parseFloat(sm.unit_cost) || 0,
      }));

      // Assemble SAF-T
      const saft = {
        AuditFile: {
          Header: header,
          MasterFiles: masterFiles,
          SourceDocuments: {
            SalesInvoices: {
              NumberOfEntries: salesInvoices.length,
              TotalDebit: '0.00',
              TotalCredit: salesInvoices.reduce((s, inv) => s + inv.DocumentTotals.GrossTotal, 0).toFixed(2),
              Invoice: salesInvoices,
            },
            Payments: {
              NumberOfEntries: paymentsData.length,
              TotalDebit: '0.00',
              TotalCredit: paymentsData.reduce((s, p) => s + p.DocumentTotals.GrossTotal, 0).toFixed(2),
              Payment: paymentsData,
            },
            MovementOfGoods: {
              NumberOfEntries: stockMovements.length,
              TotalQuantityIssued: stockMovements.filter(s => s.MovementType === 'GD').reduce((s, m) => s + m.Quantity, 0),
              TotalQuantityReceived: stockMovements.filter(s => s.MovementType === 'GR').reduce((s, m) => s + m.Quantity, 0),
              StockMovement: stockMovements,
            },
          },
          GeneralLedgerEntries: {
            NumberOfEntries: journalMap.size,
            TotalDebit: journalResult.rows.reduce((s, r) => s + parseFloat(r.debit || 0), 0).toFixed(2),
            TotalCredit: journalResult.rows.reduce((s, r) => s + parseFloat(r.credit || 0), 0).toFixed(2),
            Journal: Array.from(journalMap.values()),
          },
        },
      };

      res.json(saft);
    } catch (error) {
      console.error('[SAF-T ERROR]', error);
      res.status(500).json({ error: 'Failed to generate SAF-T export' });
    }
  });

  // Summary stats for SAF-T preview
  router.get('/summary', async (req, res) => {
    try {
      const year = req.query.year || new Date().getFullYear();
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;

      const [sales, payments, journals, movements] = await Promise.all([
        db.query('SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM sales WHERE created_at >= $1 AND created_at <= $2', [start, end + 'T23:59:59']),
        db.query('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE created_at >= $1 AND created_at <= $2', [start, end + 'T23:59:59']),
        db.query('SELECT COUNT(*) as count FROM journal_entries WHERE entry_date >= $1 AND entry_date <= $2', [start, end]),
        db.query('SELECT COUNT(*) as count FROM stock_movements WHERE created_at >= $1 AND created_at <= $2', [start, end + 'T23:59:59']),
      ]);

      res.json({
        year,
        sales: { count: parseInt(sales.rows[0].count), total: parseFloat(sales.rows[0].total) },
        payments: { count: parseInt(payments.rows[0].count), total: parseFloat(payments.rows[0].total) },
        journalEntries: parseInt(journals.rows[0].count),
        stockMovements: parseInt(movements.rows[0].count),
      });
    } catch (error) {
      console.error('[SAF-T ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch summary' });
    }
  });

  return router;
};
