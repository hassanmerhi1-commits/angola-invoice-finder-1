// Journal Entries API routes
const express = require('express');
const db = require('../db');
const { enrichJournalEntryContext, enrichJournalEntries } = require('../lib/journalEntryContext');
const { buildJournalBranchFilter } = require('../lib/branchIdMatch');
const { parseListPagination, parseTruthyQuery } = require('../lib/listPagination');
const { requirePermission } = require('../middleware/requirePermission');
const { reverseJournalEntry } = require('../lib/purchaseInvoicePosting');
const { updateJournalEntry } = require('../accounting');
const { auditErpSafe } = require('../lib/erpAudit');
const {
  assertCanUsePostingDate,
  assertCanEditHistorical,
  toISODateOnly,
} = require('../lib/workingDayAccess');

const ENTRY_HEADER_SELECT = `
  SELECT je.*,
    COALESCE(NULLIF(je.created_by_name, ''), u.name) AS created_by_name,
    b.name AS branch_name
  FROM journal_entries je
  LEFT JOIN users u ON je.created_by = u.id
  LEFT JOIN branches b ON je.branch_id = b.id
`;

async function loadJournalLines(entryId) {
  const linesResult = await db.query(`
    SELECT jel.*,
      coa.code AS account_code,
      coa.name AS account_name
    FROM journal_entry_lines jel
    LEFT JOIN chart_of_accounts coa ON jel.account_id = coa.id
    WHERE jel.journal_entry_id = $1
    ORDER BY jel.debit_amount DESC, jel.credit_amount ASC
  `, [entryId]);
  return linesResult.rows;
}

module.exports = function(broadcastTable) {
  const router = express.Router();

  // Get all journal entries with lines
  router.get('/', async (req, res) => {
    try {
      const { branchId, referenceType, startDate, endDate } = req.query;
      const { limit, offset } = parseListPagination(req, { defaultLimit: 200, maxLimit: 500 });
      const includeLines = parseTruthyQuery(req.query.includeLines);
      const includeContext = parseTruthyQuery(req.query.includeContext);
      let query = `${ENTRY_HEADER_SELECT} WHERE 1=1`;
      const params = [];
      let paramIndex = 1;

      if (branchId) {
        const branchFilter = await buildJournalBranchFilter(db, branchId, paramIndex);
        if (branchFilter.sql) {
          query += branchFilter.sql;
          params.push(...branchFilter.params);
          paramIndex += branchFilter.params.length;
        }
      }
      if (referenceType) {
        query += ` AND je.reference_type = $${paramIndex++}`;
        params.push(referenceType);
      }
      if (startDate) {
        query += ` AND je.entry_date >= $${paramIndex++}`;
        params.push(startDate);
      }
      if (endDate) {
        query += ` AND je.entry_date <= $${paramIndex++}`;
        params.push(endDate);
      }

      query += ` ORDER BY je.entry_date DESC, je.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(limit, offset);
      const result = await db.query(query, params);

      if (includeLines) {
        for (const entry of result.rows) {
          entry.lines = await loadJournalLines(entry.id);
        }
      } else {
        for (const entry of result.rows) {
          entry.lines = [];
        }
      }
      if (includeContext) {
        await enrichJournalEntries(db, result.rows);
      }

      res.json({
        items: result.rows,
        limit,
        offset,
        hasMore: result.rows.length === limit,
      });
    } catch (error) {
      console.error('[JOURNAL ENTRIES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch journal entries' });
    }
  });

  // Get single journal entry
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await db.query(`${ENTRY_HEADER_SELECT} WHERE je.id = $1`, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Journal entry not found' });
      }

      const entry = result.rows[0];
      entry.lines = await loadJournalLines(id);
      entry.context = await enrichJournalEntryContext(db, entry);

      res.json(entry);
    } catch (error) {
      console.error('[JOURNAL ENTRIES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch journal entry' });
    }
  });

  // Get entries by reference
  router.get('/reference/:type/:id', async (req, res) => {
    try {
      const { type, id } = req.params;
      const result = await db.query(
        `${ENTRY_HEADER_SELECT}
         WHERE je.reference_type = $1 AND je.reference_id = $2
         ORDER BY je.created_at`,
        [type, id],
      );

      for (const entry of result.rows) {
        entry.lines = await loadJournalLines(entry.id);
      }
      await enrichJournalEntries(db, result.rows);

      res.json(result.rows);
    } catch (error) {
      console.error('[JOURNAL ENTRIES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch journal entries' });
    }
  });

  /** Edit manual/adjustment journal in place (keeps entry number). */
  router.put('/:id', requirePermission('accounting_create', 'accounting_journal'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const body = req.body || {};
      const lines = Array.isArray(body.lines) ? body.lines : body.journalLines;
      if (!Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({ error: 'At least 2 journal lines are required' });
      }
      const description = String(body.description || '').trim();
      if (!description) {
        return res.status(400).json({ error: 'Description is required' });
      }

      const existing = await db.query(
        'SELECT entry_date FROM journal_entries WHERE id = $1 LIMIT 1',
        [req.params.id],
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ error: 'Journal entry not found' });
      }
      const existingDate = toISODateOnly(existing.rows[0].entry_date);
      const newDate = toISODateOnly(body.entryDate || body.entry_date || body.date || existingDate);
      assertCanEditHistorical(req.user, existingDate);
      assertCanUsePostingDate(req.user, newDate);

      await client.query('BEGIN');
      const result = await updateJournalEntry(client, req.params.id, {
        description,
        lines: lines.map((l) => ({
          accountCode: l.accountCode || l.account_code,
          description: l.description,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        })),
        entryDate: body.entryDate || body.entry_date || body.date || null,
        createdBy: req.user?.id || body.createdBy || null,
      });
      await client.query('COMMIT');

      if (broadcastTable) {
        await broadcastTable('journal_entries');
        await broadcastTable('chart_of_accounts');
      }
      auditErpSafe(req, {
        table: 'journal_entries',
        id: req.params.id,
        action: 'update',
        description: `Diário atualizado: ${result.entry_number || req.params.id}`,
        newValues: {
          entryNumber: result.entry_number,
          totalDebit: result.total_debit,
          totalCredit: result.total_credit,
        },
      });

      const fresh = await db.query(`${ENTRY_HEADER_SELECT} WHERE je.id = $1`, [req.params.id]);
      const entry = fresh.rows[0];
      if (entry) {
        entry.lines = await loadJournalLines(req.params.id);
        entry.context = await enrichJournalEntryContext(db, entry);
      }
      res.json(entry || result);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      console.error('[JOURNAL ENTRIES update]', error);
      const msg = error.message || 'Failed to update journal entry';
      let status = 500;
      if (error.status === 403 || error.code === 'BACKDATE_DENIED' || error.code === 'EDIT_HISTORICAL_DENIED') {
        status = 403;
      } else if (/cannot edit|not found|not balanced|required|período/i.test(msg)) {
        status = 400;
      }
      res.status(status).json({ error: msg, code: error.code || undefined });
    } finally {
      client.release();
    }
  });

  /** Audit-safe reverse — posts opposite lines; does not delete the original. */
  router.post('/:id/reverse', requirePermission('accounting_create', 'accounting_journal'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const existing = await db.query(
        'SELECT entry_date FROM journal_entries WHERE id = $1 LIMIT 1',
        [req.params.id],
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ error: 'Journal entry not found' });
      }
      const existingDate = toISODateOnly(existing.rows[0].entry_date);
      assertCanEditHistorical(req.user, existingDate);
      const reverseDate = toISODateOnly(req.body?.entryDate || existingDate);
      assertCanUsePostingDate(req.user, reverseDate);

      await client.query('BEGIN');
      const result = await reverseJournalEntry(client, req.params.id, {
        createdBy: req.user?.id || req.body?.createdBy || null,
        entryDate: req.body?.entryDate || null,
      });
      await client.query('COMMIT');
      if (broadcastTable) {
        await broadcastTable('journal_entries');
        await broadcastTable('chart_of_accounts');
      }
      auditErpSafe(req, {
        table: 'journal_entries',
        id: req.params.id,
        action: 'reverse',
        description: `Diário revertido: ${req.params.id}`,
        newValues: { reverseEntryId: result?.id || null, alreadyReversed: !!result?.alreadyReversed },
      });
      res.json({
        success: true,
        originalId: req.params.id,
        reverseEntryId: result?.id || null,
        alreadyReversed: !!result?.alreadyReversed,
      });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      console.error('[JOURNAL ENTRIES reverse]', error);
      const msg = error.message || 'Failed to reverse journal entry';
      let status = 500;
      if (error.status === 403 || error.code === 'BACKDATE_DENIED' || error.code === 'EDIT_HISTORICAL_DENIED') {
        status = 403;
      } else if (/cannot reverse|no lines|not found|período/i.test(msg)) {
        status = 400;
      }
      res.status(status).json({ error: msg, code: error.code || undefined });
    } finally {
      client.release();
    }
  });

  // Summary: totals by reference type
  router.get('/reports/summary', async (req, res) => {
    try {
      const { startDate, endDate, branchId } = req.query;
      let query = `
        SELECT 
          reference_type,
          COUNT(*) as entry_count,
          SUM(total_debit) as total_debit,
          SUM(total_credit) as total_credit
        FROM journal_entries je
        WHERE je.is_posted = true
      `;
      const params = [];
      let paramIndex = 1;

      if (branchId) {
        const branchFilter = await buildJournalBranchFilter(db, branchId, paramIndex);
        if (branchFilter.sql) {
          query += branchFilter.sql;
          params.push(...branchFilter.params);
          paramIndex += branchFilter.params.length;
        }
      }
      if (startDate) {
        query += ` AND je.entry_date >= $${paramIndex++}`;
        params.push(startDate);
      }
      if (endDate) {
        query += ` AND je.entry_date <= $${paramIndex++}`;
        params.push(endDate);
      }

      query += ' GROUP BY reference_type ORDER BY reference_type';
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('[JOURNAL ENTRIES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch summary' });
    }
  });

  return router;
};
