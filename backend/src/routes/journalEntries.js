// Journal Entries API routes
const express = require('express');
const db = require('../db');
const { enrichJournalEntryContext, enrichJournalEntries } = require('../lib/journalEntryContext');
const { buildJournalBranchFilter } = require('../lib/branchIdMatch');

const ENTRY_HEADER_SELECT = `
  SELECT je.*,
    u.name AS created_by_name,
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

      query += ' ORDER BY je.entry_date DESC, je.created_at DESC';
      const result = await db.query(query, params);

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
        FROM journal_entries
        WHERE is_posted = true
      `;
      const params = [];
      let paramIndex = 1;

      if (branchId) {
        query += ` AND branch_id = $${paramIndex++}`;
        params.push(branchId);
      }
      if (startDate) {
        query += ` AND entry_date >= $${paramIndex++}`;
        params.push(startDate);
      }
      if (endDate) {
        query += ` AND entry_date <= $${paramIndex++}`;
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
