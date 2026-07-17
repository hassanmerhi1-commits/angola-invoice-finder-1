const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { resolveBranchFilterId } = require('../lib/branchIdMatch');
const { requirePermission } = require('../middleware/requirePermission');
const { auditErpSafe } = require('../lib/erpAudit');

function mapBankRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name || '',
    bankName: row.bank_name || '',
    accountName: row.name || '',
    accountNumber: row.account_number || '',
    iban: row.iban || '',
    swift: row.swift || '',
    currency: row.currency || 'AOA',
    currentBalance: Number(row.balance) || 0,
    isActive: row.is_active !== false && row.is_active !== 0,
    isPrimary: !!row.is_primary,
    glAccountCode: row.gl_account_code || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function bankAccountsTableExists() {
  // Only cache positive results. A sticky `false` from a race before schema
  // ensure would make GET always return [] and POST always 503.
  if (bankAccountsTableExists.cached === true) return true;
  try {
    const r = await db.query(
      db.engine === 'postgres'
        ? `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bank_accounts' LIMIT 1`
        : `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'bank_accounts' LIMIT 1`,
    );
    const exists = r.rows.length > 0;
    if (exists) bankAccountsTableExists.cached = true;
    return exists;
  } catch {
    return false;
  }
}
bankAccountsTableExists.cached = undefined;

async function ensureBankAccountsTable() {
  try {
    if (db.engine === 'postgres') {
      await db.query(`
        CREATE TABLE IF NOT EXISTS bank_accounts (
          id VARCHAR(64) PRIMARY KEY,
          branch_id VARCHAR(64) NOT NULL DEFAULT '',
          branch_name VARCHAR(255) NOT NULL DEFAULT '',
          bank_name VARCHAR(255) NOT NULL DEFAULT '',
          name VARCHAR(255) NOT NULL DEFAULT '',
          account_number VARCHAR(100) NOT NULL DEFAULT '',
          iban VARCHAR(64) DEFAULT '',
          swift VARCHAR(32) DEFAULT '',
          currency VARCHAR(8) NOT NULL DEFAULT 'AOA',
          balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          is_primary BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query('CREATE INDEX IF NOT EXISTS idx_bank_accounts_branch ON bank_accounts (branch_id)');
    } else if (db.sqlite) {
      db.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS bank_accounts (
          id TEXT PRIMARY KEY,
          branch_id TEXT NOT NULL DEFAULT '',
          branch_name TEXT NOT NULL DEFAULT '',
          bank_name TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          account_number TEXT NOT NULL DEFAULT '',
          iban TEXT DEFAULT '',
          swift TEXT DEFAULT '',
          currency TEXT NOT NULL DEFAULT 'AOA',
          balance REAL NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          is_primary INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }
    bankAccountsTableExists.cached = true;
  } catch (e) {
    console.warn('[BANK] ensure table:', e.message);
    bankAccountsTableExists.cached = undefined;
  }
}

module.exports = function bankAccountsRouter(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      await ensureBankAccountsTable();
      if (!(await bankAccountsTableExists())) {
        return res.json({ data: [] });
      }
      const branchId = String(req.query.branchId || '').trim();
      const params = [];
      let sql = 'SELECT * FROM bank_accounts';
      if (branchId) {
        const resolved = (await resolveBranchFilterId(db, branchId)) || branchId;
        if (db.engine === 'postgres') {
          sql += ' WHERE branch_id::text = $1';
        } else {
          sql += ' WHERE CAST(branch_id AS TEXT) = $1';
        }
        params.push(resolved);
      }
      sql += db.engine === 'postgres'
        ? ' ORDER BY is_primary DESC, updated_at DESC NULLS LAST, created_at DESC'
        : ' ORDER BY is_primary DESC, updated_at DESC, created_at DESC';
      const result = await db.query(sql, params);
      res.json({ data: (result.rows || []).map(mapBankRow).filter(Boolean) });
    } catch (error) {
      console.error('[BANK] list:', error);
      res.status(500).json({ error: error.message || 'Failed to list bank accounts' });
    }
  });

  router.post('/', requirePermission('bank_manage', 'admin_settings'), async (req, res) => {
    try {
      await ensureBankAccountsTable();
      if (!(await bankAccountsTableExists())) {
        return res.status(503).json({ error: 'Bank accounts table not available' });
      }
      const body = req.body || {};
      const branchId = String(body.branchId || body.branch_id || '').trim();
      const branchName = String(body.branchName || body.branch_name || '').trim();
      const bankName = String(body.bankName || body.bank_name || '').trim();
      const accountName = String(body.accountName || body.name || '').trim();
      const accountNumber = String(body.accountNumber || body.account_number || '').trim();
      if (!branchId) return res.status(400).json({ error: 'branchId required' });
      if (!bankName) return res.status(400).json({ error: 'bankName required' });
      if (!accountNumber) return res.status(400).json({ error: 'accountNumber required' });

      const resolvedBranchId = (await resolveBranchFilterId(db, branchId)) || branchId;
      let resolvedBranchName = branchName;
      if (!resolvedBranchName) {
        const br = await db.query(
          db.engine === 'postgres'
            ? 'SELECT name FROM branches WHERE id::text = $1 LIMIT 1'
            : 'SELECT name FROM branches WHERE CAST(id AS TEXT) = $1 LIMIT 1',
          [resolvedBranchId],
        );
        resolvedBranchName = br.rows[0]?.name || '';
      }

      const id = String(body.id || '').trim() || crypto.randomUUID();
      const now = new Date().toISOString();
      const currency = String(body.currency || 'AOA').trim() || 'AOA';
      const openingBalance = Number(body.currentBalance ?? body.balance ?? body.openingBalance) || 0;
      const iban = String(body.iban || '').trim();
      const swift = String(body.swift || '').trim();
      const isActive = body.isActive !== false;
      const isPrimary = !!body.isPrimary;

      const { ensureBankGlColumn, resolveBankGlAccountCode, postBankOpeningBalanceJournal } = require('../lib/bankGlAccounts');
      await ensureBankGlColumn(db);

      const existed = await db.query('SELECT id, gl_account_code FROM bank_accounts WHERE id = $1 LIMIT 1', [id]);
      const isNew = !existed.rows[0];

      await db.query(
        `INSERT INTO bank_accounts (
          id, branch_id, branch_name, bank_name, name, account_number,
          iban, swift, currency, balance, is_active, is_primary, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
        ON CONFLICT (id) DO UPDATE SET
          branch_id = EXCLUDED.branch_id,
          branch_name = EXCLUDED.branch_name,
          bank_name = EXCLUDED.bank_name,
          name = EXCLUDED.name,
          account_number = EXCLUDED.account_number,
          iban = EXCLUDED.iban,
          swift = EXCLUDED.swift,
          currency = EXCLUDED.currency,
          balance = EXCLUDED.balance,
          is_active = EXCLUDED.is_active,
          is_primary = EXCLUDED.is_primary,
          updated_at = EXCLUDED.updated_at`,
        [
          id,
          resolvedBranchId,
          resolvedBranchName,
          bankName,
          accountName || bankName,
          accountNumber,
          iban,
          swift,
          currency,
          openingBalance,
          isActive,
          isPrimary,
          now,
        ],
      );

      // Link to COA 431xxxx + opening journal for new accounts with opening balance.
      if (db.pool) {
        const client = await db.pool.connect();
        try {
          await client.query('BEGIN');
          const bankRow = (await client.query('SELECT * FROM bank_accounts WHERE id = $1', [id])).rows[0];
          const glCode = await resolveBankGlAccountCode(client, bankRow);
          if (isNew && openingBalance > 0) {
            await postBankOpeningBalanceJournal(client, {
              bankId: id,
              branchId: resolvedBranchId,
              glAccountCode: glCode,
              openingBalance,
              createdBy: req.user?.id || null,
              bankLabel: `${bankName} ${accountNumber}`,
            });
          }
          await client.query('COMMIT');
        } catch (glErr) {
          try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
          console.warn('[BANK] GL link/opening:', glErr.message);
        } finally {
          client.release();
        }
      }

      const row = await db.query('SELECT * FROM bank_accounts WHERE id = $1', [id]);
      if (broadcastTable) {
        await broadcastTable('bank_accounts');
        await broadcastTable('journal_entries');
        await broadcastTable('chart_of_accounts');
      }
      auditErpSafe(req, {
        table: 'bank_accounts',
        id,
        action: 'upsert',
        branchId: resolvedBranchId,
        description: `Conta bancária ${bankName} — ${accountNumber}`,
      });
      res.status(201).json({ data: mapBankRow(row.rows[0]) });
    } catch (error) {
      console.error('[BANK] upsert:', error);
      res.status(500).json({ error: error.message || 'Failed to save bank account' });
    }
  });

  router.put('/:id/balance', requirePermission('bank_manage', 'admin_settings'), async (req, res) => {
    try {
      await ensureBankAccountsTable();
      const delta = Number(req.body?.delta);
      if (!Number.isFinite(delta)) return res.status(400).json({ error: 'delta required' });
      await db.query(
        `UPDATE bank_accounts
         SET balance = COALESCE(balance, 0) + $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [delta, req.params.id],
      );
      const row = await db.query('SELECT * FROM bank_accounts WHERE id = $1', [req.params.id]);
      if (!row.rows[0]) return res.status(404).json({ error: 'Bank account not found' });
      if (broadcastTable) await broadcastTable('bank_accounts');
      res.json({ data: mapBankRow(row.rows[0]) });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to update balance' });
    }
  });

  return router;
};
