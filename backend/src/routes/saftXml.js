// SAF-T AO XML Export
// Converts JSON SAF-T to AGT-compliant XML format
const express = require('express');

module.exports = function(saftJsonRouter) {
  const router = express.Router();

  function escapeXml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function jsonToXml(obj, indent = '') {
    let xml = '';
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object') {
            xml += `${indent}<${key}>\n${jsonToXml(item, indent + '  ')}${indent}</${key}>\n`;
          } else {
            xml += `${indent}<${key}>${escapeXml(item)}</${key}>\n`;
          }
        }
      } else if (typeof value === 'object') {
        xml += `${indent}<${key}>\n${jsonToXml(value, indent + '  ')}${indent}</${key}>\n`;
      } else {
        xml += `${indent}<${key}>${escapeXml(value)}</${key}>\n`;
      }
    }
    return xml;
  }

  // Generate XML file
  router.get('/download', async (req, res) => {
    try {
      // Import the SAF-T JSON generation logic
      const db = require('../db');
      const { year, startDate, endDate } = req.query;

      // Build SAF-T JSON using the same logic as saft.js /generate
      // We make an internal HTTP-like call by importing the module
      const saftModule = require('./saft');

      // Create a mock req/res to call the generate endpoint
      const mockRes = {
        _json: null,
        _status: 200,
        json(data) { this._json = data; return this; },
        status(code) { this._status = code; return this; },
      };

      const mockReq = { query: { year, startDate, endDate } };
      
      // Get the router's generate handler
      const tempRouter = saftModule(() => {});
      
      // Instead, just re-fetch from our own API internally  
      // Build the SAF-T data directly
      const fiscalYear = year || new Date().getFullYear();
      const start = startDate || `${fiscalYear}-01-01`;
      const end = endDate || `${fiscalYear}-12-31`;

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

      const salesResult = await db.query(
        `SELECT s.*, b.name as branch_name FROM sales s 
         LEFT JOIN branches b ON b.id = s.branch_id
         WHERE s.created_at >= $1 AND s.created_at <= $2 ORDER BY s.created_at`,
        [start, end + 'T23:59:59']
      );

      // Build minimal but complete SAF-T structure
      const saftData = {
        AuditFile: {
          '@xmlns': 'urn:OECD:StandardAuditFile-Tax:AO_1.01_01',
          Header: {
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
          },
          MasterFiles: {
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
              SelfBillingIndicator: '0',
            })),
            Product: products.rows.map(p => ({
              ProductType: 'P',
              ProductCode: p.sku,
              ProductDescription: p.name,
              ProductNumberCode: p.barcode || p.sku,
            })),
            GeneralLedgerAccounts: {
              Account: accounts.rows.map(a => ({
                AccountID: a.code,
                AccountDescription: a.name,
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
          },
          SourceDocuments: {
            SalesInvoices: {
              NumberOfEntries: salesResult.rows.length.toString(),
              TotalDebit: '0.00',
              TotalCredit: salesResult.rows.reduce((s, inv) => s + parseFloat(inv.total || 0), 0).toFixed(2),
            },
          },
        },
      };

      // Generate XML
      const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';
      const xmlBody = jsonToXml(saftData);
      const xml = xmlHeader + xmlBody;

      const filename = `SAFT_AO_${fiscalYear}_${new Date().toISOString().split('T')[0]}.xml`;
      
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(xml);
    } catch (error) {
      console.error('[SAF-T XML ERROR]', error);
      res.status(500).json({ error: 'Failed to generate SAF-T XML' });
    }
  });

  return router;
};
