// Tax Engine API Routes
const express = require('express');
const db = require('../db');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // Get all tax codes
  router.get('/codes', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM tax_codes WHERE is_active = true ORDER BY tax_type, rate');
      res.json(result.rows);
    } catch (error) {
      console.error('[TAX ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch tax codes' });
    }
  });

  // Create tax code
  router.post('/codes', async (req, res) => {
    try {
      const { code, name, rate, taxType, description, accountCodeOutput, accountCodeInput } = req.body;
      const result = await db.query(
        `INSERT INTO tax_codes (code, name, rate, tax_type, description, account_code_output, account_code_input)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [code, name, rate, taxType || 'IVA', description || '', accountCodeOutput, accountCodeInput]
      );
      broadcastTable('tax_codes');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('[TAX ERROR]', error);
      res.status(500).json({ error: 'Failed to create tax code' });
    }
  });

  // Update tax code
  router.put('/codes/:id', async (req, res) => {
    try {
      const { name, rate, description, isActive, accountCodeOutput, accountCodeInput } = req.body;
      const result = await db.query(
        `UPDATE tax_codes SET name = COALESCE($1, name), rate = COALESCE($2, rate),
         description = COALESCE($3, description), is_active = COALESCE($4, is_active),
         account_code_output = COALESCE($5, account_code_output),
         account_code_input = COALESCE($6, account_code_input)
         WHERE id = $7 RETURNING *`,
        [name, rate, description, isActive, accountCodeOutput, accountCodeInput, req.params.id]
      );
      broadcastTable('tax_codes');
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[TAX ERROR]', error);
      res.status(500).json({ error: 'Failed to update tax code' });
    }
  });

  // Get tax lines for a document
  router.get('/lines/:documentType/:documentId', async (req, res) => {
    try {
      const result = await db.query(
        'SELECT * FROM tax_lines WHERE document_type = $1 AND document_id = $2 ORDER BY line_number',
        [req.params.documentType, req.params.documentId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[TAX ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch tax lines' });
    }
  });

  // Monthly IVA declaration report
  router.get('/iva-report', async (req, res) => {
    try {
      const { year, month } = req.query;
      let query = 'SELECT * FROM v_iva_monthly';
      const params = [];

      if (year) {
        params.push(year);
        query += ` WHERE period_year = $${params.length}`;
      }
      if (month) {
        params.push(month);
        query += params.length > 1 ? ` AND period_month = $${params.length}` : ` WHERE period_month = $${params.length}`;
      }

      const result = await db.query(query, params);

      // Calculate totals
      const outputTax = result.rows.filter(r => r.direction === 'output').reduce((s, r) => s + parseFloat(r.total_tax), 0);
      const inputTax = result.rows.filter(r => r.direction === 'input').reduce((s, r) => s + parseFloat(r.total_tax), 0);

      res.json({
        lines: result.rows,
        outputTax,
        inputTax,
        ivaPayable: outputTax - inputTax,
      });
    } catch (error) {
      console.error('[TAX ERROR]', error);
      res.status(500).json({ error: 'Failed to generate IVA report' });
    }
  });

  // Fiscal documents summary (FT, NC, ND, GT) for a period
  router.get('/fiscal-documents-report', async (req, res) => {
    try {
      const year = req.query.year ? Number(req.query.year) : null;
      const month = req.query.month ? Number(req.query.month) : null;

      function periodClause(dateCol, params) {
        let clause = '';
        if (year) {
          params.push(year);
          clause += ` AND EXTRACT(YEAR FROM ${dateCol}) = $${params.length}`;
        }
        if (month) {
          params.push(month);
          clause += ` AND EXTRACT(MONTH FROM ${dateCol}) = $${params.length}`;
        }
        return clause;
      }

      async function queryDocType(docType, sql, dateCol) {
        const params = [];
        const period = periodClause(dateCol, params);
        const result = await db.query(sql.replace('/*PERIOD*/', period), params);
        const row = result.rows[0] || {};
        return {
          docType,
          documentCount: Number(row.document_count || 0),
          subtotal: Number(row.subtotal || 0),
          taxAmount: Number(row.tax_amount || 0),
          total: Number(row.total || 0),
          agtValidatedCount: Number(row.agt_validated_count || 0),
        };
      }

      async function querySalesByType(invoiceType, docType, dateCol) {
        const params = [invoiceType];
        const period = periodClause(dateCol, params);
        const result = await db.query(
          `SELECT COUNT(*)::int AS document_count,
                  COALESCE(SUM(subtotal), 0)::float AS subtotal,
                  COALESCE(SUM(tax_amount), 0)::float AS tax_amount,
                  COALESCE(SUM(total), 0)::float AS total,
                  COUNT(*) FILTER (
                    WHERE LOWER(COALESCE(agt_status, '')) IN ('validated', 'approved', 'submitted')
                  )::int AS agt_validated_count
           FROM sales
           WHERE COALESCE(fiscal_status, 'issued') = 'issued'
             AND COALESCE(status, '') NOT IN ('draft', 'voided', 'cancelled')
             AND UPPER(COALESCE(invoice_type, 'FT')) = $1
             ${period}`,
          params,
        );
        const row = result.rows[0] || {};
        return {
          docType,
          documentCount: Number(row.document_count || 0),
          subtotal: Number(row.subtotal || 0),
          taxAmount: Number(row.tax_amount || 0),
          total: Number(row.total || 0),
          agtValidatedCount: Number(row.agt_validated_count || 0),
        };
      }

      const lines = await Promise.all([
        querySalesByType('FT', 'FT', 'created_at'),
        querySalesByType('FR', 'FR', 'created_at'),
        querySalesByType('FS', 'FS', 'created_at'),
        queryDocType('NC', `
          SELECT COUNT(*)::int AS document_count,
                 COALESCE(SUM(subtotal), 0)::float AS subtotal,
                 COALESCE(SUM(tax_amount), 0)::float AS tax_amount,
                 COALESCE(SUM(total), 0)::float AS total,
                 COUNT(*) FILTER (
                   WHERE LOWER(COALESCE(agt_status, '')) IN ('validated', 'approved', 'submitted')
                 )::int AS agt_validated_count
          FROM credit_notes
          WHERE status IN ('issued', 'transmitted')
            /*PERIOD*/
        `, 'COALESCE(issued_at, created_at)'),
        queryDocType('ND', `
          SELECT COUNT(*)::int AS document_count,
                 COALESCE(SUM(subtotal), 0)::float AS subtotal,
                 COALESCE(SUM(tax_amount), 0)::float AS tax_amount,
                 COALESCE(SUM(total), 0)::float AS total,
                 COUNT(*) FILTER (
                   WHERE LOWER(COALESCE(agt_status, '')) IN ('validated', 'approved', 'submitted')
                 )::int AS agt_validated_count
          FROM debit_notes
          WHERE status IN ('issued', 'transmitted')
            /*PERIOD*/
        `, 'COALESCE(issued_at, created_at)'),
        queryDocType('GT', `
          SELECT COUNT(*)::int AS document_count,
                 0::float AS subtotal,
                 0::float AS tax_amount,
                 0::float AS total,
                 0::int AS agt_validated_count
          FROM transport_documents
          WHERE status NOT IN ('draft', 'cancelled')
            /*PERIOD*/
        `, 'COALESCE(issued_at, created_at)'),
      ]);

      const totals = lines.reduce(
        (acc, line) => ({
          documentCount: acc.documentCount + line.documentCount,
          subtotal: acc.subtotal + line.subtotal,
          taxAmount: acc.taxAmount + line.taxAmount,
          total: acc.total + line.total,
          agtValidatedCount: acc.agtValidatedCount + line.agtValidatedCount,
        }),
        { documentCount: 0, subtotal: 0, taxAmount: 0, total: 0, agtValidatedCount: 0 },
      );

      res.json({ lines, totals, year, month });
    } catch (error) {
      console.error('[TAX ERROR]', error);
      res.status(500).json({ error: 'Failed to generate fiscal documents report' });
    }
  });

  // Tax summary for a period
  router.get('/summary', async (req, res) => {
    try {
      const { year, month } = req.query;
      const params = [];
      let where = '';

      if (year) { params.push(year); where += ` AND period_year = $${params.length}`; }
      if (month) { params.push(month); where += ` AND period_month = $${params.length}`; }

      const result = await db.query(
        `SELECT direction, tax_code, tax_rate,
         SUM(total_base) as total_base, SUM(total_tax) as total_tax, COUNT(*) as doc_count
         FROM tax_summaries WHERE 1=1 ${where}
         GROUP BY direction, tax_code, tax_rate
         ORDER BY direction, tax_rate`,
        params
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[TAX ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch tax summary' });
    }
  });

  return router;
};
