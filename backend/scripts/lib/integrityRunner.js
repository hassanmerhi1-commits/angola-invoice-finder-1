/**
 * Shared integrity / consistency check runner.
 */

const UNIQUENESS_CHECKS = [
  { label: 'Sales invoice_number', sql: `SELECT invoice_number AS key, COUNT(*) AS n FROM sales WHERE invoice_number IS NOT NULL AND invoice_number != '' GROUP BY invoice_number HAVING COUNT(*) > 1` },
  { label: 'Payments payment_number', sql: `SELECT payment_number AS key, COUNT(*) AS n FROM payments GROUP BY payment_number HAVING COUNT(*) > 1` },
  { label: 'Purchase orders order_number', sql: `SELECT order_number AS key, COUNT(*) AS n FROM purchase_orders WHERE order_number IS NOT NULL AND order_number != '' GROUP BY order_number HAVING COUNT(*) > 1` },
  { label: 'Purchase invoices (number + branch)', sql: `SELECT invoice_number || ' @ ' || COALESCE(branch_id, '') AS key, COUNT(*) AS n FROM purchase_invoices WHERE invoice_number IS NOT NULL AND TRIM(invoice_number) != '' GROUP BY invoice_number, branch_id HAVING COUNT(*) > 1` },
  { label: 'Journal entry_number', sql: `SELECT entry_number AS key, COUNT(*) AS n FROM journal_entries WHERE entry_number IS NOT NULL AND entry_number != '' GROUP BY entry_number HAVING COUNT(*) > 1` },
  { label: 'Stock transfers transfer_number', sql: `SELECT transfer_number AS key, COUNT(*) AS n FROM stock_transfers WHERE transfer_number IS NOT NULL AND transfer_number != '' GROUP BY transfer_number HAVING COUNT(*) > 1` },
  { label: 'Supplier returns return_number', sql: `SELECT return_number AS key, COUNT(*) AS n FROM supplier_returns GROUP BY return_number HAVING COUNT(*) > 1` },
  { label: 'Products SKU per branch', sql: `SELECT sku || ' @ ' || COALESCE(branch_id, '(shared)') AS key, COUNT(*) AS n FROM products WHERE sku IS NOT NULL AND TRIM(sku) != '' GROUP BY LOWER(TRIM(sku)), branch_id HAVING COUNT(*) > 1` },
  { label: 'Open items document_id', sql: `SELECT document_id AS key, COUNT(*) AS n FROM open_items GROUP BY document_id HAVING COUNT(*) > 1` },
  { label: 'Suppliers NIF', sql: `SELECT nif AS key, COUNT(*) AS n FROM suppliers WHERE nif IS NOT NULL AND TRIM(nif) != '' GROUP BY LOWER(TRIM(nif)) HAVING COUNT(*) > 1` },
  { label: 'Users email', sql: `SELECT email AS key, COUNT(*) AS n FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1` },
  { label: 'Branches code', sql: `SELECT code AS key, COUNT(*) AS n FROM branches GROUP BY code HAVING COUNT(*) > 1` },
  { label: 'Chart of accounts code', sql: `SELECT code AS key, COUNT(*) AS n FROM chart_of_accounts GROUP BY code HAVING COUNT(*) > 1` },
];

const CONSISTENCY_CHECKS = [
  {
    label: 'Supplier balance vs open items',
    severity: 'error',
    hint: 'Run supplier balance repair (API POST /api/suppliers/reconcile-balances or restart app).',
    sql: `
      SELECT s.id AS key, s.name AS detail,
        CAST(s.balance AS REAL) AS stored,
        CAST(COALESCE(oi.calc, 0) AS REAL) AS expected,
        ABS(CAST(s.balance AS REAL) - CAST(COALESCE(oi.calc, 0) AS REAL)) AS diff
      FROM suppliers s
      LEFT JOIN (
        SELECT entity_id,
          SUM(CASE WHEN is_debit = 1 OR is_debit = TRUE THEN remaining_amount ELSE -remaining_amount END) AS calc
        FROM open_items
        WHERE entity_type = 'supplier'
        GROUP BY entity_id
      ) oi ON oi.entity_id = s.id
      WHERE ABS(CAST(COALESCE(s.balance, 0) AS REAL) - CAST(COALESCE(oi.calc, 0) AS REAL)) > 0.01
      ORDER BY diff DESC
      LIMIT 50
    `,
  },
  {
    label: 'Customer balance vs open items',
    severity: 'error',
    hint: 'Recalculate client current_balance from open_items.',
    sql: `
      SELECT c.id AS key, c.name AS detail,
        CAST(c.current_balance AS REAL) AS stored,
        CAST(COALESCE(oi.calc, 0) AS REAL) AS expected,
        ABS(CAST(c.current_balance AS REAL) - CAST(COALESCE(oi.calc, 0) AS REAL)) AS diff
      FROM clients c
      LEFT JOIN (
        SELECT entity_id,
          SUM(CASE WHEN is_debit = 1 OR is_debit = TRUE THEN remaining_amount ELSE -remaining_amount END) AS calc
        FROM open_items
        WHERE entity_type = 'customer'
        GROUP BY entity_id
      ) oi ON oi.entity_id = c.id
      WHERE ABS(CAST(COALESCE(c.current_balance, 0) AS REAL) - CAST(COALESCE(oi.calc, 0) AS REAL)) > 0.01
      ORDER BY diff DESC
      LIMIT 50
    `,
  },
  {
    label: 'Journal entries not balanced',
    severity: 'error',
    hint: 'Review journal entry lines; debits must equal credits.',
    sql: `
      SELECT id AS key, entry_number AS detail,
        CAST(total_debit AS REAL) AS stored,
        CAST(total_credit AS REAL) AS expected,
        ABS(CAST(total_debit AS REAL) - CAST(total_credit AS REAL)) AS diff
      FROM journal_entries
      WHERE ABS(CAST(total_debit AS REAL) - CAST(total_credit AS REAL)) > 0.01
      ORDER BY diff DESC
      LIMIT 50
    `,
  },
  {
    label: 'Open items with negative remaining',
    severity: 'error',
    hint: 'Fix clearings or re-post payments; remaining_amount must be >= 0.',
    sql: `
      SELECT id AS key, document_number AS detail,
        CAST(remaining_amount AS REAL) AS stored,
        0 AS expected,
        ABS(CAST(remaining_amount AS REAL)) AS diff
      FROM open_items
      WHERE CAST(remaining_amount AS REAL) < -0.01
      LIMIT 50
    `,
  },
  {
    label: 'Product stock vs movement ledger (total)',
    severity: 'warn',
    hint: 'Reconcile products.stock from stock_movements (SKU warehouse sync).',
    sql: `
      SELECT p.id AS key, p.sku AS detail,
        CAST(p.stock AS REAL) AS stored,
        CAST(COALESCE(m.qty, 0) AS REAL) AS expected,
        ABS(CAST(p.stock AS REAL) - CAST(COALESCE(m.qty, 0) AS REAL)) AS diff
      FROM products p
      LEFT JOIN (
        SELECT product_id,
          SUM(CASE WHEN movement_type = 'IN' THEN quantity WHEN movement_type = 'OUT' THEN -quantity ELSE 0 END) AS qty
        FROM stock_movements
        GROUP BY product_id
      ) m ON m.product_id = p.id
      WHERE ABS(CAST(COALESCE(p.stock, 0) AS REAL) - CAST(COALESCE(m.qty, 0) AS REAL)) > 0.01
      ORDER BY diff DESC
      LIMIT 50
    `,
  },
  {
    label: 'Product stock vs movements at branch warehouse',
    severity: 'warn',
    hint: 'Stock at branch_id should match movements for that warehouse_id.',
    sql: `
      SELECT p.id AS key,
        (p.sku || ' @ ' || COALESCE(p.branch_id, '')) AS detail,
        CAST(p.stock AS REAL) AS stored,
        CAST(COALESCE(sm.qty, 0) AS REAL) AS expected,
        ABS(CAST(p.stock AS REAL) - CAST(COALESCE(sm.qty, 0) AS REAL)) AS diff
      FROM products p
      INNER JOIN (
        SELECT product_id, warehouse_id,
          SUM(CASE WHEN movement_type = 'IN' THEN quantity WHEN movement_type = 'OUT' THEN -quantity ELSE 0 END) AS qty
        FROM stock_movements
        GROUP BY product_id, warehouse_id
      ) sm ON sm.product_id = p.id AND sm.warehouse_id = p.branch_id
      WHERE p.branch_id IS NOT NULL AND TRIM(p.branch_id) != ''
        AND ABS(CAST(p.stock AS REAL) - CAST(sm.qty AS REAL)) > 0.01
      ORDER BY diff DESC
      LIMIT 50
    `,
  },
  {
    label: 'Orphan sale_items (no parent sale)',
    severity: 'error',
    hint: 'Delete orphan lines or restore missing sales row.',
    sql: `
      SELECT si.id AS key, si.sale_id AS detail,
        1 AS stored, 0 AS expected, 1 AS diff
      FROM sale_items si
      LEFT JOIN sales s ON s.id = si.sale_id
      WHERE s.id IS NULL
      LIMIT 50
    `,
  },
  {
    label: 'Orphan stock_movements (unknown product)',
    severity: 'warn',
    hint: 'Link movement to valid product_id or remove orphan movement.',
    sql: `
      SELECT sm.id AS key, sm.product_id AS detail,
        1 AS stored, 0 AS expected, 1 AS diff
      FROM stock_movements sm
      LEFT JOIN products p ON p.id = sm.product_id
      WHERE sm.product_id IS NOT NULL AND TRIM(sm.product_id) != '' AND p.id IS NULL
      LIMIT 50
    `,
  },
  {
    label: 'Confirmed purchase invoice without open item',
    severity: 'warn',
    hint: 'Re-process transaction or create open item for supplier payable.',
    sql: `
      SELECT pi.id AS key, pi.invoice_number AS detail,
        1 AS stored, 0 AS expected, 1 AS diff
      FROM purchase_invoices pi
      LEFT JOIN open_items oi ON oi.document_id = pi.id AND oi.entity_type = 'supplier'
      WHERE pi.status = 'confirmed' AND oi.id IS NULL
      LIMIT 50
    `,
  },
  {
    label: 'Supplier payable open item without purchase invoice row',
    severity: 'warn',
    hint: 'Save invoice to purchase_invoices or clear stale open item.',
    sql: `
      SELECT oi.document_id AS key, oi.document_number AS detail,
        1 AS stored, 0 AS expected, 1 AS diff
      FROM open_items oi
      LEFT JOIN purchase_invoices pi ON pi.id = oi.document_id
      WHERE oi.entity_type = 'supplier'
        AND (oi.is_debit = 1 OR oi.is_debit = TRUE)
        AND oi.document_type IN ('fatura_compra', 'purchase_invoice')
        AND oi.status != 'cleared'
        AND pi.id IS NULL
      LIMIT 50
    `,
  },
  {
    label: 'Payments without payment_number',
    severity: 'error',
    hint: 'All payments must have a unique payment_number.',
    sql: `
      SELECT id AS key, COALESCE(entity_name, entity_id) AS detail,
        1 AS stored, 0 AS expected, 1 AS diff
      FROM payments
      WHERE payment_number IS NULL OR TRIM(payment_number) = ''
      LIMIT 50
    `,
  },
];

async function runDuplicateCheck(db, check) {
  const result = await db.query(check.sql);
  const rows = result.rows || [];
  return { ok: rows.length === 0, rows, kind: 'duplicate' };
}

async function runConsistencyCheck(db, check) {
  const result = await db.query(check.sql);
  const rows = result.rows || [];
  return { ok: rows.length === 0, rows, kind: 'consistency', severity: check.severity, hint: check.hint };
}

function formatRow(row, kind) {
  if (kind === 'duplicate') {
    return `       ${row.key} × ${row.n}`;
  }
  const label = row.detail || row.key;
  if (row.stored != null && row.expected != null && row.diff != null) {
    return `       ${label} — stored=${Number(row.stored).toFixed(2)} expected=${Number(row.expected).toFixed(2)} Δ=${Number(row.diff).toFixed(2)}`;
  }
  return `       ${label}`;
}

async function runAllChecks(db, { uniqueness = true, consistency = true } = {}) {
  const summary = { errors: 0, warnings: 0, skipped: 0, ok: 0 };

  if (uniqueness) {
    console.log('\n── Uniqueness (duplicates) ──');
    for (const check of UNIQUENESS_CHECKS) {
      try {
        const { ok, rows } = await runDuplicateCheck(db, check);
        if (ok) {
          console.log(`  OK  ${check.label}`);
          summary.ok += 1;
        } else {
          console.log(`  FAIL ${check.label} (${rows.length})`);
          summary.errors += rows.length;
          for (const row of rows.slice(0, 10)) console.log(formatRow(row, 'duplicate'));
          if (rows.length > 10) console.log(`       … and ${rows.length - 10} more`);
        }
      } catch (err) {
        if (/no such table|does not exist/i.test(String(err.message))) {
          console.log(`  SKIP ${check.label}`);
          summary.skipped += 1;
        } else {
          console.log(`  ERR  ${check.label}: ${err.message}`);
          summary.errors += 1;
        }
      }
    }
  }

  if (consistency) {
    console.log('\n── Consistency (reconciliation) ──');
    for (const check of CONSISTENCY_CHECKS) {
      try {
        const { ok, rows, severity, hint } = await runConsistencyCheck(db, check);
        if (ok) {
          console.log(`  OK  ${check.label}`);
          summary.ok += 1;
        } else {
          const tag = severity === 'warn' ? 'WARN' : 'FAIL';
          console.log(`  ${tag} ${check.label} (${rows.length})`);
          if (severity === 'warn') summary.warnings += rows.length;
          else summary.errors += rows.length;
          for (const row of rows.slice(0, 10)) console.log(formatRow(row, 'consistency'));
          if (rows.length > 10) console.log(`       … and ${rows.length - 10} more`);
          if (hint) console.log(`       → ${hint}`);
        }
      } catch (err) {
        if (/no such table|does not exist/i.test(String(err.message))) {
          console.log(`  SKIP ${check.label}`);
          summary.skipped += 1;
        } else {
          console.log(`  ERR  ${check.label}: ${err.message}`);
          summary.errors += 1;
        }
      }
    }
  }

  return summary;
}

function mapRowSample(row, kind) {
  if (kind === 'duplicate') {
    return { key: row.key, count: Number(row.n) };
  }
  return {
    key: row.key,
    detail: row.detail,
    stored: row.stored != null ? Number(row.stored) : undefined,
    expected: row.expected != null ? Number(row.expected) : undefined,
    diff: row.diff != null ? Number(row.diff) : undefined,
  };
}

/**
 * Structured report for API / Settings UI (no console output).
 */
async function runAllChecksReport(db, { uniqueness = true, consistency = true } = {}) {
  const report = {
    status: 'ok',
    summary: { errors: 0, warnings: 0, skipped: 0, ok: 0 },
    uniqueness: [],
    reconciliation: [],
  };

  if (uniqueness) {
    for (const check of UNIQUENESS_CHECKS) {
      const entry = { label: check.label, kind: 'duplicate', status: 'ok', count: 0, samples: [] };
      try {
        const { ok, rows } = await runDuplicateCheck(db, check);
        if (ok) {
          report.summary.ok += 1;
        } else {
          entry.status = 'fail';
          entry.count = rows.length;
          entry.samples = rows.slice(0, 15).map((r) => mapRowSample(r, 'duplicate'));
          report.summary.errors += rows.length;
        }
      } catch (err) {
        if (/no such table|does not exist/i.test(String(err.message))) {
          entry.status = 'skip';
          report.summary.skipped += 1;
        } else {
          entry.status = 'error';
          entry.message = err.message;
          report.summary.errors += 1;
        }
      }
      report.uniqueness.push(entry);
    }
  }

  if (consistency) {
    for (const check of CONSISTENCY_CHECKS) {
      const entry = {
        label: check.label,
        kind: 'consistency',
        status: 'ok',
        count: 0,
        samples: [],
        severity: check.severity,
        hint: check.hint,
      };
      try {
        const { ok, rows, severity } = await runConsistencyCheck(db, check);
        if (ok) {
          report.summary.ok += 1;
        } else {
          entry.status = severity === 'warn' ? 'warn' : 'fail';
          entry.count = rows.length;
          entry.samples = rows.slice(0, 15).map((r) => mapRowSample(r, 'consistency'));
          if (severity === 'warn') report.summary.warnings += rows.length;
          else report.summary.errors += rows.length;
        }
      } catch (err) {
        if (/no such table|does not exist/i.test(String(err.message))) {
          entry.status = 'skip';
          report.summary.skipped += 1;
        } else {
          entry.status = 'error';
          entry.message = err.message;
          report.summary.errors += 1;
        }
      }
      report.reconciliation.push(entry);
    }
  }

  if (report.summary.errors > 0) report.status = 'errors';
  else if (report.summary.warnings > 0) report.status = 'warnings';
  else report.status = 'ok';

  return report;
}

module.exports = {
  UNIQUENESS_CHECKS,
  CONSISTENCY_CHECKS,
  runAllChecks,
  runAllChecksReport,
};
