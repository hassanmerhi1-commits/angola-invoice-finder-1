/**
 * AGT reconciliation — retry failed transmissions, poll pending statuses, backfill untransmitted docs.
 */
const db = require('../db');
const { getAgtConfig } = require('./agtConfig');
const { transmitFiscalEntity, retryTransmission, getEntityAgtStatus, ENTITY_MAP } = require('./agtTransmission');

const MAX_AUTO_RETRIES = 5;
const DONE_STATUSES = new Set(['validated', 'approved', 'submitted', 'voided']);

function isDoneStatus(status) {
  return DONE_STATUSES.has(String(status || '').toLowerCase());
}

function kindForEntityType(entityType) {
  return Object.keys(ENTITY_MAP).find((k) => ENTITY_MAP[k].entityType === entityType) || null;
}

async function reconcileFailedTransmissions(limit = 5) {
  const res = await db.query(
    `SELECT id, entity_type, entity_id, retry_count, invoice_number
     FROM agt_transmissions
     WHERE agt_status IN ('error', 'rejected')
       AND transmission_type != 'void'
       AND entity_id IS NOT NULL
       AND COALESCE(retry_count, 0) < $2
     ORDER BY transmitted_at ASC
     LIMIT $1`,
    [limit, MAX_AUTO_RETRIES],
  );

  let retried = 0;
  let failed = 0;
  for (const row of res.rows) {
    try {
      await retryTransmission(row.id);
      retried += 1;
    } catch (e) {
      failed += 1;
      console.warn('[AGT RECONCILE] retry', row.id, e.message);
    }
  }
  return { retried, failed, scanned: res.rows.length };
}

async function reconcilePendingRemoteStatuses(limit = 5) {
  const config = await getAgtConfig();
  if (config.simulate) return { polled: 0, updated: 0, skipped: true };

  const queries = [
    { kind: 'sale', sql: `SELECT id, invoice_number AS doc_num FROM sales
      WHERE LOWER(COALESCE(agt_status, '')) IN ('pending', 'submitted') ORDER BY created_at ASC LIMIT $1` },
    { kind: 'credit_note', sql: `SELECT id, document_number AS doc_num FROM credit_notes
      WHERE status IN ('issued', 'transmitted')
        AND LOWER(COALESCE(agt_status, '')) IN ('pending', 'submitted') ORDER BY issued_at ASC LIMIT $1` },
    { kind: 'debit_note', sql: `SELECT id, document_number AS doc_num FROM debit_notes
      WHERE status IN ('issued', 'transmitted')
        AND LOWER(COALESCE(agt_status, '')) IN ('pending', 'submitted') ORDER BY issued_at ASC LIMIT $1` },
  ];

  let polled = 0;
  let updated = 0;
  const perType = Math.max(1, Math.ceil(limit / queries.length));

  for (const { kind, sql } of queries) {
    const rows = await db.query(sql, [perType]);
    for (const row of rows.rows) {
      polled += 1;
      try {
        const status = await getEntityAgtStatus(kind, row.id, { documentNumber: row.doc_num });
        const remote = status.remote;
        if (remote?.agtStatus && remote.agtStatus !== status.agtStatus && isDoneStatus(remote.agtStatus)) {
          const meta = ENTITY_MAP[kind];
          await db.query(
            `UPDATE ${meta.table}
             SET agt_status = $1, agt_code = COALESCE($2, agt_code), agt_validated_at = COALESCE($3, agt_validated_at)
             WHERE id = $4`,
            [remote.agtStatus, remote.agtCode || null, remote.validatedAt || null, row.id],
          );
          updated += 1;
        }
      } catch (e) {
        console.warn('[AGT RECONCILE] poll', kind, row.id, e.message);
      }
    }
  }

  return { polled, updated, skipped: false };
}

async function backfillUntransmittedDocs(limit = 5) {
  const config = await getAgtConfig();
  if (!config.autoTransmit) return { transmitted: 0, failed: 0, skipped: true };

  const perType = Math.max(1, Math.ceil(limit / 3));
  const jobs = [];

  const sales = await db.query(
    `SELECT id FROM sales
     WHERE COALESCE(fiscal_status, 'issued') = 'issued'
       AND COALESCE(status, '') NOT IN ('voided', 'draft', 'cancelled')
       AND (agt_status IS NULL OR TRIM(agt_status) = '' OR LOWER(agt_status) IN ('pending', 'error', 'rejected'))
       AND NOT EXISTS (
         SELECT 1 FROM agt_transmissions t
         WHERE t.entity_type = 'sale' AND t.entity_id = sales.id
           AND t.agt_status IN ('validated', 'approved', 'submitted')
       )
     ORDER BY created_at ASC LIMIT $1`,
    [perType],
  );
  for (const row of sales.rows) jobs.push({ kind: 'sale', id: row.id });

  const creditNotes = await db.query(
    `SELECT id FROM credit_notes
     WHERE status IN ('issued', 'transmitted')
       AND (agt_status IS NULL OR TRIM(agt_status) = '' OR LOWER(agt_status) IN ('pending', 'error', 'rejected'))
       AND NOT EXISTS (
         SELECT 1 FROM agt_transmissions t
         WHERE t.entity_type = 'credit_note' AND t.entity_id = credit_notes.id
           AND t.agt_status IN ('validated', 'approved', 'submitted')
       )
     ORDER BY issued_at ASC LIMIT $1`,
    [perType],
  );
  for (const row of creditNotes.rows) jobs.push({ kind: 'credit_note', id: row.id });

  const debitNotes = await db.query(
    `SELECT id FROM debit_notes
     WHERE status IN ('issued', 'transmitted')
       AND (agt_status IS NULL OR TRIM(agt_status) = '' OR LOWER(agt_status) IN ('pending', 'error', 'rejected'))
       AND NOT EXISTS (
         SELECT 1 FROM agt_transmissions t
         WHERE t.entity_type = 'debit_note' AND t.entity_id = debit_notes.id
           AND t.agt_status IN ('validated', 'approved', 'submitted')
       )
     ORDER BY issued_at ASC LIMIT $1`,
    [perType],
  );
  for (const row of debitNotes.rows) jobs.push({ kind: 'debit_note', id: row.id });

  let transmitted = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await transmitFiscalEntity(job.kind, job.id);
      transmitted += 1;
    } catch (e) {
      failed += 1;
      console.warn('[AGT RECONCILE] backfill', job.kind, job.id, e.message);
    }
  }

  return { transmitted, failed, scanned: jobs.length, skipped: false };
}

async function runAgtReconcileCycle(options = {}) {
  const limit = options.limit || 5;
  const [failed, pending, backfill] = await Promise.all([
    reconcileFailedTransmissions(limit),
    reconcilePendingRemoteStatuses(limit),
    backfillUntransmittedDocs(limit),
  ]);
  return { failed, pending, backfill };
}

module.exports = {
  reconcileFailedTransmissions,
  reconcilePendingRemoteStatuses,
  backfillUntransmittedDocs,
  runAgtReconcileCycle,
  isDoneStatus,
  kindForEntityType,
};
